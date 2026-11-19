# Volume types

## What and why

A volume is a directory that containers in a Pod can see. It solves two problems: files vanish when a container restarts, and containers in one Pod need to share files. You declare volumes once in `spec.volumes` and mount them by name in `volumeMounts`.

The volume type decides where the data lives and how long it lasts: `emptyDir` (scratch space, deleted with the Pod), `configMap`, `secret`, `downwardAPI` and `projected` (API data as files), `hostPath` (a path on the node), `image` (an OCI image mounted read-only; stable since v1.36), `ephemeral` (a claim created and deleted with the Pod) and `persistentVolumeClaim` (storage that outlives the Pod). The **kubelet** sets up and mounts every volume before the containers start.

## Diagram

{{diagram volume-types-01.jsx | volume lifetimes · 3 groups}}

Pick the group by how long the data must live: with the Pod, with the node, or beyond the Pod.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). One Pod with five volume types, using the `app-config` ConfigMap from the ConfigMap card:

```yaml
apiVersion: v1
kind: Pod
metadata: {name: vol-demo}
spec:
  containers:
  - name: c
    image: alpine:3.21
    command: [sleep, "3600"]
    volumeMounts:
    - {name: scratch, mountPath: /scratch}
    - {name: ram, mountPath: /ram}
    - {name: cfg, mountPath: /cfg}
    - {name: eph, mountPath: /eph}
    - {name: img, mountPath: /img, readOnly: true}
  volumes:
  - {name: scratch, emptyDir: {}}
  - {name: ram, emptyDir: {medium: Memory, sizeLimit: 16Mi}}
  - {name: cfg, configMap: {name: app-config}}
  - name: eph
    ephemeral:
      volumeClaimTemplate:
        spec:
          accessModes: [ReadWriteOnce]
          resources: {requests: {storage: 100Mi}}
  - name: img
    image: {reference: "alpine:3.21", pullPolicy: IfNotPresent}
```

```
$ kubectl get pod vol-demo; kubectl get pvc
NAME       READY   STATUS    RESTARTS   AGE
vol-demo   1/1     Running   0          12s
NAME           STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   AGE
vol-demo-eph   Bound    pvc-cdc07d2a-cd32-4d12-9591-d6343ba786c7   100Mi      RWO            standard       12s

$ kubectl exec vol-demo -- sh -c 'ls /img | head -3; ls /cfg; mount | grep -E " /(ram|img|cfg) " | cut -c1-70'
bin
dev
etc
greeting
tmpfs on /ram type tmpfs (rw,relatime,size=16384k,noswap)
/dev/sde on /cfg type ext4 (ro,relatime)
overlay on /img type overlay (ro,relatime,lowerdir=/var/lib/containerd/...
```

The `ram` volume is a 16 MiB tmpfs, the ConfigMap mounts read-only, the image volume shows the root filesystem of `alpine:3.21`, and the ephemeral volume created its own claim `vol-demo-eph`, named after the Pod and the volume.

## Key fields

Checked with `kubectl explain pod.spec.volumes` on 1.37 and the Volumes docs.

| Field | Meaning | Default |
| --- | --- | --- |
| `volumes[].name`, `containers[].volumeMounts[]` | the volume's name; where (`mountPath`), whether `readOnly`, which `subPath` | required |
| `emptyDir.medium` | `Memory` backs the directory with tmpfs | `""`: the node's default medium |
| `emptyDir.sizeLimit` | cap on usage; the Pod is evicted when it is exceeded | unset |
| `hostPath.path`, `hostPath.type` | a path on the node; `type` such as `Directory` or `DirectoryOrCreate` checks or creates it | `type` empty: no check |
| `configMap`, `secret`, `downwardAPI`, `projected` | API data as files (see the group 5 cards) | all keys, one file each |
| `ephemeral.volumeClaimTemplate` | a PVC created with the Pod and deleted with it | none |
| `image.reference`, `image.pullPolicy` | an OCI image mounted read-only (stable since v1.36) | `Always` for `:latest`, else `IfNotPresent` |
| `persistentVolumeClaim.claimName`, `readOnly` | a claim in the same namespace | `readOnly` false |

## kubectl

```bash
kubectl describe pod vol-demo | grep -A12 '^Volumes'       # type, medium, size limit of each volume
kubectl get pvc                                             # the claim an ephemeral volume created
kubectl exec vol-demo -- sh -c 'mount | grep /ram'          # what really got mounted
kubectl explain pod.spec.volumes.emptyDir                   # fields of one type
kubectl get pod vol-evict -o jsonpath='{.status.phase} {.status.reason}: {.status.message}{"\n"}'
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pod `Failed`, reason `Evicted`: `Usage of EmptyDir volume "scratch" exceeds the limit "1Mi".` (reproduced: the container wrote 8 MiB; the kubelet evicted it within about a minute) | The Pod wrote more than the `emptyDir.sizeLimit` | Raise the limit, write elsewhere, or use a PVC |
| Pod `Pending`; event `0/3 nodes are available: persistentvolumeclaim "ghost" not found. not found` | The claim named in `persistentVolumeClaim.claimName` does not exist in the namespace | Create the claim or fix the name |
| Pod `ContainerCreating`; event `MountVolume.SetUp failed for volume "d" : hostPath type check failed, /does/not/exist is not a directory, unable to determine its type: path "/does/not/exist" does not exist` | `hostPath.type: Directory`, but the path is missing on that node | Create the path, or use `DirectoryOrCreate`; avoid hostPath for app data |

## Related

- **Cards:** PersistentVolumeClaim, PersistentVolume, Downward API and projected volumes, Pod, kubelet
- **Chapter and lab:** Ch 5.4 and Lab 5.4
- **Exam:** CKA, Storage (10%): volume types, access modes, reclaim policies; CKAD, Application Design and Build (20%): persistent and ephemeral volumes
- **Source:** [Volumes](https://kubernetes.io/docs/concepts/storage/volumes/), [Ephemeral volumes](https://kubernetes.io/docs/concepts/storage/ephemeral-volumes/)
