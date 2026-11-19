# ReplicaSet

## What and why

A bare Pod dies with its node and is never replaced. A **ReplicaSet** fixes that: you state how many identical Pods you want and a label selector that says which Pods count, and the ReplicaSet controller (inside `kube-controller-manager`) creates or deletes Pods until the numbers match. It also adopts existing Pods that match its selector and have no other owner.

You rarely write a ReplicaSet directly. A Deployment creates one per version of your Pod template and uses it to do rolling updates; the ReplicaSet itself only keeps the count.

## Diagram

{{diagram replicaset-01.jsx | ReplicaSet ownership and reconcile loop}}
A Deployment owns the ReplicaSet, and the ReplicaSet owns its Pods; the controller compares the count of matching Pods with replicas and creates or deletes the difference.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16).

```yaml
apiVersion: apps/v1
kind: ReplicaSet
metadata: {name: web-rs}
spec:
  replicas: 3
  selector: {matchLabels: {app: web-rs}}
  template:
    metadata: {labels: {app: web-rs}}
    spec:
      containers:
      - {name: nginx, image: "nginx:1.31.8"}
```

Delete one Pod and the ReplicaSet creates a replacement (`kn677`); the Pod points back to its owner:

```
$ kubectl delete pod web-rs-2xwvm --wait=false; sleep 5; kubectl get pods -l app=web-rs
NAME           READY   STATUS              RESTARTS   AGE
web-rs-2xwvm   0/1     Terminating         0          15s
web-rs-9w9n8   1/1     Running             0          15s
web-rs-kn677   0/1     ContainerCreating   0          5s
web-rs-rlxkt   0/1     ContainerCreating   0          15s
$ kubectl get pod -l app=web-rs -o jsonpath='{.items[0].metadata.ownerReferences}'
[{"apiVersion":"apps/v1","blockOwnerDeletion":true,"controller":true,"kind":"ReplicaSet","name":"web-rs","uid":"fc924a93-4564-440c-8aa7-4aa0ac8a881e"}]
```

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.replicas` | Number of Pods to keep running | 1 |
| `spec.selector` | Label query that decides which Pods the ReplicaSet counts; must match the template labels | required |
| `spec.template` | Pod template used to create new Pods | required |
| `spec.minReadySeconds` | Seconds a new Pod must stay ready before it counts as available | 0 |

Defaults are from `kubectl explain` and the v1.37.0 OpenAPI spec.

## kubectl

```
kubectl apply -f rs.yaml
kubectl get rs web-rs                          # DESIRED, CURRENT, READY
kubectl get pods -l app=web-rs                 # the Pods it counts
kubectl describe rs web-rs                     # conditions and Events (ReplicaFailure shows here)
kubectl scale rs web-rs --replicas=5
kubectl delete rs web-rs --cascade=orphan      # delete the ReplicaSet, keep its Pods
kubectl rollout status rs/web-rs               # not supported for ReplicaSets, see below
```

```
$ kubectl rollout status rs/web-rs
error: no status viewer has been implemented for ReplicaSet.apps
```

`kubectl rollout` works on Deployments, DaemonSets and StatefulSets; for a ReplicaSet watch `kubectl get rs -w`.

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| The ReplicaSet "bad-rs" is invalid: spec.template.metadata.labels: Invalid value: {"app":"two"}: \`selector\` does not match template \`labels\` (nothing is created) | `spec.selector` does not match the labels of `spec.template`, so the ReplicaSet could never find its own Pods | Make the template labels satisfy the selector |
| `kubectl get rs` shows DESIRED 5, CURRENT 3; condition `ReplicaFailure`: pods "web-rs-d4h4k" is forbidden: exceeded quota: q, requested: pods=1, used: pods=4, limited: pods=3 | A ResourceQuota (or an admission rule) refuses the new Pods | Raise the quota or lower `replicas`; read `kubectl describe rs` |
| A Pod you created by hand with label `app=web-rs` vanished within 5 seconds | Its labels matched the ReplicaSet selector, so the ReplicaSet adopted it and, with the count already at 3, removed the surplus | Give hand-made Pods labels no selector matches |

## Related

- **Cards:** Deployment; Pod; Labels, selectors and annotations (group 2); Owner references and garbage collection (group 2); ReplicationController (legacy); kube-controller-manager and its controllers (group 1).
- **Chapter and lab:** Chapter 5.2 and Lab 5.2 (Vol 5).
- **Exam domain:** KCNA Kubernetes Fundamentals; CKAD Application Design and Build, choose a workload resource.
