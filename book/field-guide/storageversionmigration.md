# StorageVersionMigration

## What and why

StorageVersionMigration rewrites stored objects so etcd holds them at the API's current storage version and, for encrypted resources, under the current key. You need it before you stop serving an old version of a CRD, and after you rotate an encryption key.

**Acts on it:** the built-in storage version migrator, a control plane controller. The API `storagemigration.k8s.io/v1` is described as stable and enabled by default in 1.37, but the task page's own label still read "Beta since v1.35; disabled by default" when opened 2026-11-17, so confirm with `kubectl api-resources` ([Kubernetes v1.37 blog](https://kubernetes.io/blog/2026/08/31/kubernetes-v1-37-storage-version-migration-ga/)).

## Diagram

{{diagram storageversionmigration-01.jsx | Storage version migration · 5 steps}}

A migration changes how data is stored, never what it says.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-17). `storagemigration.k8s.io/v1` is served by default on 1.37, and the migration is run by kube-controller-manager. The scenario: a CRD `things.example.com` has versions `v1` and `v2`; three objects were written while `v1` was the storage version, then `v2` became the storage version.

```yaml
apiVersion: storagemigration.k8s.io/v1
kind: StorageVersionMigration
metadata: {name: things}
spec:
  resource: {group: example.com, resource: things}
```

```text
$ kubectl get crd things.example.com -o jsonpath='{.status.storedVersions}'     # after the 3 objects, before the switch
["v1"]
$ kubectl get crd things.example.com -o jsonpath='{.status.storedVersions}'     # after storage moved to v2
["v1","v2"]
$ kubectl apply -f svm.yaml
storageversionmigration.storagemigration.k8s.io/things created
$ kubectl get storageversionmigration things
NAME     RESOURCE             STATUS
things   things.example.com   Succeeded
$ kubectl get storageversionmigration things -o jsonpath='{.status}'
{"conditions":[{"message":"Migration completed","reason":"MigrationCompleted","status":"False","type":"Running"},{"message":"Migration completed","reason":"StorageVersionMigrationSucceeded","status":"True","type":"Succeeded"}],"resourceVersion":"9896"}
$ kubectl get crd things.example.com -o jsonpath='{.status.storedVersions}'     # a few seconds later
["v2"]
```

The migration rewrote every `Thing` (read and write back, so etcd now holds the `v2` encoding), and `v1` left the CRD's `storedVersions` list. The name `things` was applied after the CRD change; the object is a request, not a standing rule, so a later storage-version change needs a new migration.

## Key fields

Fields are from `kubectl explain storageversionmigration` on the test cluster and the observed objects. The resource is cluster-scoped.

| Field | Meaning | Value or default |
| --- | --- | --- |
| `spec.resource.group` | API group of the resource to migrate (empty string for core resources) | required |
| `spec.resource.resource` | Plural resource name, for example `things` or `secrets` | required |
| `spec` (whole) | Immutable: changing it gives `spec: Invalid value: ...: field is immutable` |  |
| `status.conditions[]` | `Running` while it works; `Succeeded` or `Failed` at the end, each with `reason` and `message` | set by the controller |
| `status.resourceVersion` | The resource version of the listed resource when the controller first saw the migration | set by the controller |
| printer columns `RESOURCE`, `STATUS` | `kubectl get` summary: `Running`, `Succeeded` |  |

The API is described in the Kubernetes documentation page [Migrate Kubernetes objects using storage version migration](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/storage-version-migration/). There is no `version` field: the target is whatever the API server now uses as the storage version. There is no `kubectl` short name (`svm` is not a resource name; use `storageversionmigration`).

## kubectl

```bash
kubectl api-resources --api-group=storagemigration.k8s.io
kubectl apply -f svm.yaml
kubectl get storageversionmigration                      # RESOURCE and STATUS columns
kubectl get storageversionmigration things -o yaml       # conditions with reason and message
kubectl get crd things.example.com -o jsonpath='{.status.storedVersions}'   # which versions etcd still holds
kubectl get --raw /apis/storagemigration.k8s.io/v1       # the API is served
kubectl delete storageversionmigration things            # clean up after it has Succeeded
```

## How it fails

All rows were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubectl get storageversionmigration nosuch` stays `STATUS Running` with condition `The migration is running` after 75 s (resource `nosuchthings.example.com` does not exist) | The migration of a resource that does not exist is not rejected and does not fail visibly; it waits | Check the group and plural name against `kubectl api-resources` before applying; delete the stuck object |
| `The StorageVersionMigration "things" is invalid: spec: Invalid value: {"Resource":{"group":"example.com","resource":"others"}}: field is immutable` | The spec cannot be edited after creation | Delete it and create a new one |
| `kubectl get svm` gives `the server doesn't have a resource type "svm"`; a patch that adds `spec.resource.version` prints `Warning: unknown field "spec.resource.version"` and `(no change)` | There is no short name, and the spec has no version field: unknown fields are dropped, not applied | Use `storageversionmigration`; to choose a version, change the CRD's storage version first, then migrate |

Without a migration, objects stay in their old encoding and `storedVersions` keeps the old version listed, so the old version cannot be removed from the CRD (the API server refuses to drop a version that is still in `storedVersions`; documented behaviour, not reproduced).

## Related

- **Cards:** Encrypting Secrets at rest, CustomResourceDefinition, API groups, versions and deprecation (group 2), Upgrades and version skew, etcd (group 1).
- **Chapter and lab:** none; card only.
- **Exam:** no curriculum line names it (checked in the CKA and CKAD v1.37 curriculum PDFs, [cncf/curriculum](https://github.com/cncf/curriculum), 2026-11-17).
