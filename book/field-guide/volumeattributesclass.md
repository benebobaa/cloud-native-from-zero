# VolumeAttributesClass

## What and why

A VolumeAttributesClass (VAC) names driver-specific attributes, such as IOPS or throughput, that you can apply to an existing volume. It lets you change a volume's performance class without recreating it or copying data. It is stable since Kubernetes v1.36 (first available in v1.29).

A PVC points at a class with `spec.volumeAttributesClassName`. Changing that name asks the CSI driver to modify the volume; the **external-resizer** sidecar of the driver does this, and the result shows in the PVC status. `driverName` and `parameters` cannot be changed after the class exists, so you make a new class to change the numbers.

## Diagram

{{diagram volumeattributesclass-01.jsx | VolumeAttributesClass flow · 5 boxes}}

A claim that names another class makes the external-resizer ask the CSI driver to modify the volume.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). kind has no CSI driver that supports `ModifyVolume`, so only the **API objects were run**; the volume modification itself was not. A class and a claim that names it:

```yaml
apiVersion: storage.k8s.io/v1
kind: VolumeAttributesClass
metadata: {name: silver}
driverName: fake.csi.example.com
parameters: {iops: "3000", throughput: "125"}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: {name: vac-claim}
spec:
  storageClassName: standard
  volumeAttributesClassName: silver
  accessModes: [ReadWriteOnce]
  resources: {requests: {storage: 100Mi}}
```

```
$ kubectl api-resources | grep -i volumeattributes
volumeattributesclasses   vac   storage.k8s.io/v1   false   VolumeAttributesClass
$ kubectl get vac; kubectl get pvc vac-claim
NAME     DRIVERNAME             AGE
silver   fake.csi.example.com   3s
NAME        STATUS    VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS   VOLUMEATTRIBUTESCLASS   AGE
vac-claim Pending                                      standard       silver                  3s
```

The claim is Pending only because `standard` waits for a Pod. With a real driver, a bound claim whose `volumeAttributesClassName` changes triggers the modification.

## Key fields

Checked with `kubectl explain volumeattributesclass` and `pvc.status` on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| VAC `driverName` | the CSI driver that understands the parameters; cannot change | required |
| VAC `parameters` | driver-specific map such as `iops`, `throughput`; cannot change | required by convention |
| PVC `spec.volumeAttributesClassName` | the class to apply; may change after creation, for bound claims only | unset: no class applied |
| PVC `status.currentVolumeAttributesClassName` | the class the volume currently uses | unset when none |
| PVC `status.modifyVolumeStatus.status` | `Pending` (unmet requirements, such as a missing class), `InProgress` or `Infeasible` (the driver rejected it) | unset: no modification running |

## kubectl

```bash
kubectl get vac                                # DRIVERNAME
kubectl describe vac silver                    # parameters
kubectl get pvc vac-claim -o jsonpath='{.spec.volumeAttributesClassName}{" current="}{.status.currentVolumeAttributesClassName}{" modify="}{.status.modifyVolumeStatus}{"\n"}'
kubectl patch pvc data --type merge -p '{"spec":{"volumeAttributesClassName":"gold"}}'   # on a bound claim
kubectl describe pvc vac-claim                 # events from the resizer
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `The VolumeAttributesClass "silver" is invalid: parameters: Forbidden: updates to parameters are forbidden.` (the same for `driverName`) | A class is immutable once created | Create a new class (for example `gold`) and point the claim at it |
| `The PersistentVolumeClaim "vac-claim" is invalid: spec: Forbidden: spec is immutable after creation except resources.requests and volumeAttributesClassName for bound claims` | The claim is not bound yet (it was Pending), so its class cannot be changed | Bind the claim first (a Pod and a working provisioner), then change the class |
| Claim shows `VOLUMEATTRIBUTESCLASS silver` but `current=` and `modify=` stay empty | No driver that supports `ModifyVolume` handles `fake.csi.example.com`, so no modification starts (this test) | Install a CSI driver with that name and the external-resizer; watch `status.modifyVolumeStatus` (`Pending`, `InProgress`, `Infeasible`) |

## Related

- **Cards:** PersistentVolumeClaim, StorageClass, CSIDriver, CSINode and CSIStorageCapacity
- **Chapter and lab:** Ch 5.4 and Lab 5.4
- **Exam:** no matching row in the coverage matrix; closest is CKA, Storage (10%)
- **Source:** [Volume Attributes Classes](https://kubernetes.io/docs/concepts/storage/volume-attributes-classes/)
