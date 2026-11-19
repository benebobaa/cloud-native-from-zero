# StorageClass

## What and why

A StorageClass describes a kind of storage (fast, cheap, replicated) and names the provisioner that creates it. A PVC that names the class triggers dynamic provisioning, so nobody has to create PVs by hand.

Kubernetes only stores the class; the **provisioner** (for a CSI driver, its external-provisioner sidecar) acts on it. Fields: `provisioner`, `parameters` (opaque to Kubernetes), `reclaimPolicy`, `volumeBindingMode` (`Immediate` or `WaitForFirstConsumer`), `allowVolumeExpansion`, `mountOptions`, `allowedTopologies`. A class annotated `storageclass.kubernetes.io/is-default-class: "true"` serves claims that name no class.

## Diagram

{{diagram storageclass-01.jsx | StorageClass flow · 5 boxes}}

A claim names a class; the class names a provisioner, which creates the PersistentVolume.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). kind creates one class and marks it default:

```
$ kubectl get sc
NAME                 PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE      ALLOWVOLUMEEXPANSION
standard (default)   rancher.io/local-path   Delete          WaitForFirstConsumer   false
```

Its YAML is the smallest useful class: a name, a provisioner and two policies. The annotation is what makes it the default:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: standard
  annotations: {storageclass.kubernetes.io/is-default-class: "true"}
provisioner: rancher.io/local-path
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
```

With two classes marked default, a new claim without `storageClassName` got the more recently created one:

```
$ kubectl patch sc immediate-local -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
$ kubectl get pvc -o custom-columns=NAME:.metadata.name,CLASS:.spec.storageClassName   # claim made with no class
twodefaults-6m48m   immediate-local
```

## Key fields

Checked with `kubectl explain storageclass` on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| `provisioner` | which provisioner creates volumes (a CSI driver name or `kubernetes.io/...`); immutable | required |
| `parameters` | opaque settings for the provisioner | none |
| `reclaimPolicy` | `Delete`, `Retain` (or deprecated `Recycle`) for PVs it creates | `Delete` |
| `volumeBindingMode` | `Immediate` binds at claim creation; `WaitForFirstConsumer` waits for a Pod and its node | `Immediate` |
| `allowVolumeExpansion` | whether claims of this class may grow | `false` (observed on kind) |
| `allowedTopologies` | restrict where volumes may be provisioned | no restriction |
| `mountOptions` | mount options for the PVs; not validated | none |
| annotation `storageclass.kubernetes.io/is-default-class: "true"` | makes the class the default for claims without a class | absent |

## kubectl

```bash
kubectl get sc                                   # (default) marker, PROVISIONER, BINDINGMODE
kubectl describe sc standard
kubectl patch sc standard -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"false"}}}'   # drop the default flag
kubectl get pvc imm && kubectl describe pvc imm | tail -4     # why a claim is Pending
kubectl get pvc -o custom-columns=NAME:.metadata.name,CLASS:.spec.storageClassName
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| Claim `Pending`; event `failed to provision volume with StorageClass "immediate-local": configuration error, no node was specified` | `volumeBindingMode: Immediate` with node-local storage (rancher.io/local-path): the volume is requested before any Pod has chosen a node | Use `WaitForFirstConsumer` for storage tied to a node |
| Claim `Pending` with an empty `STORAGECLASS`; event `FailedBinding ... no persistent volumes available for this claim and no storage class is set` | No class was marked default when the claim was created (the default flag had been removed). The docs say the control plane gives such a claim the new default once one exists (a claim with an explicit empty `storageClassName` is never updated), but in this test it was still Pending 11 s after re-marking, which was not investigated further ([Default StorageClass](https://kubernetes.io/docs/concepts/storage/storage-classes/#default-storageclass)) | Set a default class or name one in the claim; recreate the claim if it stays Pending |
| `The StorageClass "standard" is invalid: provisioner: Invalid value: null: field is immutable` | The `provisioner` of an existing class cannot be changed | Create a new class and point new claims at it |

## Related

- **Cards:** PersistentVolumeClaim, PersistentVolume, CSIDriver, CSINode and CSIStorageCapacity, VolumeAttributesClass
- **Chapter and lab:** Ch 5.4 and Lab 5.4
- **Exam:** CKA, Storage (10%): storage classes and dynamic provisioning
- **Source:** [Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/)
