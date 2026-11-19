# Namespace

## What and why

One cluster is shared by many teams and apps, and two of them will both want to name something `web`. A **Namespace** is a scope: a name only has to be unique inside its namespace, and quotas, access rules (RBAC) and policies attach to a namespace. Deleting a namespace deletes everything in it.

The API server enforces the scope on every request. The namespace controller in `kube-controller-manager` does the cleanup when a namespace is deleted: it removes all objects inside and only then lets the Namespace itself go. Some kinds, such as Node and PersistentVolume, are cluster-scoped and live outside any namespace.

## Diagram

{{diagram namespace-01.jsx | Namespaced and cluster-scoped objects}}
Most objects live inside exactly one namespace; a few kinds, such as Node and PersistentVolume, belong to the whole cluster.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16).

```
$ kubectl get ns --show-labels | head -6
NAME                 STATUS   AGE   LABELS
default              Active   90s   kubernetes.io/metadata.name=default
kube-node-lease      Active   90s   kubernetes.io/metadata.name=kube-node-lease
kube-public          Active   90s   kubernetes.io/metadata.name=kube-public
kube-system          Active   90s   kubernetes.io/metadata.name=kube-system
local-path-storage   Active   74s   kubernetes.io/metadata.name=local-path-storage
$ kubectl create ns demo; kubectl get ns demo -o jsonpath='{.metadata.labels}{"\n"}{.spec}{"\n"}{.status}'
namespace/demo created
{"kubernetes.io/metadata.name":"demo"}
{"finalizers":["kubernetes"]}
{"phase":"Active"}
$ kubectl -n demo run a --image=alpine:3.21 --command -- sleep 3600; kubectl get pods -n demo; kubectl get pods
NAME   READY   STATUS              RESTARTS   AGE
a      0/1     ContainerCreating   0          0s            <- in demo; plain `kubectl get pods` lists only the current namespace
$ kubectl api-resources --namespaced=false | wc -l
38
```

The four namespaces every cluster starts with are `default`, `kube-system`, `kube-public` and `kube-node-lease` (`local-path-storage` is added by kind). 38 lines include the header, so 37 kinds are cluster-scoped here.

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `metadata.name` | Namespace name (a DNS label) | required |
| `metadata.labels` | Labels; policies and NetworkPolicy select namespaces by label | `kubernetes.io/metadata.name` is set by the API server |
| `spec.finalizers` | Entries that must be empty before the Namespace is removed | `kubernetes` |
| `status.phase` | `Active` or `Terminating` | `Active` |
| `status.conditions` | Why a deletion is waiting (content, finalizers) | none |
| `-n` / `--namespace` (kubectl) | Which namespace a command acts on | the context's namespace, else `default` |

Field meanings are from the v1.37.0 OpenAPI spec and `kubectl explain`; the labels and finalizers defaults are from the cluster run shown in the example.

## kubectl

```
kubectl get ns                                         # all namespaces and their phase
kubectl create ns demo                                 # imperative create
kubectl -n demo get pods     kubectl get pods -A       # one namespace / all namespaces
kubectl config set-context --current --namespace=demo  # make demo the default for this context
kubectl config view --minify -o jsonpath='{..namespace}'   # which namespace am I in?
kubectl api-resources --namespaced=false               # kinds that live outside namespaces
kubectl delete ns demo                                 # deletes everything inside
kubectl get ns stuck -o jsonpath='{.status.conditions}'    # why a namespace is Terminating
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubectl -n nope get pods` prints `No resources found in nope namespace.` (no error), but `kubectl run x --image=alpine:3.21 -n nope` fails: `Error from server (NotFound): namespaces "nope" not found` | A list in a namespace that does not exist looks like an empty namespace; only writes reveal it | Check `kubectl get ns`; watch for typos in `-n` |
| `kubectl delete ns stuck` leaves `STATUS Terminating`; conditions: `NamespaceContentRemaining=True SomeResourcesRemain: Some resources are remaining: configmaps. has 1 resource instances` and `NamespaceFinalizersRemaining=True SomeFinalizersRemain: Some content in the namespace has finalizers remaining: example.com/hold in 1 resource instances`; creating anything inside fails: `forbidden: unable to create new content in namespace stuck because it is being terminated` | An object inside still has a finalizer that nothing removes | Find the object named in the condition and fix or clear its finalizer; the namespace then goes (`kubectl get ns stuck` returned `NotFound` after the patch) |
| `The Namespace "Bad_Name" is invalid: metadata.name: Invalid value: "Bad_Name": a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character` | Namespace names must be DNS labels | Use lower case, digits and `-` |

## Related

- **Cards:** Objects, spec and status; Finalizers; ResourceQuota and LimitRange (group 7); RBAC (group 9); NetworkPolicy (group 4); kubeconfig and contexts (group 11).
- **Chapter and lab:** Chapter 5.1 and Lab 5.1 (Vol 5).
- **Exam domain:** KCNA Kubernetes Fundamentals.
