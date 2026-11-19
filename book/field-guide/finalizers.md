# Finalizers

## What and why

Some objects cannot just vanish: a PersistentVolumeClaim in use, a Namespace that still holds objects, a custom resource whose real-world resource must be released first. A **finalizer** is a string in `metadata.finalizers` that means "someone must clean up before this object is deleted". While the list is not empty, a delete request only sets `metadata.deletionTimestamp`; the object stays visible and is said to be Terminating.

The controller that owns each finalizer watches for the timestamp, does its cleanup, then removes its own entry. When the last entry is gone, the API server deletes the object. If the owning controller is missing or broken, the object stays Terminating forever. Removing the finalizer by hand skips the cleanup, so it is a last resort.

## Diagram

{{diagram finalizers-01.jsx | Deletion with a finalizer · 5 steps}}
A delete request only marks the object; it disappears when the last finalizer is removed. A controller that never removes its finalizer leaves the object stuck.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). A ConfigMap carries a finalizer that no controller will ever remove:

```yaml
apiVersion: v1
kind: ConfigMap
metadata: {name: guarded, finalizers: ["example.com/cleanup"]}
data: {k: v}
```

```
$ kubectl apply -f fin.yaml; kubectl delete cm guarded --wait=false; kubectl get cm guarded
configmap "guarded" deleted from t2 namespace
NAME      DATA   AGE
guarded   1      1s
$ kubectl get cm guarded -o jsonpath='{.metadata.deletionTimestamp} {.metadata.finalizers}'
2026-11-16T08:17:10Z ["example.com/cleanup"]
$ kubectl delete cm guarded --wait=true --timeout=5s
error: timed out waiting for the condition on configmaps/guarded
$ kubectl patch cm guarded --type=merge -p '{"metadata":{"finalizers":null}}'; kubectl get cm guarded
configmap/guarded patched
Error from server (NotFound): configmaps "guarded" not found
```

"deleted" is printed at once, but the object stays with a `deletionTimestamp` until the finalizer is removed.

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `metadata.finalizers[]` | Identifiers of components that must clean up; while non-empty the object cannot be removed | empty |
| `metadata.deletionTimestamp` | Set by the server when deletion is requested; not settable by clients | unset |
| `metadata.deletionGracePeriodSeconds` | Grace period for graceful deletion; can only be shortened | unset |
| `spec.finalizers` (Namespace) | The namespace's own list, cleared by the namespace controller | `kubernetes` |
| `kubectl patch ... -p '{"metadata":{"finalizers":null}}'` | Clear all finalizers by hand | not applicable |

Rules from the v1.37.0 OpenAPI spec: once `deletionTimestamp` is set, entries in `finalizers` can only be removed, and they may be removed in any order.

## kubectl

```
kubectl get <kind> <name> -o jsonpath='{.metadata.deletionTimestamp} {.metadata.finalizers}'
kubectl delete <kind> <name> --wait=false          # return at once instead of waiting for deletion
kubectl delete <kind> <name> --timeout=5s          # fail if deletion is not finished in time
kubectl patch <kind> <name> --type=merge -p '{"metadata":{"finalizers":null}}'   # last resort: skip the cleanup
kubectl get ns | grep Terminating                  # namespaces stuck on finalizers
kubectl api-resources --verbs=list --namespaced -o name | xargs -n1 kubectl get -n <ns> --ignore-not-found   # not run: find what blocks a namespace
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubectl delete` returns "deleted" but the object is still listed; `--wait` ends with `error: timed out waiting for the condition on configmaps/guarded` | A finalizer is still in `metadata.finalizers` and its controller has not removed it | Find the controller that owns the finalizer and fix it; as a last resort clear the finalizers with `kubectl patch` (cleanup is skipped) |
| `The ConfigMap "guarded" is invalid: metadata.finalizers: Forbidden: no new finalizers can be added if the object is being deleted, found new finalizers []string{"example.com/new"}` | After `deletionTimestamp` is set, finalizers can only be removed | Add finalizers before deletion starts, or re-create the object |
| Namespace stays `Terminating`; creating objects in it fails: `configmaps "another" is forbidden: unable to create new content in namespace stuck because it is being terminated` | An object inside (here a ConfigMap with a finalizer) blocks the namespace deletion, and new content is refused meanwhile | List what is left in the namespace, clear the blocking finalizer on that object, and the namespace then disappears |

## Related

- **Cards:** Owner references and garbage collection (foreground deletion uses a finalizer); Namespace; PersistentVolumeClaim (group 6); CustomResourceDefinition (group 10); Troubleshooting playbook (group 11).
- **Chapter and lab:** Chapter 5.1 and Lab 5.1 (Vol 5).
- **Exam domain:** KCNA Kubernetes Fundamentals.
