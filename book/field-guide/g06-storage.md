# 6 · Storage

## How the cards fit together

{{diagram g06-storage-01.jsx | group 6 · how the storage cards relate}}

A Pod mounts a claim; a StorageClass and a CSI driver turn the claim into a PersistentVolume that is attached to the node.

## Cards and where they are taught

| Card | Covers | Chapter | Exam domain |
| --- | --- | --- | --- |
| Volume types | emptyDir, hostPath, projected, ephemeral, image, PVC | Ch 5.4 | CKA: Storage (10%); CKAD: Application Design and Build (20%) |
| PersistentVolume | cluster storage, phases, reclaim policy | Ch 5.4 | CKA: Storage |
| PersistentVolumeClaim | a request for storage, binding | Ch 5.4 | CKA: Storage; CKAD: Application Design and Build |
| StorageClass | dynamic provisioning, default class | Ch 5.4 | CKA: Storage |
| VolumeAttributesClass | change IOPS or throughput of a volume | Ch 5.4 | not named in the CKA or CKAD curriculum |
| CSIDriver, CSINode, CSIStorageCapacity | how drivers describe themselves | Ch 5.4 | CKA: Cluster Architecture (25%), extension interfaces |
| VolumeAttachment | attaching a volume to a node | Ch 5.4 | not named in the CKA or CKAD curriculum |
| VolumeSnapshot (add-on) | point-in-time copies through CSI | not in the matrix (add-on) | not named in the CKA or CKAD curriculum |

All eight also belong to the KCNA domain Container Orchestration (28%). Chapter numbers come from the coverage matrix on the How to use tab.
