# PersistentVolume

## What and why

A PersistentVolume (PV) is a piece of cluster storage with its own lifecycle, independent of any Pod. An admin creates it by hand (static) or a provisioner creates it on demand (dynamic). It is cluster-scoped and records capacity, access modes, volume mode, node affinity and the backend (a CSI driver, NFS, `local`, `hostPath`).

The **PV controller** in kube-controller-manager binds each PersistentVolumeClaim to one matching PV. After the claim is deleted, `persistentVolumeReclaimPolicy` decides what happens: `Retain` keeps the PV and its data for manual clean-up (the default for a PV you create), `Delete` removes the PV and the backing volume (what a StorageClass sets unless told otherwise).

## Diagram

{{diagram persistentvolume-01.jsx | PersistentVolume phases · 5 boxes}}

A PV is Available until a claim binds it, becomes Released when the claim goes, and then follows its reclaim policy.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). A static PV backed by a node directory, and a claim for part of it:

```yaml
apiVersion: v1
kind: PersistentVolume
metadata: {name: pv-manual}
spec:
  capacity: {storage: 1Gi}
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath: {path: /tmp/pv-manual, type: DirectoryOrCreate}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: {name: claim-a}
spec:
  storageClassName: manual
  accessModes: [ReadWriteOnce]
  resources: {requests: {storage: 500Mi}}
```

The claim binds, a Pod uses it, and after the claim is deleted the PV is Released but not free:

```
$ kubectl get pv,pvc | grep manual
persistentvolume/pv-manual   1Gi   RWO   Retain   Bound   default/claim-a   manual   3s
persistentvolumeclaim/claim-a   Bound   pv-manual   1Gi   RWO   manual   3s

$ kubectl delete pod pv-user; kubectl delete pvc claim-a; kubectl get pv pv-manual
NAME        CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS     CLAIM             STORAGECLASS
pv-manual   1Gi        RWO            Retain           Released   default/claim-a   manual
```

The old `claimRef` still points at the deleted claim, so a new claim stays Pending until you clear it:

```
$ kubectl patch pv pv-manual --type json -p '[{"op":"remove","path":"/spec/claimRef"}]'
$ kubectl get pvc claim-b
NAME      STATUS   VOLUME      CAPACITY   ACCESS MODES   STORAGECLASS   AGE
claim-b   Bound    pv-manual   1Gi        RWO            manual         8s
```

The PV stayed `Retain` throughout. At the end, `kubectl delete pv pv-manual` removed only the API object.

## Key fields

Checked with `kubectl explain pv.spec` on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.capacity.storage` | size the volume offers | required |
| `spec.accessModes` | ways it can be mounted: `ReadWriteOnce`, `ReadOnlyMany`, `ReadWriteMany`, `ReadWriteOncePod` | required |
| `spec.persistentVolumeReclaimPolicy` | `Retain`, `Delete`, or `Recycle` (deprecated) | `Retain` for a PV you create, `Delete` for dynamically provisioned ones |
| `spec.volumeMode` | `Filesystem` or raw `Block` | `Filesystem` |
| `spec.storageClassName` | the class this PV belongs to; empty means none | none |
| `spec.nodeAffinity.required` | which nodes can reach the volume; the scheduler honours it | none |
| `spec.claimRef` | the bound claim; set on binding, still set when `Released` | set by the PV controller |
| `spec.mountOptions` | mount options, not validated; a bad one makes the mount fail | none |
| `status.phase` | `Pending`, `Available`, `Bound`, `Released`, `Failed` | set by the PV controller |

## kubectl

```bash
kubectl get pv                                  # STATUS, CLAIM, RECLAIM POLICY
kubectl describe pv pv-manual                   # source, node affinity, events
kubectl get pv pv-manual -o jsonpath='{.status.phase} claimRef={.spec.claimRef.name}{"\n"}'
kubectl patch pv pv-manual --type json -p '[{"op":"remove","path":"/spec/claimRef"}]'   # make a Released PV Available
kubectl patch pv pv-manual -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'  # protect data before deleting a claim
kubectl delete pv pv-manual                     # removes the object only for Retain
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| PV `Released`, never reused; the next claim stays `Pending` | `Retain` keeps the old `claimRef` and the data, so the PV is not offered again | Copy the data if needed, then clear `spec.claimRef` (or delete and recreate the PV) |
| Claim `Pending` with the event `Warning ProvisioningFailed persistentvolume-controller storageclass.storage.k8s.io "manual" not found` (reproduced with a 5Gi claim against a 1Gi PV) | No PV with a matching class, enough size and access mode is free, and no StorageClass named `manual` can provision one | Create a PV that fits, ask for less, or create the StorageClass |
| Data lost after deleting a claim (documented, not reproduced) | The PV had `persistentVolumeReclaimPolicy: Delete` (the default for dynamically provisioned volumes), so the backing volume was removed with the claim | Set `Retain` on volumes whose data matters, or snapshot first |

## Related

- **Cards:** PersistentVolumeClaim, StorageClass, Volume types, CSIDriver, CSINode and CSIStorageCapacity
- **Chapter and lab:** Ch 5.4 and Lab 5.4
- **Exam:** CKA, Storage (10%): persistent volumes and claims; volume types, access modes, reclaim policies
- **Source:** [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
