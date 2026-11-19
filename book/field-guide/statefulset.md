# StatefulSet

## What and why

A database replica is not interchangeable: it needs the same name, the same address and the same disk after every restart. A **StatefulSet** gives each Pod a stable ordinal name (`db-0`, `db-1`), a DNS entry through a headless Service, and its own PersistentVolumeClaim created from `volumeClaimTemplates`.

The StatefulSet controller (in `kube-controller-manager`) creates Pods in order and, by default, waits for each to be Ready before starting the next; scale-down goes in reverse. It records each template version as a ControllerRevision. PVCs are kept when Pods are deleted unless you set a retention policy.

## Diagram

{{diagram statefulset-01.jsx | StatefulSet identity · 3 Pods, 3 volumes}}
Each ordinal gets a stable Pod name, a PVC of its own and a DNS record from the headless Service; Pods start in order and stop in reverse.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). kind's default StorageClass `standard` provisions the volumes.

```yaml
apiVersion: v1
kind: Service
metadata: {name: db}
spec:
  clusterIP: None            # headless: gives each Pod a DNS name
  selector: {app: db}
  ports: [{port: 5432, name: pg}]
---
apiVersion: apps/v1
kind: StatefulSet
metadata: {name: db}
spec:
  serviceName: db
  replicas: 3
  selector: {matchLabels: {app: db}}
  template:
    metadata: {labels: {app: db}}
    spec:
      containers:
      - name: c
        image: alpine:3.21
        command: ["sh","-c","echo $(hostname) > /data/who; sleep 3600"]
        volumeMounts: [{name: data, mountPath: /data}]
  volumeClaimTemplates:
  - metadata: {name: data}
    spec:
      accessModes: [ReadWriteOnce]
      resources: {requests: {storage: 100Mi}}
```

```
$ kubectl delete pod db-1; sleep 15; kubectl get pods -l app=db
NAME   READY   STATUS    RESTARTS   AGE
db-0   1/1     Running   0          41s
db-1   1/1     Running   0          11s       <- same name, new Pod
db-2   1/1     Running   0          6s
$ kubectl exec db-0 -- nslookup db-1.db.t3d.svc.cluster.local | tail -3
Address: 10.244.0.28
$ kubectl scale sts db --replicas=1; sleep 12; kubectl get pods -l app=db; kubectl get pvc
db-0   1/1   Running       0   55s
db-1   1/1   Running       0   25s
db-2   1/1   Terminating   0   20s          <- highest ordinal goes first
NAME        STATUS   VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS
data-db-0   Bound    pvc-602e...   100Mi   RWO   standard
data-db-1   Bound    pvc-d55e...   100Mi   RWO   standard
data-db-2   Bound    pvc-5ae9...   100Mi   RWO   standard       <- PVCs outlive the Pods
```

Data survives a Pod replacement (a separate one-replica StatefulSet `kv`):

```
$ kubectl exec kv-0 -- sh -c 'echo remember-me > /data/marker; hostname'
remember-me   kv-0
$ kubectl delete pod kv-0; kubectl wait --for=condition=Ready pod/kv-0 --timeout=90s; kubectl exec kv-0 -- cat /data/marker
remember-me
```

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.serviceName` | Headless Service that gives Pods their DNS names | required |
| `spec.replicas` | Number of Pods | 1 |
| `spec.podManagementPolicy` | `OrderedReady` (one at a time, in order) or `Parallel` | `OrderedReady` |
| `spec.updateStrategy` | `RollingUpdate` or `OnDelete` | `RollingUpdate` |
| `spec.volumeClaimTemplates[]` | Template for one PVC per Pod | none |
| `spec.persistentVolumeClaimRetentionPolicy` | Whether PVCs are deleted on scale-down or set deletion (`whenScaled`, `whenDeleted`) | `Retain` for both |
| `spec.minReadySeconds` | Seconds a Pod must be ready to count as available | 0 |
| `spec.revisionHistoryLimit` | Revisions kept | 10 |
| `spec.ordinals.start` | First ordinal number | 0 |

Defaults are from `kubectl explain` and the v1.37.0 OpenAPI spec.

## kubectl

```
kubectl apply -f sts.yaml
kubectl get sts db                          # READY n/m
kubectl get pods -l app=db                  # db-0, db-1, ... in order
kubectl get pvc                             # data-db-0 ... one per Pod
kubectl scale sts db --replicas=1           # scale down removes the highest ordinal first
kubectl rollout status sts/db   kubectl rollout history sts/db   kubectl rollout undo sts/db
kubectl describe sts db                     # Events: SuccessfulCreate, FailedCreate
kubectl exec db-0 -- nslookup db-1.db       # stable DNS name of a peer
kubectl delete sts db --cascade=orphan      # not run: keep the Pods
kubectl delete pvc -l app=db                # PVCs are NOT deleted with the set by default
```

## How it fails

Rows one and two were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubectl get sts blocked` shows `0/3`, `kubectl get pods` lists only `blocked-0 0/1 Running` after 20 s | `OrderedReady` creates a Pod only after the previous one is Ready; here a readiness probe (`false`) never passes, so `blocked-1` is never created | Fix the readiness check, or use `podManagementPolicy: Parallel` if order does not matter |
| `db-0` is `Pending`; its PVC `data-nopv-0` is `Pending` with `storageClassName: fast-ssd`; events: pod `FailedScheduling ... pod has unbound immediate PersistentVolumeClaims` and PVC `ProvisioningFailed ... storageclass.storage.k8s.io "fast-ssd" not found` | The `volumeClaimTemplates` name a StorageClass that does not exist | Create the StorageClass or correct the name; the template of an existing StatefulSet cannot be edited, so delete and re-create the set (and its PVC) |
| After scaling down or deleting the StatefulSet its PVCs are still there (`data-db-1`, `data-db-2` stayed `Bound`) and a later scale-up re-attaches them (not reproduced) | `persistentVolumeClaimRetentionPolicy` defaults to `Retain` for both `whenDeleted` and `whenScaled` | Delete the PVCs yourself, or set the policy to `Delete` |

## Related

- **Cards:** Pod; Service (group 4, headless Service); DNS for Services and Pods (group 4); PersistentVolumeClaim and StorageClass (group 6); ControllerRevision and PodTemplate.
- **Chapter and lab:** Chapter 5.2 and Lab 5.2 (Vol 5); storage details in Chapter 5.4.
- **Exam domain:** KCNA Kubernetes Fundamentals; CKAD Application Design and Build, choose a workload resource.
