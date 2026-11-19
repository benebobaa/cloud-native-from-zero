# Owner references and garbage collection

## What and why

Delete a Deployment and its ReplicaSets and Pods should disappear too, without you listing them. Kubernetes records the relationship in the dependent: `metadata.ownerReferences` names the owner (kind, name, uid). When an owner is deleted, the **garbage collector** controller (in `kube-controller-manager`) deletes the dependents whose owners are all gone.

You choose how deletion cascades. **Background** (the default for `kubectl delete`) removes the owner at once and cleans up dependents afterwards. **Foreground** keeps the owner, marked for deletion, until its blocking dependents are gone. **Orphan** keeps the dependents and removes the pointers. Controllers set the references themselves; you rarely write them by hand.

## Diagram

{{diagram owner-references-and-garbage-collection-01.jsx | Owner chain and 3 delete modes}}
Each dependent stores a pointer to its owner; the garbage collector controller uses those pointers to decide what to delete when an owner goes away.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). A Deployment `gc` creates a ReplicaSet, which creates a Pod; each points to its owner:

```
$ kubectl create deploy gc --image=nginx:1.31.8
$ kubectl get pod -l app=gc -o jsonpath='{.items[0].metadata.ownerReferences[0]}'
{"apiVersion":"apps/v1","blockOwnerDeletion":true,"controller":true,"kind":"ReplicaSet","name":"gc-6d5bf74f4c","uid":"4ee1e29b-28ac-43c9-8b69-3e454c7d0191"}
$ kubectl get rs -l app=gc -o jsonpath='{.items[0].metadata.ownerReferences[0]}'
{"apiVersion":"apps/v1","blockOwnerDeletion":true,"controller":true,"kind":"Deployment","name":"gc","uid":"0ea9b0fe-f0ee-4862-b910-7bec4830c498"}
```

Delete the Deployment with `--cascade=orphan` and the ReplicaSet and Pod survive, with the pointer removed; then delete the ReplicaSet in the background and its Pod follows:

```
$ kubectl delete deploy gc --cascade=orphan; sleep 3; kubectl get rs,pods -l app=gc
replicaset.apps/gc-6d5bf74f4c   1   1   1   9s
pod/gc-6d5bf74f4c-sp5tx         1/1   Running   0   9s
$ kubectl get rs -l app=gc -o jsonpath='{.items[0].metadata.ownerReferences}'
                                    (empty: no owner any more)
$ kubectl delete rs -l app=gc --cascade=background; sleep 4; kubectl get rs,pods -l app=gc
No resources found in t2 namespace.
```

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `metadata.ownerReferences[].apiVersion`, `kind`, `name` | Identify the owner | required |
| `metadata.ownerReferences[].uid` | UID of the owner; the collector compares it with the live object | required |
| `metadata.ownerReferences[].controller` | True if this owner is the managing controller (at most one) | unset |
| `metadata.ownerReferences[].blockOwnerDeletion` | If true and the owner is deleted in the foreground, the owner waits for this dependent | unset |
| `kubectl delete --cascade=` | `background`, `foreground` or `orphan` | `background` |
| `DeleteOptions.propagationPolicy` | The same choice in the API: `Background`, `Foreground`, `Orphan` | decided by the object's finalizers and kind |

Field meanings are from the v1.37.0 OpenAPI spec; an owner must be in the same namespace as the dependent, or cluster-scoped.

## kubectl

```
kubectl get pod <name> -o jsonpath='{.metadata.ownerReferences}'   # who owns it
kubectl get rs,pods -l app=gc                                       # the owner chain by label
kubectl delete deploy gc                                            # background cascade (default)
kubectl delete deploy gc --cascade=foreground                       # owner waits for dependents
kubectl delete deploy gc --cascade=orphan                           # keep ReplicaSet and Pods
kubectl get all -n <ns>                                             # see what is still there
```

## How it fails

Rows one and two were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| A ConfigMap created with an `ownerReferences` entry for a non-existent owner uid is gone seconds later (`Error from server (NotFound): configmaps "child" not found`) | The garbage collector found that all of the object's owners are absent and deleted it | Point `ownerReferences` at a live owner with its real `uid`, or leave them out |
| After `kubectl delete deploy gc --cascade=orphan`, the ReplicaSet and Pod keep running with no owner and nothing replaces them if you delete the Pod | `--cascade=orphan` removed the pointers; no controller owns them any more | Delete them explicitly (`kubectl delete rs,pods -l app=gc`) or re-create the Deployment so it adopts them |
| You delete a Pod and an identical one appears | The Pod is owned by a ReplicaSet (see the example); the owner re-creates the missing dependent | Delete or scale the owner (Deployment), not the Pod |

## Related

- **Cards:** Finalizers; Deployment, ReplicaSet, Job, CronJob (all own what they create); kube-controller-manager and its controllers (group 1); Objects, spec and status.
- **Chapter and lab:** Chapter 5.1 and Lab 5.1 (Vol 5).
- **Exam domain:** KCNA Kubernetes Fundamentals.
