# PersistentVolumeClaim

## What and why

A PersistentVolumeClaim (PVC) is a request for storage: a size, access modes and, optionally, a StorageClass. The Pod names only the claim, so the same Pod spec works on a laptop and in a cloud.

The **PV controller** binds the claim to a PV; with a StorageClass and a provisioner, the PV is created on demand. The claim is namespaced, the PV is not. A claim in use by a Pod cannot be deleted at once: the finalizer `kubernetes.io/pvc-protection` keeps it Terminating until no Pod uses it. When the StorageClass uses `WaitForFirstConsumer`, binding waits until a Pod that uses the claim is scheduled.

## Diagram

{{diagram persistentvolumeclaim-01.jsx | dynamic provisioning · 6 steps}}

Follow the numbers: the claim waits for a Pod, then storage is created, bound and mounted.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). kind ships a default StorageClass `standard` (provisioner `rancher.io/local-path`, `WaitForFirstConsumer`). A claim and a Pod that uses it:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata: {name: data}
spec:
  accessModes: [ReadWriteOnce]
  resources: {requests: {storage: 200Mi}}
---
apiVersion: v1
kind: Pod
metadata: {name: writer}
spec:
  containers:
  - name: c
    image: alpine:3.21
    command: [sh, -c, "echo hello > /data/hello.txt; sleep 3600"]
    volumeMounts: [{name: d, mountPath: /data}]
  volumes: [{name: d, persistentVolumeClaim: {claimName: data}}]
```

The claim waits for the Pod, then the provisioner creates a PV and the claim binds. The events show the order:

```
$ kubectl describe pvc data | tail -4
  Normal  WaitForFirstConsumer   4s  persistentvolume-controller  waiting for first consumer to be created before binding
  Normal  Provisioning           4s  rancher.io/local-path_...    External provisioner is provisioning volume for claim "default/data"
  Normal  ExternalProvisioning   2s  persistentvolume-controller  Waiting for a volume to be created either by the external provisioner 'rancher.io/local-path' or manually ...
  Normal  ProvisioningSucceeded  2s  rancher.io/local-path_...    Successfully provisioned volume pvc-fe875085-6178-41a3-be11-d13ff1dad403

$ kubectl get pv -o custom-columns=NAME:.metadata.name,CAP:.spec.capacity.storage,RECLAIM:.spec.persistentVolumeReclaimPolicy,CLASS:.spec.storageClassName,PHASE:.status.phase
NAME                                       CAP     RECLAIM   CLASS      PHASE
pvc-fe875085-6178-41a3-be11-d13ff1dad403   200Mi   Delete    standard   Bound
```

The PV was made on demand with the class's `Delete` policy, so deleting the claim (after the Pod) removed the PV too: `kubectl get pv` no longer listed it.

## Key fields

Checked with `kubectl explain pvc.spec` on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.accessModes` | modes the volume must support: `ReadWriteOnce`, `ReadOnlyMany`, `ReadWriteMany`, `ReadWriteOncePod` | required |
| `spec.resources.requests.storage` | the size wanted | required |
| `spec.storageClassName` | the StorageClass to provision from; `""` means no class | unset: the default StorageClass is used |
| `spec.volumeMode` | `Filesystem` or raw `Block` | `Filesystem` |
| `spec.volumeName` | bind to one named PV (static binding) | unset |
| `spec.selector` | label selector over PVs to consider for binding | none |
| `spec.dataSource` / `dataSourceRef` | create the volume from a VolumeSnapshot or another PVC | none |
| `spec.volumeAttributesClassName` | VolumeAttributesClass to apply; can change after creation | none |
| `status.phase` | `Pending`, `Bound` or `Lost` | set by the PV controller |

## kubectl

```bash
kubectl apply -f pvc.yaml
kubectl get pvc,pv                          # STATUS, VOLUME, STORAGECLASS
kubectl describe pvc data                   # the Events explain a Pending claim
kubectl get pvc data -o jsonpath='{.metadata.finalizers}{"\n"}'   # kubernetes.io/pvc-protection
kubectl patch pvc data -p '{"spec":{"resources":{"requests":{"storage":"1Gi"}}}}'   # expand, if the class allows
kubectl get sc                              # ALLOWVOLUMEEXPANSION and VOLUMEBINDINGMODE
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| Claim `Pending`; event `Warning ProvisioningFailed persistentvolume-controller storageclass.storage.k8s.io "fast" not found` | `storageClassName: fast` names a class that does not exist | Create the class or use an existing one (`kubectl get sc`) |
| `Error from server (Forbidden): persistentvolumeclaims "data" is forbidden: only dynamically provisioned pvc can be resized and the storageclass that provisions the pvc must support resize` | The class has `allowVolumeExpansion: false` (kind's `standard` shows `false`) | Use a class with `allowVolumeExpansion: true` and a driver that supports resizing |
| `kubectl delete pvc data` returns but the claim stays `Terminating`; `finalizers` shows `["kubernetes.io/pvc-protection"]` | A Pod still uses the claim; the finalizer protects it | Delete the Pod first; the claim then goes away (here the PV too, because of `Delete`) |

## Related

- **Cards:** PersistentVolume, StorageClass, VolumeAttributesClass, StatefulSet (volumeClaimTemplates), Volume types
- **Chapter and lab:** Ch 5.4 and Lab 5.4
- **Exam:** CKA, Storage (10%): persistent volumes and claims; CKAD, Application Design and Build (20%): persistent and ephemeral volumes
- **Source:** [Persistent Volumes: claims](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
