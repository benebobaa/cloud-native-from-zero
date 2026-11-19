# Lab 5.4 · Postgres as a StatefulSet and Scheduling Puzzles

## Goal

You will give the wallet's Postgres a disk that outlives its Pod, and then ask the scheduler why Pods go where they do. You will bind a static volume and a dynamic one, delete a StatefulSet Pod and find the rows again, and read the Events of Pods that cannot be placed.

**Versions tested** (2026-11-16, replayed 2026-11-17, Ubuntu 26.04 on WSL2, Docker Desktop): kind v0.33.0 with `kindest/node:v1.37.0` (Kubernetes 1.37.0), kubectl v1.37.1, `postgres:17`, and `wallet:v1` as a plain container. The storage is kind's built-in `rancher.io/local-path` provisioner, which is node-local, so Part B and the Break it show a laptop limit, not a production design. Outputs in Parts A and C come from those runs. The replay on 2026-11-17 ran Part A, the `psql` steps of Part B, the `sed` edit of the scheduler manifest in C2, the taint demo of C3 and the `cordon` in Break it, and every step exited 0. **Versions targeted, not run:** the `nodeTaintsPolicy: Honor` patch in C3.

**Before you start:** you need the three-node cluster from Lab 5.1 (re-create it with `kind create cluster --name cnlab-vol5 --image kindest/node:v1.37.0 --config kind-3nodes.yaml` if you deleted it). Load the images into every node with the method from Lab 5.2:

```bash
for n in control-plane worker worker2; do
  for i in wallet:v1 postgres:17; do
    docker save $i | docker exec -i cnlab-vol5-$n ctr -n k8s.io images import -
  done
done
```

The three nodes are the Docker containers `cnlab-vol5-control-plane`, `cnlab-vol5-worker` and `cnlab-vol5-worker2`. Your volume names and Pod names differ from the outputs below; the shapes do not.

### What you will build

{{diagram lab-5-4-01.jsx | what you will build in Lab 5.4 · three parts, from claim to placement}}

Read each lane from left to right. In Part A a claim meets a volume in two ways. In Part B the Pod is disposable and the claim is not. In Part C the scheduler removes nodes that cannot run the Pod, and a volume that is pinned to a node is one more reason for it to do so.

## Part A · Claims and volumes: static and dynamic (60 min)

You will bind a claim to a volume you made by hand, then to one the cluster makes for you, and watch what each does when the claim is deleted. First read the recipe kind gives you:

```bash
kubectl get storageclass standard -o yaml | grep -E '^(provisioner|reclaimPolicy|volumeBindingMode)|is-default-class: '
```

```text
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: rancher.io/local-path
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
```

**A1 · A static volume.** You play the administrator: one 500Mi volume in a class called `manual`, and two claims, one too large and one that fits. Save this as `pv-static.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: pv-manual-1
spec:
  capacity:
    storage: 500Mi
  accessModes: ["ReadWriteOnce"]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /mnt/pv-manual-1
    type: DirectoryOrCreate
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: claim-too-big
spec:
  storageClassName: manual
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 2Gi
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: claim-fits
spec:
  storageClassName: manual
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 300Mi
```

```bash
kubectl apply -f pv-static.yaml
kubectl get pv
kubectl get pvc
kubectl describe pvc claim-too-big | tail -4
```

The PV controller matched the claim that fits, and the claim got more than it asked for. The other claim waits, and its Event says why:

```text
NAME          CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM                STORAGECLASS   VOLUMEATTRIBUTESCLASS   REASON   AGE
pv-manual-1   500Mi      RWO            Retain           Bound    default/claim-fits   manual         <unset>                          4s
NAME            STATUS    VOLUME        CAPACITY   ACCESS MODES   STORAGECLASS   VOLUMEATTRIBUTESCLASS   AGE
claim-too-big   Pending                                           manual         <unset>                 4s
claim-fits      Bound     pv-manual-1   500Mi      RWO            manual         <unset>                 4s
Events:
  Type     Reason              Age              From                         Message
  ----     ------              ----             ----                         -------
  Warning  ProvisioningFailed  2s (x2 over 5s)  persistentvolume-controller  storageclass.storage.k8s.io "manual" not found
```

1. `claim-fits` asked for 300Mi and shows `CAPACITY 500Mi`. Why? Which three properties did the controller compare?
2. `claim-too-big` is `Pending` forever. Name two different ways to make it bind.

**A2 · A dynamic volume.** Now you are the application team. The claim names no class, so it gets the default one. Save as `pvc-dynamic.yaml` and `writer-pod.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: notes
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 200Mi
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: writer
spec:
  terminationGracePeriodSeconds: 1
  containers:
    - name: c
      image: wallet:v1
      command: ["sh", "-c", "date >> /data/log; cat /data/log; sleep 3600"]
      volumeMounts:
        - name: d
          mountPath: /data
  volumes:
    - name: d
      persistentVolumeClaim:
        claimName: notes
```

Create only the claim first, and look:

```bash
kubectl apply -f pvc-dynamic.yaml
kubectl get pvc notes
kubectl describe pvc notes | tail -4
```

```text
NAME    STATUS    VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS   VOLUMEATTRIBUTESCLASS   AGE
notes   Pending                                      standard       <unset>                 5s
Events:
  Type    Reason                Age              From                         Message
  ----    ------                ----             ----                         -------
  Normal  WaitForFirstConsumer  1s (x2 over 5s)  persistentvolume-controller  waiting for first consumer to be created before binding
```

The claim is not stuck. It waits for a Pod, because the class says `WaitForFirstConsumer`. Create the Pod and look again:

```bash
kubectl apply -f writer-pod.yaml
kubectl wait --for=condition=Ready pod/writer --timeout=60s
kubectl get pvc,pv
```

```text
NAME                          STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   VOLUMEATTRIBUTESCLASS   AGE
persistentvolumeclaim/notes   Bound    pvc-f43cb10e-d153-44f2-87a9-76db19638ac0   200Mi      RWO            standard       <unset>                 13s

NAME                                                        CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM                    STORAGECLASS   VOLUMEATTRIBUTESCLASS   REASON   AGE
persistentvolume/pvc-b44ea182-8e9e-46f4-b90b-5f65ebe8d2cf   1Gi        RWO            Delete           Bound    wallet/data-postgres-0   standard       <unset>                          22m
persistentvolume/pvc-f43cb10e-d153-44f2-87a9-76db19638ac0   200Mi      RWO            Delete           Bound    default/notes            standard       <unset>                          2s
```

The first PV in that listing belongs to the wallet's Postgres from Lab 5.2, if you still have it. The second was created for `notes` the moment the Pod appeared. Read where the provisioner put it, and what the volume now demands of the scheduler:

```bash
PV=$(kubectl get pvc notes -o jsonpath='{.spec.volumeName}')
NODE=$(kubectl get pod writer -o jsonpath='{.spec.nodeName}')
kubectl get pv $PV -o jsonpath='{.spec.nodeAffinity}'; echo
kubectl get pv $PV -o jsonpath='{.spec.hostPath}'; echo
docker exec $NODE ls /var/local-path-provisioner
```

```text
{"required":{"nodeSelectorTerms":[{"matchExpressions":[{"key":"kubernetes.io/hostname","operator":"In","values":["cnlab-vol5-worker2"]}]}]}}
{"path":"/var/local-path-provisioner/pvc-f43cb10e-d153-44f2-87a9-76db19638ac0_default_notes","type":"DirectoryOrCreate"}
pvc-f43cb10e-d153-44f2-87a9-76db19638ac0_default_notes
```

The PV is pinned to one node by `nodeAffinity`, and the data is a directory on that node. The Events of the claim, in order, were `WaitForFirstConsumer`, `ExternalProvisioning`, `Provisioning` and `ProvisioningSucceeded` (read them with `kubectl get events --field-selector involvedObject.name=notes`). Now prove the data belongs to the claim and not to the Pod. The Pod appends a timestamp each time it starts:

```bash
kubectl logs writer
kubectl delete pod writer
kubectl apply -f writer-pod.yaml
kubectl wait --for=condition=Ready pod/writer --timeout=60s
kubectl logs writer
```

```text
Mon Nov 16 07:46:53 UTC 2026
Mon Nov 16 07:46:53 UTC 2026
Mon Nov 16 07:47:00 UTC 2026
```

The first line is the first Pod's log. The next two lines are the new Pod's file: the old timestamp survived the Pod, and the new one was added.

3. At which step did the PV come into existence, and which component created it? Use the Events.
4. With `Immediate` binding instead, the PV would have been created before the Pod existed. Why could that put the volume on a node where the Pod cannot run?

**A3 · What happens to the volume when the claim goes away.** The two volumes have different reclaim policies, so they end differently. Delete the static claim, then the dynamic one (the Pod must go first, because a claim that a Pod still uses is protected):

```bash
kubectl delete pvc claim-fits
kubectl get pv pv-manual-1
kubectl delete pod writer
kubectl delete pvc notes
sleep 6
kubectl get pv $PV
docker exec $NODE ls /var/local-path-provisioner | grep -c notes
```

The `Retain` volume is kept, marked `Released`, and still remembers its old claim. The `Delete` volume and its directory are gone within seconds:

```text
NAME          CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS     CLAIM                STORAGECLASS   VOLUMEATTRIBUTESCLASS   REASON   AGE
pv-manual-1   500Mi      RWO            Retain           Released   default/claim-fits   manual         <unset>                          8s
Error from server (NotFound): persistentvolumes "pvc-f43cb10e-d153-44f2-87a9-76db19638ac0" not found
0
```

The last line is the number of `notes` directories left on the node. Clean up the rest with `kubectl delete pvc claim-too-big` and `kubectl delete pv pv-manual-1`.

5. A `Released` PV is not given to a new claim. Why does Kubernetes refuse, and what must an administrator do before the volume can be reused?
6. Which row of the Ch 5.4 "In production" table did you just reproduce, and what would you change on the class to prevent it?

## Part B · Postgres as a StatefulSet that keeps its disk (50 min)

You will start the wallet's database with a `volumeClaimTemplates` entry, write a row, delete the Pod, and find the row again. If you still have Postgres from Lab 5.2, `kubectl apply` reports the objects as unchanged and you can go on. Save as `postgres.yaml` (the namespace, the settings, the headless Service and the StatefulSet):

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: wallet
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: wallet-config
  namespace: wallet
data:
  POSTGRES_USER: wallet
  POSTGRES_DB: wallet
  POLL_SECONDS: "1"
---
apiVersion: v1
kind: Secret
metadata:
  name: wallet-db
  namespace: wallet
type: Opaque
stringData:
  POSTGRES_PASSWORD: change-me-in-vol6
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: wallet
spec:
  clusterIP: None
  selector:
    app: postgres
  ports:
    - name: pg
      port: 5432
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: wallet
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: postgres
          image: postgres:17
          ports:
            - containerPort: 5432
              name: pg
          envFrom:
            - configMapRef:
                name: wallet-config
            - secretRef:
                name: wallet-db
          env:
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "wallet"]
            periodSeconds: 3
          resources:
            requests: {cpu: 100m, memory: 128Mi}
            limits: {memory: 512Mi}
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 1Gi
```

The Pod has no `volumes:` entry. The StatefulSet controller makes a claim named `data-postgres-0` from the template. `PGDATA` points at a sub-directory because a fresh volume root may contain a `lost+found` directory that Postgres refuses to initialise over.

```bash
kubectl apply -f postgres.yaml
kubectl -n wallet rollout status sts/postgres --timeout=180s
kubectl -n wallet get pod postgres-0 -o wide
kubectl -n wallet get pvc
```

Write a row, delete the Pod, wait for its replacement, and read the row back:

```bash
kubectl exec -n wallet postgres-0 -- psql -U wallet -c "CREATE TABLE notes (id int, msg text); INSERT INTO notes VALUES (1, 'before delete');"
kubectl -n wallet delete pod postgres-0
kubectl -n wallet wait --for=condition=Ready pod/postgres-0 --timeout=120s
kubectl exec -n wallet postgres-0 -- psql -U wallet -c 'SELECT * FROM notes;'
```

The replacement Pod has the same name and a new IP. It mounted the same claim, and the table is still there:

```text
 id |      msg      
----+---------------
  1 | before delete
(1 row)
```

Now find the node that holds the data, and protect the volume from an accidental `kubectl delete pvc`. The default reclaim policy is `Delete`; `kubectl patch` changes it on the live PV to `Retain`:

```bash
PGPV=$(kubectl -n wallet get pvc data-postgres-0 -o jsonpath='{.spec.volumeName}')
kubectl get pv $PGPV -o jsonpath='{.spec.nodeAffinity}'; echo
kubectl patch pv $PGPV -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
kubectl get pv $PGPV
```

The affinity names one node, and the `RECLAIM POLICY` column now says `Retain`.

1. The StatefulSet's Pod template has no `volumes:` entry for the data. Where does the Pod's volume come from, and what is the claim named?
2. After the Pod was deleted, what stayed the same: the Pod name, the Pod IP, the claim, the PV, the node?
3. Why is `Retain` the safer policy for a database, and who must clean up the volume by hand afterwards?

## Part C · Why is my Pod Pending? Reading the scheduler (60 min)

You will create two Pods that cannot be placed, read the scheduler's own explanation, fix one of them with a label, and then turn the scheduler's log up to see a successful decision. Save this as `sched-demo.yaml`. `too-big` asks for 64 CPUs. `picky` insists on a node label that no node has:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: too-big
spec:
  containers:
    - name: c
      image: wallet:v1
      command: ["sleep", "3600"]
      resources:
        requests:
          cpu: "64"
          memory: 1Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: picky
spec:
  nodeSelector:
    disktype: ssd
  containers:
    - name: c
      image: wallet:v1
      command: ["sleep", "3600"]
```

```bash
kubectl apply -f sched-demo.yaml
kubectl get pods
kubectl get events --field-selector reason=FailedScheduling -o custom-columns=POD:.involvedObject.name,MSG:.message
```

Both Pods stay `Pending`. The scheduler wrote one sentence for each, and every node is accounted for:

```text
NAME      READY   STATUS    RESTARTS   AGE
too-big   0/1     Pending   0          4s
picky     0/1     Pending   0          4s
POD       MSG
picky     0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 node(s) didn't match Pod's node affinity/selector. preemption: 0/3 nodes are available: 3 Preemption is not helpful for scheduling.
too-big   0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 Insufficient cpu. preemption: 0/3 nodes are available: 3 Preemption is not helpful for scheduling.
```

Read the sentences as a count: the three nodes split into reasons, and the numbers add up to 3. The control-plane node is out for both because it carries a taint that these Pods do not tolerate. Now give `picky` a node to match. The scheduler is not restarted; it notices the change by watching Nodes:

```bash
kubectl label node cnlab-vol5-worker disktype=ssd
kubectl get pod picky -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,NODE:.spec.nodeName
kubectl label node cnlab-vol5-worker disktype-
```

```text
node/cnlab-vol5-worker labeled
NAME    STATUS    NODE
picky   Running   cnlab-vol5-worker
node/cnlab-vol5-worker unlabeled
```

The trailing `-` removed the label again. `picky` keeps running: the label only mattered at the moment of choosing. Delete both demo Pods with `kubectl delete pod picky too-big`.

1. Add up the node counts in each message. Do they always sum to 3? Which reason covers the control-plane node in both messages?
2. `too-big` says `Insufficient cpu` for the two workers. Are the workers busy? Which command shows what the scheduler compares, and is it usage or requests?
3. Why did `picky` start without being re-created?

**C2 · Watch the scheduler decide.** The scheduler is a static Pod on the control-plane node, so you change its log level by editing its manifest. The kubelet notices the file change and restarts it. Add `--v=10` to the command, wait for the Pod, and create a Pod that can be placed. Save this as `newcomer.yaml`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: newcomer
spec:
  terminationGracePeriodSeconds: 1
  containers:
    - name: c
      image: wallet:v1
      command: ["sleep", "3600"]
      resources:
        requests:
          cpu: "1"
```

```bash
docker exec cnlab-vol5-control-plane sed -i 's/^    - kube-scheduler$/    - kube-scheduler\n    - --v=10/' /etc/kubernetes/manifests/kube-scheduler.yaml
kubectl -n kube-system get pod kube-scheduler-cnlab-vol5-control-plane
kubectl apply -f newcomer.yaml
kubectl -n kube-system logs kube-scheduler-cnlab-vol5-control-plane | grep newcomer | grep -E 'Attempting to schedule|untolerated|Plugin scored|final score|Attempting to bind' | cut -c1-200
```

Real output of the filtered log, shortened (timestamps and the logger prefix cut; `...` marks lines left out):

```text
"Attempting to schedule pod" pod="default/newcomer"
"node had untolerated taints" ... pod="default/newcomer" node="cnlab-vol5-control-plane" untolerated ...
"Plugin scored node for pod" ... plugin="TaintToleration" node="cnlab-vol5-worker2" score=300
"Plugin scored node for pod" ... plugin="NodeResourcesFit" node="cnlab-vol5-worker2" score=92
...
"Plugin scored node for pod" ... plugin="NodeResourcesFit" node="cnlab-vol5-worker" score=90
...
"Calculated node's final score for pod" ... node="cnlab-vol5-worker2" score=465
"Calculated node's final score for pod" ... node="cnlab-vol5-worker" score=463
"Attempting to bind pod to node" ... pod="default/newcomer" node="cnlab-vol5-worker2"
```

In this run five of the six plugins gave both workers the same score (`TaintToleration` 300, `VolumeBinding` 0, `DynamicResources` 0, `NodeResourcesBalancedAllocation` 73, `ImageLocality` 0). Only `NodeResourcesFit` differed, 92 against 90, and that made the final scores 465 and 463.

The filtered log has the same shape as the excerpt in Ch 5.4 "The scheduler, one Pod at a time": one `Attempting to schedule` line, a line that removes the control-plane node because of its taint, a score per plugin for each worker, two final scores, and `Attempting to bind pod to node` for the winner. Your scores differ because your nodes hold different Pods. When you have read it, put the manifest back so that the scheduler stops logging at level 10:

```bash
docker exec cnlab-vol5-control-plane sed -i '/--v=10/d' /etc/kubernetes/manifests/kube-scheduler.yaml
kubectl delete pod newcomer
```

4. Which line shows the Filter step removing a node, and which shows the Score step? Which plugin gave the same score to both workers?
5. Which line is the binding, and what HTTP request does it make to the API server? Compare its time to the first line.

**C3 · Spread and taints.** Two more rules decide placement. A *topology spread constraint* limits how unevenly a Deployment's Pods may sit across nodes. A *taint* on a node keeps out every Pod that does not carry a matching toleration. Save these as `spread.yaml` (four replicas, at most one Pod of difference between nodes) and `taint-demo.yaml` (three replicas that tolerate a taint named `dedicated=db`):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: spread
spec:
  replicas: 4
  selector:
    matchLabels:
      app: spread
  template:
    metadata:
      labels:
        app: spread
    spec:
      terminationGracePeriodSeconds: 1
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: spread
      containers:
        - name: c
          image: wallet:v1
          command: ["sleep", "3600"]
```

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tolerant
spec:
  replicas: 3
  selector:
    matchLabels:
      app: tolerant
  template:
    metadata:
      labels:
        app: tolerant
    spec:
      terminationGracePeriodSeconds: 1
      tolerations:
        - key: dedicated
          operator: Equal
          value: db
          effect: NoSchedule
      containers:
        - name: c
          image: wallet:v1
          command: ["sleep", "3600"]
```

Predict first: two workers, four Pods, at most one apart. Where should they go? Then run it:

```bash
kubectl apply -f spread.yaml
kubectl get pods -l app=spread -o custom-columns=STATUS:.status.phase,NODE:.spec.nodeName --no-headers | sort | uniq -c
```

```text
      2 Pending <none>
      1 Running cnlab-vol5-worker
      1 Running cnlab-vol5-worker2
```

The Events of the two Pending Pods say `1 node(s) had untolerated taint(s), 2 node(s) didn't match pod topology spread constraints`.

Only two Pods run. The cause is a default that surprises everyone once: the constraint counts the control-plane node as a place with zero Pods, even though its taint keeps these Pods out. A third Pod on either worker would be two apart from that empty node, so the rule blocks it. Tell the constraint to leave tainted nodes out of the count with `nodeTaintsPolicy: Honor`, and the Pending Pods can be placed:

```bash
kubectl patch deploy spread --type merge -p '{"spec":{"template":{"spec":{"topologySpreadConstraints":[{"maxSkew":1,"topologyKey":"kubernetes.io/hostname","whenUnsatisfiable":"DoNotSchedule","nodeTaintsPolicy":"Honor","labelSelector":{"matchLabels":{"app":"spread"}}}]}}}}'
kubectl rollout status deploy/spread --timeout=60s
kubectl get pods -l app=spread -o custom-columns=STATUS:.status.phase,NODE:.spec.nodeName --no-headers | sort | uniq -c
kubectl delete -f spread.yaml
```

Now the taint. Put `dedicated=db:NoSchedule` on `worker2`, then start the Deployment that tolerates it:

```bash
kubectl taint nodes cnlab-vol5-worker2 dedicated=db:NoSchedule
kubectl apply -f taint-demo.yaml
kubectl rollout status deploy/tolerant --timeout=60s
kubectl get pods -l app=tolerant -o custom-columns=NODE:.spec.nodeName --no-headers | sort | uniq -c
kubectl taint nodes cnlab-vol5-worker2 dedicated=db:NoSchedule-
kubectl delete -f taint-demo.yaml
```

The tolerant Pods may use `worker2`, and in the measured run they did:

```text
      1 cnlab-vol5-worker
      2 cnlab-vol5-worker2
```

A Pod without the toleration would have stayed off `worker2`. The trailing `-` on the second `taint` command removes the taint again.

6. Why did two of the four `spread` Pods stay Pending when two workers were free? Which node did the constraint count that you did not expect?
7. A toleration lets a Pod onto a tainted node. Does it make the Pod go there? Use the `tolerant` result to answer.
8. A StatefulSet's Pod needs the node that holds its volume. Which of the three mechanisms in Part C (selector, taint, spread) can the volume's `nodeAffinity` conflict with?

## Checkpoint

You are done when all of these hold. Save your commands, outputs and answers in `lab-5.4.md`.

| Check | Expected |
| --- | --- |
| `kubectl get pvc claim-fits` (before you delete it) | `Bound`, `VOLUME pv-manual-1`, `CAPACITY 500Mi` |
| `kubectl describe pvc notes \| tail -4` before the `writer` Pod exists | an Event `WaitForFirstConsumer` from `persistentvolume-controller` |
| `kubectl logs writer` after you deleted and re-created the Pod | two timestamps, the older one first |
| `kubectl get pv pv-manual-1` after deleting `claim-fits` | `STATUS Released`, `RECLAIM POLICY Retain` |
| `kubectl get pv $PV` after deleting `notes` | `Error from server (NotFound)` |
| `kubectl exec -n wallet postgres-0 -- psql -U wallet -c 'SELECT * FROM notes;'` after deleting the Pod | one row, `1 \| before delete` |
| `kubectl get pv $PGPV -o jsonpath='{.spec.persistentVolumeReclaimPolicy}'` | `Retain` |
| `kubectl get events --field-selector reason=FailedScheduling` for `picky` and `too-big` | `didn't match Pod's node affinity/selector` and `Insufficient cpu` |
| the filtered scheduler log from C2 | a line `Attempting to bind pod to node` for `newcomer`, after the `untolerated` line for the control-plane node |
| `kubectl get pods -l app=spread` after the `nodeTaintsPolicy: Honor` patch | no Pod is `Pending` |
| Notebook | Answers to all questions in Parts A to C and Break it |

## Break it: the database that cannot move

You have seen that the Postgres volume is pinned to one node. Now take that node away from the scheduler without touching Postgres:

```bash
PGNODE=$(kubectl -n wallet get pod postgres-0 -o jsonpath='{.spec.nodeName}')
kubectl cordon $PGNODE
kubectl -n wallet delete pod postgres-0
kubectl -n wallet get pod postgres-0 -o wide
kubectl -n wallet get events --field-selector reason=FailedScheduling -o custom-columns=POD:.involvedObject.name,MSG:.message
```

`kubectl cordon` marks the node unschedulable but leaves its Pods alone. The new `postgres-0` stays `Pending`, with this Event (a drain of the same node in Lab 5.5 produces the identical sentence):

```text
POD          MSG
postgres-0   0/3 nodes are available: 1 node(s) didn't match PersistentVolume's node affinity, 1 node(s) had untolerated taint(s), 1 node(s) were unschedulable. preemption: 0/3 nodes are available: 3 Preemption is not helpful for scheduling.
```

Nothing is broken. Put the node back and the Pod starts, with its data:

```bash
kubectl uncordon $PGNODE
kubectl -n wallet wait --for=condition=Ready pod/postgres-0 --timeout=120s
kubectl exec -n wallet postgres-0 -- psql -U wallet -c 'SELECT * FROM notes;'
```

1. Take the three counts in the Event one by one. Which node is each count about, and which rule excluded it?
2. Which of the three reasons would disappear if the volume were replicated storage that any node can attach?
3. Write the sentence you would put in a runbook: "If a database Pod is Pending after a node problem, first check ...".
4. Leave Postgres running. Lab 5.5 drains the node that holds it.
