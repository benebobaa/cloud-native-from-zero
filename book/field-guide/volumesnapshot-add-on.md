# VolumeSnapshot (add-on)

## What and why

VolumeSnapshot is an add-on, not part of the built-in API: it asks for a point-in-time copy of a PVC's data. It needs three things: the `snapshot.storage.k8s.io` CRDs, the **snapshot controller**, and a CSI driver that supports snapshots (with its csi-snapshotter sidecar). Without them the objects are accepted but nothing happens.

Three kinds work like the PV and PVC pair: `VolumeSnapshot` (namespaced request), `VolumeSnapshotContent` (cluster-wide record of the real snapshot) and `VolumeSnapshotClass` (driver and `deletionPolicy`). To restore, you create a new PVC whose `dataSource` names the snapshot.

## Diagram

{{diagram volumesnapshot-add-on-01.jsx | snapshot objects · 6 boxes}}

A VolumeSnapshot binds to a cluster-wide VolumeSnapshotContent, and a new PVC can restore from it.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). A default cluster does not know the snapshot kinds. This test installed the three CRDs from `raw.githubusercontent.com/kubernetes-csi/external-snapshotter/v8.7.0/client/config/crd/` (VolumeSnapshotClass, VolumeSnapshotContent, VolumeSnapshot). It did **not** run the snapshot controller or a snapshot-capable CSI driver, so no snapshot was taken.

```
$ kubectl get volumesnapshot
error: the server doesn't have a resource type "volumesnapshot"
$ kubectl apply -f snap.yaml
resource mapping not found for name: "data-snap" ...: no matches for kind "VolumeSnapshot" in version "snapshot.storage.k8s.io/v1"
ensure CRDs are installed first
$ kubectl apply --server-side -f <the three CRD files>
$ kubectl apply -f snap.yaml
volumesnapshotclass.snapshot.storage.k8s.io/fake-snap created
volumesnapshot.snapshot.storage.k8s.io/data-snap created
```

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata: {name: fake-snap}
driver: fake.csi.example.com
deletionPolicy: Delete
---
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata: {name: data-snap}
spec:
  volumeSnapshotClassName: fake-snap
  source: {persistentVolumeClaimName: data}
```

The API accepts both, but nothing acts on them: `READYTOUSE` is empty, there is no bound content and no events:

```
$ kubectl get volumesnapshotclass,volumesnapshot
NAME                                                    DRIVER                 DELETIONPOLICY   AGE
volumesnapshotclass.snapshot.storage.k8s.io/fake-snap   fake.csi.example.com   Delete           6s
NAME                                               READYTOUSE   SOURCEPVC   SNAPSHOTCLASS   SNAPSHOTCONTENT   AGE
volumesnapshot.snapshot.storage.k8s.io/data-snap                data        fake-snap                         6s
```

## Key fields

Checked with `kubectl explain` on the CRDs of external-snapshotter v8.7.0.

| Field | Meaning | Default |
| --- | --- | --- |
| VolumeSnapshotClass `driver` | the CSI driver that takes the snapshot | required |
| VolumeSnapshotClass `deletionPolicy` | `Delete` or `Retain` for the VolumeSnapshotContent when its VolumeSnapshot is deleted | required |
| VolumeSnapshotClass `parameters` | driver-specific settings | none |
| VolumeSnapshot `spec.source.persistentVolumeClaimName` | dynamic snapshot of this claim (same namespace) | one of the two sources is required |
| VolumeSnapshot `spec.source.volumeSnapshotContentName` | use an existing content object (pre-provisioned snapshot) | see above |
| VolumeSnapshot `spec.volumeSnapshotClassName` | the class to use | unset: the class annotated `snapshot.storage.kubernetes.io/is-default-class: "true"` for the source PVC's CSI driver, if any; two defaults for one driver make the snapshot fail with an event ([VolumeSnapshotClasses](https://kubernetes.io/docs/concepts/storage/volume-snapshot-classes/)) |
| VolumeSnapshot `status.readyToUse`, `boundVolumeSnapshotContentName`, `restoreSize`, `error` | progress and result, written by the controllers | unset until a controller acts |
| VolumeSnapshotContent `spec` | `driver`, `deletionPolicy`, `source`, `volumeSnapshotRef` (all required): the cluster-wide record | made by the controller |
| PVC `spec.dataSource` | `kind: VolumeSnapshot`, `apiGroup: snapshot.storage.k8s.io`: restore into a new claim | none |

## kubectl

```bash
kubectl api-resources | grep snapshot.storage        # are the CRDs installed?
kubectl get volumesnapshotclass,volumesnapshot       # READYTOUSE, SNAPSHOTCONTENT
kubectl get volumesnapshot data-snap -o jsonpath='{.status}'   # empty: nothing acted
kubectl describe volumesnapshot data-snap           # source, class, events
kubectl get volumesnapshotcontent                    # cluster-wide records
kubectl get crd | grep snapshot
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `error: the server doesn't have a resource type "volumesnapshot"`; `no matches for kind "VolumeSnapshot" in version "snapshot.storage.k8s.io/v1"` and `ensure CRDs are installed first` | The snapshot CRDs are not installed: the API is an add-on | Install the CRDs, the snapshot controller and a snapshot-capable CSI driver |
| `VolumeSnapshot` exists but `READYTOUSE` is empty, `kubectl get volumesnapshot data-snap -o jsonpath='{.status}'` prints nothing and `Events: <none>` | The CRDs are there, but no snapshot controller or driver watches them | Deploy the snapshot controller and the driver's csi-snapshotter sidecar; then read `status.error` |
| The snapshot never becomes ready although the controllers run (documented, not reproduced) | The class names a `driver` that differs from the PVC's driver, or the driver has no snapshot support | Use a class whose `driver` equals the PV's CSI driver |

## Related

- **Cards:** PersistentVolumeClaim, CSIDriver, CSINode and CSIStorageCapacity, CustomResourceDefinition (a CRD-based add-on), etcd backup and restore (etcd snapshots are a different thing)
- **Chapter and lab:** none in the coverage matrix (add-on card)
- **Exam:** not named in the [CKA or CKAD v1.37 curriculum](https://github.com/cncf/curriculum) (checked 2026-11-17); KCNA, Container Orchestration (28%)
- **Source:** [Volume Snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
