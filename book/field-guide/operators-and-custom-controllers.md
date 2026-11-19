# Operators and custom controllers

## What and why

An operator is a custom controller plus its CRDs that automates running one piece of software, such as a database, the way a human operator would. The controller watches the desired state in custom resources and reconciles real objects to match.

**Acts on it:** your controller, running as a Pod. It talks to the kube-apiserver like any client; kube-controller-manager only runs the built-in controllers.

## Diagram

{{diagram operators-and-custom-controllers-01.jsx | Reconcile loop · 4 steps}}

The controller is just a client of the API server, so it can run anywhere with credentials.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1, jq (2026-11-17). The `Site` CRD is the one from the CustomResourceDefinition card. The controller is a **toy**: a 25-line bash loop run on the laptop, outside the cluster, that every 2 s lists the `Site` objects, applies one Deployment per Site with an `ownerReference`, and writes `status.readyReplicas`. Real operators are written with a framework (the Kubernetes [operator page](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/) lists kubebuilder, Operator Framework, Kopf, kube-rs and others) that adds watches, caching, retries and leader election.

```bash
# the heart of the loop (full script: apply the Deployment, then patch /status)
kubectl get sites.example.com -A -o json | jq -c '.items[]' | while read -r s; do
  # desired state: spec.replicas, spec.image  ->  actual state: a Deployment owned by the Site
  kubectl apply -f - <<Y
apiVersion: apps/v1
kind: Deployment
metadata:
  name: site-$name
  namespace: $ns
  ownerReferences: [{apiVersion: example.com/v1, kind: Site, name: $name, uid: "$uid", controller: true, blockOwnerDeletion: true}]
spec: {replicas: $rep, selector: {matchLabels: {site: $name}}, template: {metadata: {labels: {site: $name}}, spec: {containers: [{name: web, image: $img}]}}}
Y
  kubectl -n $ns patch site $name --subresource=status --type=merge -p "{\"status\":{\"readyReplicas\":$ready}}"
done
```

```text
$ kubectl -n crd-demo get sites        # before the controller ran: accepted, nothing happens
NAME   REPLICAS   READY
blog   2
$ kubectl -n crd-demo get sites        # 20 s after starting it
NAME   REPLICAS   READY
blog   2          2
$ kubectl -n crd-demo get deploy site-blog -o jsonpath='{.metadata.ownerReferences}'
[{"apiVersion":"example.com/v1","blockOwnerDeletion":true,"controller":true,"kind":"Site","name":"blog","uid":"b31a98ac-..."}]
$ kubectl -n crd-demo delete deploy site-blog      # the loop notices and recreates it
$ kubectl -n crd-demo get deploy
NAME        READY   UP-TO-DATE   AVAILABLE   AGE
site-blog   2/2     2            2           5s
$ kubectl -n crd-demo patch site blog --type=merge -p '{"spec":{"replicas":3}}'
$ kubectl -n crd-demo get site blog     # 25 s later
NAME   REPLICAS   READY
blog   3          3
$ kubectl -n crd-demo delete site blog  # garbage collection removes the owned Deployment and Pods
$ kubectl -n crd-demo get deploy,pods
No resources found in crd-demo namespace.
```

Three behaviours of a real operator are visible: it repairs drift (the deleted child came back), it follows the desired state (replicas 2 to 3), and the owner reference ties the child's life to the custom resource.

## Key fields

An operator has no fields of its own; it is a CRD plus a controller. These are the API fields a controller depends on, each seen in the test above.

| Field | Role for the controller | Seen |
| --- | --- | --- |
| `spec` | Desired state, written by users; the controller only reads it | `replicas`, `image` |
| `status` (with `subresources: {status: {}}`) | Observed state, written by the controller through `/status` | `readyReplicas` |
| `metadata.ownerReferences[]` (`apiVersion`, `kind`, `name`, `uid`, `controller`, `blockOwnerDeletion`) | Marks the controller's child objects; the garbage collector deletes children when the owner goes | Deployment owned by Site |
| `metadata.finalizers[]` | Names of cleanup steps that must finish before the object is really deleted | `example.com/cleanup` |
| `metadata.deletionTimestamp` | Set when deletion is requested; the controller sees it and runs its cleanup | `2026-11-17T04:58:31Z` |
| `metadata.generation` | Increases on every `spec` change; a status field `observedGeneration` tells readers which one the controller has handled | not used by the toy |
| RBAC for the controller's ServiceAccount | Read the custom resource, write `sites/status`, manage what it creates (Deployments) | see failures |
| `Lease` (`coordination.k8s.io/v1`) | Leader election, so only one replica of the controller acts | not used by the toy (the VPA and scheduler pods use it) |

The operator pattern is defined on the Kubernetes [operator page](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/): custom resources plus a controller that follows "the control loop".

## kubectl

```bash
kubectl get crd                                   # which operators have installed types
kubectl api-resources --api-group=example.com
kubectl get sites -A                              # the custom resources
kubectl describe site blog -n crd-demo            # conditions and events the operator wrote
kubectl get deploy,pods -n crd-demo -l site=blog  # what the operator created
kubectl get site blog -n crd-demo -o jsonpath='{.metadata.ownerReferences} {.metadata.finalizers} {.status}'
kubectl -n <operator-ns> get pods                 # the operator's own Pods
kubectl -n <operator-ns> logs deploy/<operator>   # reconcile errors show here
kubectl auth can-i create deployments -n crd-demo --as=system:serviceaccount:crd-demo:site-controller
kubectl patch site blog -n crd-demo --type=merge -p '{"metadata":{"finalizers":null}}'   # last resort for a stuck delete
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubectl apply` of a `Site` succeeds, but `kubectl get sites` shows `READY` empty and `kubectl get deploy` says `No resources found` (the controller was stopped) | A custom resource is only data; with no running controller nothing reconciles it | Check the operator's Pod (`kubectl -n <operator-ns> get pods`) and its logs; the CR is fine, the controller is not running |
| After `kubectl delete site shop --wait=false` the object stays: `kubectl get site shop -o jsonpath='{.metadata.deletionTimestamp} {.metadata.finalizers}'` gives `2026-11-17T04:58:31Z ["example.com/cleanup"]` | A finalizer is present and the controller that should remove it is not running, so deletion never completes | Restore the controller so it can finish its cleanup; as a last resort remove the finalizer by hand: `kubectl patch site shop --type=merge -p '{"metadata":{"finalizers":null}}'` (the object then disappeared at once) |
| Controller logs `deployments.apps is forbidden: User "system:serviceaccount:crd-demo:site-controller" cannot create resource "deployments" in API group "apps" in the namespace "crd-demo"` and `sites.example.com is forbidden: ... cannot list resource "sites" in API group "example.com"` | The controller's ServiceAccount has no RBAC for the custom resource or for what it creates | Create a ClusterRole with `sites` (get, list, watch, update, patch), `sites/status` (update, patch) and `deployments` (create and others), and bind it; `auth can-i` then answers `yes` |

## Related

- **Cards:** CustomResourceDefinition, Finalizers (group 2), Owner references and garbage collection (group 2), Watch and resourceVersion (group 2), kube-controller-manager and its controllers (group 1).
- **Chapter and lab:** 7.3.
- **Exam:** CKA Cluster Architecture, Installation and Configuration (25%): install and configure operators; CKAD Application Environment, Configuration and Security (25%); KCNA Cloud Native Architecture.
