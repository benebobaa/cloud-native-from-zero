# Lab 5.2 · Deploying and Updating the Wallet

## Goal

You will deploy the wallet's API, worker and database as Kubernetes workloads, watch who owns which Pod, update the API without dropping requests and undo a bad release. Then you run a node agent, a Job, a CronJob and a StatefulSet, and see probes and memory limits act on real containers.

**Versions tested** (2026-11-16 and 2026-11-17, Ubuntu 26.04 on WSL2, Docker Desktop): kind v0.33.0, node image `kindest/node:v1.37.0` (Kubernetes v1.37.0, containerd 2.3.4), kubectl v1.37.1, images `wallet:v1` and `postgres:17`. Every output below came from those runs. On 2026-11-16: Part A (the wallet apply, owners, the three delete lanes), Part B (both rollouts, `wallet:nope`, `rollout undo`), Part C (all four objects) and, in Part D, the `hungry` and `flaky` Pods. On 2026-11-17, in a replay where every step exited 0: the `call` helper and the label experiment of Part A, the delete timings (`time`), the Postgres outage and the `slow` Pod of Part D, and the whole of Break it. On Ubuntu 24.04 the Pod name suffixes, IP addresses and ages differ, the shapes do not.

**Before you start:** a Docker Engine, `kubectl` 1.37.1, `kind` 0.33.0 (installed in Lab 5.1) and the image `wallet:v1` from Vol 4 (`docker build -t wallet:v1 wallet/` if `docker images wallet:v1` shows nothing). Keep two terminals open and 8 GB of RAM free.

### What you will build

{{diagram lab-5-2-01.jsx | what you will build in Lab 5.2 · wallet workloads, scratch workloads and one broken release}}

Everything you type goes through `kubectl`. The wallet lives in its own namespace. The scratch objects of Parts C and D live in `default`, so you can delete them without touching the wallet.

## Part A · Deploy the wallet and meet the owners (50 min)

You will start a fresh cluster, deploy the wallet's three workloads, and prove with your own commands who owns which Pod.

Start from a fresh cluster so that nothing is left over from Lab 5.1. Reuse the `kind-3nodes.yaml` file you wrote there:

```bash
kind delete cluster --name cnlab-vol5
cd ~/cn-lab/k8s
kind create cluster --name cnlab-vol5 --image kindest/node:v1.37.0 --config kind-3nodes.yaml
for n in control-plane worker worker2; do
  docker save wallet:v1 | docker exec -i cnlab-vol5-$n ctr -n k8s.io images import -
done
mkdir -p wallet && cd wallet
```

Now write the wallet's objects, one file per concern. The first two are a namespace and the configuration; Ch 5.3 explains the Secret, so copy them as they are. Save as `00-namespace.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: wallet
```

Save as `01-config.yaml`:

```yaml
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
stringData:                # stringData is encoded to base64 by the API server
  POSTGRES_PASSWORD: change-me-in-vol6
```

Postgres needs a stable name and its own disk, so it is a StatefulSet (Part C explains the object). The headless Service `postgres` (`clusterIP: None`) gives it a DNS name. Save as `02-postgres.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: wallet
spec:
  clusterIP: None            # headless: DNS returns the Pod IP, no virtual IP
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
              value: /var/lib/postgresql/data/pgdata   # a sub-directory: the volume root holds lost+found on some storage
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

The API is stateless, so it is a Deployment of two Pods. It carries the two probes of Ch 5.2: readiness asks `/readyz` (does the database answer?) and liveness asks `/healthz` (is the process alive?). The Service `wallet-api` is the stable address in front of the Pods. Save as `03-api.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wallet-api
  namespace: wallet
spec:
  replicas: 2
  selector:
    matchLabels:
      app: wallet-api
  template:
    metadata:
      labels:
        app: wallet-api
    spec:
      containers:
        - name: api
          image: wallet:v1
          command: ["python3", "api.py"]
          ports:
            - containerPort: 8080
              name: http
          env:
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: wallet-db
                  key: POSTGRES_PASSWORD
            - name: DATABASE_URL          # $(VAR) is expanded by the kubelet from env entries defined above
              value: postgresql://wallet:$(POSTGRES_PASSWORD)@postgres:5432/wallet
          readinessProbe:
            httpGet: {path: /readyz, port: http}
            periodSeconds: 2
            failureThreshold: 2
          livenessProbe:
            httpGet: {path: /healthz, port: http}
            periodSeconds: 10
          resources:
            requests: {cpu: 50m, memory: 64Mi}
            limits: {memory: 128Mi}
---
apiVersion: v1
kind: Service
metadata:
  name: wallet-api
  namespace: wallet
spec:
  selector:
    app: wallet-api
  ports:
    - name: http
      port: 80
      targetPort: http
```

The worker is also stateless, but it takes no traffic and has no probes. Save as `04-worker.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wallet-worker
  namespace: wallet
spec:
  replicas: 2
  selector:
    matchLabels:
      app: wallet-worker
  template:
    metadata:
      labels:
        app: wallet-worker
    spec:
      containers:
        - name: worker
          image: wallet:v1
          command: ["python3", "worker.py"]
          env:
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: wallet-db
                  key: POSTGRES_PASSWORD
            - name: DATABASE_URL
              value: postgresql://wallet:$(POSTGRES_PASSWORD)@postgres:5432/wallet
            - name: POLL_SECONDS
              valueFrom:
                configMapKeyRef:
                  name: wallet-config
                  key: POLL_SECONDS
          resources:
            requests: {cpu: 50m, memory: 64Mi}
            limits: {memory: 128Mi}
```

Apply the namespace, the configuration and the database first, wait for Postgres, then apply the API and the worker:

```bash
kubectl apply -f 00-namespace.yaml -f 01-config.yaml -f 02-postgres.yaml
kubectl -n wallet rollout status sts/postgres --timeout=120s
kubectl apply -f 03-api.yaml -f 04-worker.yaml
kubectl -n wallet rollout status deploy/wallet-api --timeout=120s
kubectl -n wallet rollout status deploy/wallet-worker --timeout=120s
kubectl -n wallet get pods -L app
```

You should see `postgres-0`, two `wallet-api-...` and two `wallet-worker-...` Pods, all `1/1 Running`. Look at the ReplicaSets the Deployments created. Their names are `<deployment>-<pod-template-hash>`, and the selector includes that hash:

A worker Pod can show `RESTARTS 1` in the first minute. In the 2026-11-17 replay one showed `1 (2s ago)` four seconds after the apply: it exited once early, Kubernetes restarted it, and it ran normally afterwards. One early restart is not a fault.

```bash
kubectl -n wallet get rs -o wide
```

```text
NAME                       DESIRED   CURRENT   READY   AGE   CONTAINERS   IMAGES      SELECTOR
wallet-api-ffd6cb76b       2         2         0       10s   api          wallet:v1   app=wallet-api,pod-template-hash=ffd6cb76b
wallet-worker-6cbdf67665   2         2         2       9s    worker       wallet:v1   app=wallet-worker,pod-template-hash=6cbdf67665
```

(The `READY 0` of the API was captured 10 seconds after the apply, while its first Pods still waited for the database. Yours will differ.) Pick one worker Pod and print who owns it:

```bash
WP=$(kubectl -n wallet get pod -l app=wallet-worker -o name | head -1)
kubectl -n wallet get $WP -o jsonpath='{.metadata.ownerReferences}'
```

The answer names a ReplicaSet with `"controller":true` and `"kind":"ReplicaSet"`, the way the theory showed it. Before you break anything, check that the wallet works. Define a helper that sends one HTTP request from inside the cluster (from a worker Pod, through the `wallet-api` Service), then create two accounts and one transfer:

```bash
call() { kubectl -n wallet exec deploy/wallet-worker -- python3 -c '
import sys,urllib.request as u
req=u.Request("http://wallet-api"+sys.argv[1],data=sys.argv[2].encode() if len(sys.argv)>2 else None,headers={"Content-Type":"application/json"})
try:
    r=u.urlopen(req); print(r.status,r.read().decode().strip())
except u.HTTPError as e:
    print(e.code,e.read().decode().strip()[:50].replace("\n"," "))
' "$@"; }
call /readyz
call /accounts '{"name":"alice","balance":100}'
call /accounts '{"name":"bob","balance":0}'
call /transfers '{"id":"t-1","from":"alice","to":"bob","amount":10}'
sleep 3
call /transfers/t-1
call /accounts/bob
```

You should see `200 {"status": "ready"}`, two `201` lines, a `202` for the transfer, and a few seconds later the transfer `settled` and Bob's balance `10`. The worker Pods settle transfers; the API only records them.

```text
200 {"status": "ready"}
201 {"name": "alice"}
201 {"name": "bob"}
202 {"id": "t-1", "status": "pending"}
200 {"id": "t-1", "from": "alice", "to": "bob", "amount": 10, "status": "settled"}
200 {"name": "bob", "balance": 10}
```

**Delete a Pod.** The ReplicaSet counts the Pods that match its selector, sees one missing and creates a new one:

```bash
kubectl -n wallet delete $WP
kubectl -n wallet get pods -l app=wallet-worker
```

```text
pod "wallet-worker-6cbdf67665-n75m9" deleted from wallet namespace
NAME                             READY   STATUS    RESTARTS   AGE
wallet-worker-6cbdf67665-27ww8   1/1     Running   0          1s
wallet-worker-6cbdf67665-pq6zz   1/1     Running   0          11s
```

The list shows two worker Pods again: one old, one with a new name and an `AGE` of a few seconds. **Change a label.** A ReplicaSet finds its Pods by label, not by name. Take one Pod out of the set by changing its label, and see what the ReplicaSet does:

```bash
WP=$(kubectl -n wallet get pod -l app=wallet-worker -o name | head -1)
kubectl -n wallet label $WP app=stray --overwrite
kubectl -n wallet get pods -L app
kubectl -n wallet delete $WP
```

```text
pod/wallet-worker-6cbdf67665-27ww8 labeled
NAME                             READY   STATUS    RESTARTS   AGE   APP
postgres-0                       1/1     Running   0          57s   postgres
wallet-api-ffd6cb76b-58g8m       1/1     Running   0          15s   wallet-api
wallet-api-ffd6cb76b-lxtmk       1/1     Running   0          15s   wallet-api
wallet-worker-6cbdf67665-27ww8   1/1     Running   0          5s    stray
wallet-worker-6cbdf67665-brtvq   1/1     Running   0          3s    wallet-worker
wallet-worker-6cbdf67665-pq6zz   1/1     Running   0          15s   wallet-worker
```

The Pod with `app=stray` is still `Running`, but the ReplicaSet no longer counts it, so a third Pod appears with `app=wallet-worker`. You just orphaned a Pod: nothing owns it any more (its `ownerReferences` entry was removed when the label stopped matching). The last command removes it.

**Delete the owner.** Now the three lanes of the ownership drawing in Ch 5.2, on a scratch Deployment in the `default` namespace. Save as `web.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      terminationGracePeriodSeconds: 2
      containers:
        - name: c
          image: wallet:v1
          command: ["python3", "-m", "http.server", "8080"]
          readinessProbe:
            tcpSocket: {port: 8080}
            initialDelaySeconds: 1
```

Lane 1: the default delete removes the whole tree, in the background. Lane 2: `--cascade=orphan` removes only the top. Lane 3: applying the same file again lets a new Deployment adopt the surviving ReplicaSet.

```bash
kubectl apply -f web.yaml
kubectl rollout status deploy/web
kubectl delete deploy web
kubectl get deploy,rs,pods -l app=web          # lane 1: nothing left

kubectl apply -f web.yaml
kubectl rollout status deploy/web
kubectl delete deploy web --cascade=orphan
kubectl get rs,pods -l app=web                 # lane 2: ReplicaSet and Pods survive
kubectl apply -f web.yaml
kubectl get deploy,rs,pods -l app=web          # lane 3: same ReplicaSet, new owner
```

```text
# lane 2, after the orphan delete
replicaset.apps/web-578c74cfcd   2   2
pod/web-578c74cfcd-tr4hj         1/1 Running
pod/web-578c74cfcd-xgjth         1/1 Running

# lane 3, after the second apply: the Deployment found its old ReplicaSet
web-578c74cfcd   2     2     2     25s
```

In lane 3 the new Deployment has the same selector and the same Pod template, so it computes the same hash, finds the ReplicaSet `web-578c74cfcd` and adopts it: no Pod restarted. Production teams use this trick to recreate a Deployment (to change its immutable selector, for example) without restarting any Pod. Remove the scratch Deployment with a plain `kubectl delete deploy web`.

1. Why does the replacement Pod of the worker have a different name, but the same labels and the same Pod template?
2. After you changed the label to `app=stray`, who created the third Pod, and who now owns the stray one? Check with `kubectl get pod <name> -o jsonpath='{.metadata.ownerReferences}'`.
3. In lane 2, why do the Pods keep running after the Deployment is gone? Which object would you delete to stop them?
4. Read the ReplicaSet selector in the table above. What stops the old and the new ReplicaSet of one Deployment from claiming each other's Pods?

## Part B · Roll out a new version, then a bad one (45 min)

You will update the wallet API twice with two different rollout settings, compare how many Pods stay Ready, and then ship an image that does not exist and undo it.

Scale the API to four replicas, so the percentages mean something, and wait until it is ready:

```bash
kubectl -n wallet scale deploy/wallet-api --replicas=4
kubectl -n wallet rollout status deploy/wallet-api
```

**Default settings.** `maxSurge` and `maxUnavailable` are both 25% by default. With four replicas that allows one extra Pod (a percentage of `maxSurge` rounds up) and one missing Pod (`maxUnavailable` rounds down). Any change to the Pod template starts a rollout; setting an environment variable is the smallest change. Start the rollout and watch the Deployment's own counters for 30 seconds (`-w` prints a new line each time they change; `timeout` stops it):

```bash
kubectl -n wallet set env deploy/wallet-api RELEASE=r2
timeout 30 kubectl -n wallet get deploy wallet-api -w
kubectl -n wallet rollout status deploy/wallet-api
kubectl -n wallet get rs -l app=wallet-api
kubectl -n wallet rollout history deploy/wallet-api
```

In the `-w` output the `READY` column dips to `3/4` while old Pods leave and new ones start: the controller was allowed to remove one Pod at once. After the rollout there are two ReplicaSets, the new one with 4 Pods and the old one with 0, and `rollout history` lists two revisions. The Ch 5.2 chart shows the same run from watch events: with these defaults the count of Ready Pods touched 3.

**Surge by one, never below four.** Now forbid any loss of capacity. A `patch` changes one field of a live object; it changes the strategy only, not the Pod template, so it starts no rollout. Then repeat the update with a new value:

```bash
kubectl -n wallet patch deploy wallet-api -p '{"spec":{"strategy":{"rollingUpdate":{"maxSurge":1,"maxUnavailable":0}}}}'
kubectl -n wallet set env deploy/wallet-api RELEASE=r3
timeout 30 kubectl -n wallet get deploy wallet-api -w
kubectl -n wallet rollout status deploy/wallet-api
```

This time `READY` stays at `4/4` for the whole rollout, and the Pod list never shows more than five Pods that are not terminating. The price is time and one spare Pod's worth of CPU and memory. The chart in Ch 5.2 (measured in this part, two runs) shows both shapes side by side.

**A bad release.** Roll out an image tag that does not exist. Watch what the controller does when new Pods never become Ready:

```bash
kubectl -n wallet set image deploy/wallet-api api=wallet:nope
kubectl -n wallet rollout status deploy/wallet-api --timeout=40s
kubectl -n wallet get pods -l app=wallet-api
kubectl -n wallet get deploy wallet-api
```

```text
Waiting for deployment "wallet-api" rollout to finish: 1 out of 4 new replicas have been updated...
error: timed out waiting for the condition

NAME                          READY   STATUS             RESTARTS   AGE
wallet-api-8454cbcd7c-z6x4p   0/1     ImagePullBackOff   0          31s
wallet-api-ffd6cb76b-hk5vk    1/1     Running            0          66s
wallet-api-ffd6cb76b-jxdf7    1/1     Running            0          67s
wallet-api-ffd6cb76b-pzsqk    1/1     Running            0          72s
wallet-api-ffd6cb76b-wndxt    1/1     Running            0          71s

NAME         READY   UP-TO-DATE   AVAILABLE   AGE
wallet-api   4/4     1            4           3m13s
```

One new Pod is stuck in `ImagePullBackOff` and four old Pods still serve: `maxUnavailable: 0` forbade removing any of them, so users noticed nothing. The Deployment does not roll back by itself. After `progressDeadlineSeconds` (600 s by default) it only reports that it failed to progress. Read the reason in the new Pod's Events, then undo:

```bash
kubectl -n wallet describe pod -l app=wallet-api | grep -E 'Failed|BackOff' | head -3
kubectl -n wallet rollout undo deploy/wallet-api
kubectl -n wallet rollout status deploy/wallet-api
kubectl -n wallet get rs -l app=wallet-api
call /accounts/alice
```

```text
deployment.apps/wallet-api rolled back
deployment "wallet-api" successfully rolled out
NAME                       DESIRED   CURRENT   READY   AGE
wallet-api-8454cbcd7c      0         0         0       31s
wallet-api-845c6cfc4f      0         0         0       105s
wallet-api-ffd6cb76b       4         4         4       3m13s
```

`kubectl` printed a warning about `last-applied-configuration` before `deployment.apps/wallet-api rolled back`. It says that the file you applied no longer matches the live object: from now on, change the Pod template through the file or `kubectl set`, not by mixing both. The old ReplicaSet `ffd6cb76b` is the one that serves again, and the bad one is kept at 0 Pods in the history.

1. With the default 25% / 25% and 4 replicas, what is the lowest number of Ready Pods during an update? Show the arithmetic and the rounding.
2. Which Pods did users reach during the `wallet:nope` rollout, and why did the rollout not take them down?
3. `rollout undo` brought back an old ReplicaSet instead of creating a new one. Which Deployment field decides how many old ReplicaSets are kept?
4. Your CI pipeline runs `kubectl set image` and then `kubectl rollout status --timeout=120s`. What must the pipeline do when that command fails, and why does Kubernetes not do it for you?

## Part C · One per node, run once, keep a name (50 min)

You will run the three other workload kinds and see the promise each one makes: one Pod on every node, work that ends, and Pods with a stable name and disk. The objects go in the `default` namespace, so the wallet stays untouched.

**DaemonSet.** A node agent must run exactly once on every node. Save as `daemonset.yaml` (the toleration lets it run on the control-plane node, which normally refuses ordinary Pods):

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-agent
spec:
  selector:
    matchLabels:
      app: node-agent
  template:
    metadata:
      labels:
        app: node-agent
    spec:
      terminationGracePeriodSeconds: 1
      tolerations:
        - key: node-role.kubernetes.io/control-plane
          operator: Exists
          effect: NoSchedule
      containers:
        - name: c
          image: wallet:v1
          command: ["sh", "-c", "echo agent on $NODE; sleep 3600"]
          env:
            - name: NODE
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
```

```bash
kubectl apply -f daemonset.yaml
kubectl rollout status ds/node-agent
kubectl get ds node-agent
kubectl get pods -l app=node-agent -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,NODE:.spec.nodeName
```

```text
NAME         DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE
node-agent   3         3         3       3            3           <none>          9s
NAME               STATUS    NODE
node-agent-2ch7n   Running   cnlab-vol5-worker
node-agent-g46vh   Running   cnlab-vol5-control-plane
node-agent-s7687   Running   cnlab-vol5-worker2
```

`DESIRED` is the number of nodes, not a number you chose. **Job and CronJob.** A Job runs Pods until a number of them have finished successfully; a CronJob starts a Job on a clock. Save as `job-cron.yaml`:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: reconcile-report
spec:
  completions: 3
  parallelism: 2
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: c
          image: wallet:v1
          command: ["python3", "-c", "import os,time; print('report from', os.environ['HOSTNAME']); time.sleep(2)"]
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-audit
spec:
  schedule: "* * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 2
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: c
              image: wallet:v1
              command: ["python3", "-c", "import datetime; print('audit at', datetime.datetime.utcnow().isoformat())"]
```

```bash
kubectl apply -f job-cron.yaml
kubectl wait --for=condition=complete job/reconcile-report --timeout=60s
kubectl get job reconcile-report
kubectl get pods -l job-name=reconcile-report
kubectl logs -l job-name=reconcile-report --prefix
```

```text
NAME               STATUS     COMPLETIONS   DURATION   AGE
reconcile-report   Complete   3/3           11s        14s
NAME                     READY   STATUS      RESTARTS   AGE
reconcile-report-4std9   0/1     Completed   0          9s
reconcile-report-8ss55   0/1     Completed   0          14s
reconcile-report-sgj48   0/1     Completed   0          14s
report from reconcile-report-4std9
report from reconcile-report-8ss55
report from reconcile-report-sgj48
```

The Job asked for three completions, two at a time, so you see three finished Pods (`Completed`, not `Running`: nothing restarts them). The CronJob's schedule `* * * * *` means every minute. Wait for the first tick, or run the Job template now:

```bash
kubectl get cronjob nightly-audit
kubectl create job audit-now --from=cronjob/nightly-audit
kubectl wait --for=condition=complete job/audit-now --timeout=60s
kubectl logs job/audit-now
```

```text
NAME            SCHEDULE    TIMEZONE   SUSPEND   ACTIVE   LAST SCHEDULE   AGE
nightly-audit   * * * * *   <none>     False     0        24s             69s
NAME                     STATUS     COMPLETIONS   DURATION   AGE
nightly-audit-29913571   Complete   1/1           3s         25s
reconcile-report         Complete   3/3           11s        70s
[pod/nightly-audit-29913571-r8s8z/c] audit at 2026-11-16T07:31:00.769730
```

(That output came from the automatic tick `nightly-audit-29913571`, which the lab saw 25 seconds after its start; your `audit-now` Job prints the same kind of line.) The `successfulJobsHistoryLimit: 2` of the CronJob keeps only the last two finished Jobs.

**StatefulSet.** Postgres in the wallet is already one. This one has three copies, each with a stable name and its own 100 Mi disk. The Pods start in order (`ledger-0`, then `ledger-1`, then `ledger-2`), and each one writes its boot time to a file on its disk. Save as `sts-demo.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: ledger
spec:
  clusterIP: None
  selector:
    app: ledger
  ports:
    - port: 8080
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ledger
spec:
  serviceName: ledger
  replicas: 3
  selector:
    matchLabels:
      app: ledger
  template:
    metadata:
      labels:
        app: ledger
    spec:
      terminationGracePeriodSeconds: 1
      containers:
        - name: c
          image: wallet:v1
          command: ["sh", "-c", 'echo "boot $HOSTNAME $(date +%T)" >> /data/boots; exec python3 -m http.server 8080 --directory /data']
          volumeMounts:
            - name: data
              mountPath: /data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 100Mi
```

```bash
kubectl apply -f sts-demo.yaml
kubectl rollout status sts/ledger --timeout=120s
kubectl get pods -l app=ledger -o wide
kubectl get pvc
```

```text
NAME       READY   STATUS    RESTARTS   AGE   IP            NODE                 NOMINATED NODE   READINESS GATES
ledger-0   1/1     Running   0          39s   10.244.2.18   cnlab-vol5-worker2   <none>           <none>
ledger-1   1/1     Running   0          34s   10.244.1.20   cnlab-vol5-worker    <none>           <none>
ledger-2   1/1     Running   0          29s   10.244.2.20   cnlab-vol5-worker2   <none>           <none>
NAME            STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   VOLUMEATTRIBUTESCLASS   AGE
data-ledger-0   Bound    pvc-b9036a63-188d-459e-b872-a0a6100aa0b8   100Mi      RWO            standard       <unset>                 39s
data-ledger-1   Bound    pvc-7900a6eb-d1f8-41f5-9bab-42085e362914   100Mi      RWO            standard       <unset>                 34s
data-ledger-2   Bound    pvc-525a1251-43ff-4df1-83a5-02f6111e6437   100Mi      RWO            standard       <unset>                 29s
```

The ages show the order: each Pod started about five seconds after the one before. There is one PVC (the disk claim) per Pod, named `data-<pod>`. Now the name. A headless Service gives each Pod its own DNS name, `ledger-1.ledger`, and the Service name alone returns all three addresses. Ask from a temporary Pod:

```bash
kubectl run dnstest --image=wallet:v1 --restart=Never --rm -i -- python3 -c "import socket; print(socket.gethostbyname_ex('ledger-1.ledger.default.svc.cluster.local')); print(socket.gethostbyname_ex('ledger.default.svc.cluster.local'))"
```

```text
ledger-1.ledger ['10.244.1.25']
ledger ['10.244.1.25', '10.244.2.24', '10.244.2.26']
```

(`kubectl` also prints a short notice that the session is recorded in the container's logs; it is not part of the answer.) The name is stable, and so is the disk. Delete `ledger-1` and see what comes back:

```bash
kubectl get pod ledger-1 -o jsonpath='{.status.podIP} {.metadata.uid}{"\n"}'
kubectl delete pod ledger-1
kubectl wait --for=condition=Ready pod/ledger-1 --timeout=60s
kubectl get pod ledger-1 -o jsonpath='{.status.podIP} {.metadata.uid}{"\n"}'
kubectl exec ledger-1 -- cat /data/boots
```

```text
10.244.1.25 59efb4ff-1acc-4b09-86ec-c423f9d379ef
10.244.1.26 8ae6b10f-6f0b-4c25-b2ef-fa9020667e15
boot ledger-1 07:29:29
boot ledger-1 07:29:39
```

The Pod got a new IP address and a new `uid`, but the same name, and it mounted the same disk: `/data/boots` holds the first boot and the second. Last, scale down and see what happens to the disks:

```bash
kubectl scale sts/ledger --replicas=1
kubectl get pods -l app=ledger
kubectl get pvc
kubectl get sts ledger -o jsonpath='{.spec.persistentVolumeClaimRetentionPolicy}{"\n"}'
```

```text
NAME       READY   STATUS    RESTARTS   AGE
ledger-0   1/1     Running   0          38s
NAME            STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   VOLUMEATTRIBUTESCLASS   AGE
data-ledger-0   Bound    pvc-13279215-5760-4155-a12c-2f663a3c2e85   100Mi      RWO            standard       <unset>                 39s
data-ledger-1   Bound    pvc-76bfcf94-8afa-4524-8773-957e81c74aa9   100Mi      RWO            standard       <unset>                 34s
data-ledger-2   Bound    pvc-77c7a468-7a88-4054-99be-3bb51efe0eb0   100Mi      RWO            standard       <unset>                 29s
{"whenDeleted":"Retain","whenScaled":"Retain"}
```

Two Pods are gone, but all three disks remain: the default retention policy keeps them, so scaling back up gives each Pod its old data. Clean up the scratch objects (the wallet stays):

```bash
kubectl delete sts/ledger svc/ledger ds/node-agent cronjob/nightly-audit
kubectl delete job --all
kubectl delete pvc --all
```

1. The DaemonSet shows `DESIRED 3` on a cluster you built with three nodes. What would it show after you add a fourth node, and who creates the new Pod?
2. The Job finished with `3/3` and its Pods are `Completed`. Why would a Deployment be the wrong object for this work?
3. Which fields in `job-cron.yaml` decide how many Pods run at once and how many failures are tolerated?
4. `ledger-1` came back with a new IP address and a new `uid`. Why does a client that uses `ledger-1.ledger` not care?
5. After `kubectl scale sts/ledger --replicas=1` the PVCs `data-ledger-1` and `data-ledger-2` still exist. Why is Retain the safe default for a database?

## Part D · Probes, limits and a clean shutdown (50 min)

You will see the kubelet act on a memory limit, on a failing probe and on a SIGTERM, with Pods small enough to read at a glance.

**A memory limit.** This Pod allocates memory in a loop and has a 50 MiB limit. It is the experiment of Lab 1.2 in Kubernetes words. Save as `oom.yaml`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hungry
spec:
  containers:
    - name: c
      image: wallet:v1
      command: ["python3", "-c", "b=[]\nwhile True: b.append(bytearray(10**6))"]
      resources:
        limits:
          memory: 50Mi
```

```bash
kubectl apply -f oom.yaml
sleep 30
kubectl get pod hungry
kubectl get pod hungry -o jsonpath='{.status.containerStatuses[0].lastState.terminated}{"\n"}'
```

```text
NAME     READY   STATUS      RESTARTS      AGE
hungry   0/1     OOMKilled   2 (24s ago)   26s
{"containerID":"containerd://41dcff...","exitCode":137,"finishedAt":"2026-11-16T07:31:34Z","reason":"OOMKilled","startedAt":"2026-11-16T07:31:34Z"}
```

`OOMKilled`, exit code 137 (128 + 9, `SIGKILL`) and a growing restart count: the kernel ended the process, and the kubelet restarted the container inside the same Pod. Keep watching for a few minutes: the status changes to `CrashLoopBackOff` and the gaps between restarts double, from 10 s towards the 300 s cap. Delete it with `kubectl delete pod hungry --now` when you have seen enough.

**A failing probe.** This Pod serves a file `/ok` for 20 seconds after it starts, then deletes the file. Both probes ask for `/ok`. Save as `probe-demo.yaml`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: flaky
spec:
  containers:
    - name: c
      image: wallet:v1
      # healthy for 20 s after start, then /ok disappears and returns 404
      command:
        - sh
        - -c
        - |
          mkdir -p /tmp/srv && cd /tmp/srv && touch ok
          (sleep 20; rm -f /tmp/srv/ok) &
          exec python3 -m http.server 8080
      readinessProbe:
        httpGet: {path: /ok, port: 8080}
        periodSeconds: 2
        failureThreshold: 2
      livenessProbe:
        httpGet: {path: /ok, port: 8080}
        periodSeconds: 3
        failureThreshold: 3
        initialDelaySeconds: 5
```

```bash
kubectl apply -f probe-demo.yaml
kubectl get pods flaky -w          # press Ctrl+C after about 90 seconds
kubectl get events --field-selector reason=Unhealthy
kubectl get pod flaky -o jsonpath='{.status.containerStatuses[0].restartCount}{"\n"}'
```

`READY` goes from `1/1` to `0/1` about 20 seconds after the start: the readiness probe failed twice (`failureThreshold: 2`, every 2 s) and the Pod left every Service. Later the liveness probe failed three times and the kubelet restarted the container. Sampled every 4 seconds in the lab:

```text
t=20s flaky   1/1   Running   0     21s
t=24s flaky   0/1   Running   0     25s
t=28s flaky   0/1   Running   0     30s
t=44s flaky   0/1   Running   0     47s
...
flaky   0/1   Running   1 (8s ago)   51s
```

The first restart showed up at about 43 s, and the Events say why:

```text
REASON      MSG
Unhealthy   Readiness probe failed: HTTP probe failed with statuscode: 404
Unhealthy   Liveness probe failed: HTTP probe failed with statuscode: 404
Killing     Container c failed liveness probe, will be restarted
```

The Ch 5.2 chart shows the whole timeline: the new container only started about 30 seconds after the `Killing` event. The process in this Pod is `python3 -m http.server`, started with `exec`, so it is PID 1 of its container. PID 1 has no default signal handlers, so it ignores `SIGTERM`, and the kubelet waited the full `terminationGracePeriodSeconds` (30 s) before `SIGKILL`. Time a delete of this Pod, and then of a wallet API Pod, which does handle `SIGTERM`:

```bash
time kubectl delete pod flaky
WA=$(kubectl -n wallet get pod -l app=wallet-api -o name | head -1)
time kubectl -n wallet delete $WA
```

The first delete takes about 30 seconds, the full grace period (31.1 s in the 2026-11-17 replay). The wallet API Pod leaves in one to two and a half seconds (1.2 s in the replay, 2.4 s in the chapter's rollout measurement): its Python code catches `SIGTERM`, stops its server and exits.

**Readiness against liveness on the wallet.** The wallet API has two probes on purpose: `/readyz` needs Postgres, `/healthz` does not. Stop the database and watch what each probe does. Use the `call` helper from Part A:

```bash
kubectl -n wallet scale sts/postgres --replicas=0
sleep 25
kubectl -n wallet get pods
call /healthz
call /readyz
kubectl -n wallet scale sts/postgres --replicas=1
kubectl -n wallet rollout status sts/postgres --timeout=120s
sleep 8
kubectl -n wallet get pods
```

```text
NAME                             READY   STATUS    RESTARTS   AGE
wallet-api-ffd6cb76b-58g8m       0/1     Running   0          82s
wallet-api-ffd6cb76b-8zjdh       0/1     Running   0          66s
wallet-api-ffd6cb76b-k57jj       0/1     Running   0          66s
wallet-api-ffd6cb76b-lxtmk       0/1     Running   0          82s
wallet-worker-6cbdf67665-brtvq   1/1     Running   0          70s
wallet-worker-6cbdf67665-pq6zz   1/1     Running   0          82s

# call /healthz  (call /readyz prints the same)
Traceback (most recent call last):
  ...
ConnectionRefusedError: [Errno 111] Connection refused
...
urllib.error.URLError: <urlopen error [Errno 111] Connection refused>
command terminated with exit code 1

# after scaling Postgres back to 1
NAME                             READY   STATUS    RESTARTS   AGE
postgres-0                       1/1     Running   0          9s
wallet-api-ffd6cb76b-58g8m       1/1     Running   0          95s
...
```

Both `call` lines fail with a Python traceback that ends in `Connection refused`, `/healthz` included: the Service has no ready Pod, so nothing answers, although `/healthz` itself does not need the database. The worker Pods stay `1/1` because they have no probes. Tracebacks are long: the `...` marks lines left out.

While Postgres is gone, the API Pods show `0/1` and `RESTARTS 0`: readiness failed, so no Service routes to them, but liveness (`/healthz`) kept passing, so the kubelet did not restart them. The `call` goes through the Service and finds no ready Pod, so it fails. When Postgres is back, the Pods return to `1/1` by themselves. Had liveness asked for the database, every API Pod would have restarted in a storm and fixed nothing.

**preStop and SIGTERM.** A `preStop` hook runs before the `SIGTERM` is sent, and its time counts against the grace period. Save as `slow.yaml`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: slow
spec:
  containers:
    - name: c
      image: wallet:v1
      command: ["sh", "-c", "trap 'echo $(date +%T) got SIGTERM; exit 0' TERM; echo $(date +%T) started; while true; do sleep 1; done"]
      lifecycle:
        preStop:
          exec:
            command: ["sh", "-c", "echo $(date +%T) preStop begins > /proc/1/fd/1; sleep 5"]
```

```bash
kubectl apply -f slow.yaml
kubectl wait --for=condition=Ready pod/slow --timeout=30s
kubectl logs -f slow > slow.log &
sleep 2
time kubectl delete pod slow
cat slow.log
```

```text
pod "slow" deleted from default namespace
real    0m6.507s
07:05:41 started
07:05:43 preStop begins
07:05:49 got SIGTERM
```

`slow.log` should show `started`, then `preStop begins`, and six seconds later `got SIGTERM` (the hook sleeps five seconds): the hook delayed the signal. The delete took 6.5 seconds in the replay.

1. `hungry` restarted inside the same Pod and the same node. Which component restarted it, and which object would have created a replacement Pod?
2. In the `flaky` Pod, the readiness probe failed before the liveness probe did. Why, and what could a user of a Service notice in between?
3. Why does the wallet's liveness probe not check the database, and what would you see if it did?
4. A team's Pods always take 30 seconds to stop. Give two possible causes, and the one command line change that fixes the most common one (hint: `exec`).
5. In the `slow` Pod, what happens if the `preStop` hook sleeps for 40 seconds and the grace period is 30?

## Checkpoint

You are done when all of these hold. Keep your answers to the questions of Parts A to D, and the YAML files, in `~/cn-lab/k8s/wallet/`.

| Check | Expected |
| --- | --- |
| `kubectl -n wallet get pods` after Break it step 3 | `postgres-0`, four `wallet-api-...` and two `wallet-worker-...` Pods, all `1/1 Running` |
| `kubectl -n wallet get rs -l app=wallet-api` after the `wallet:nope` undo | one ReplicaSet with `DESIRED 4` and `READY 4`; the others show `0` |
| `kubectl get ds node-agent` (before the clean-up) | `DESIRED 3`, `READY 3` |
| `kubectl get job reconcile-report` | `Complete`, `3/3` |
| `kubectl get pvc` after scaling `ledger` to 1 | three `data-ledger-N` claims, all `Bound` |
| `kubectl get pod hungry -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}'` | `OOMKilled` |
| `time kubectl delete pod flaky` | about 30 s (the grace period), not 2 s |
| Break it, step 1: `kubectl -n wallet rollout status deploy/wallet-api --timeout=45s` | the rollout does not finish; four old Pods stay `1/1`; `call /accounts/alice` still answers `200` |
| Break it, step 2: the same command | `successfully rolled out`, all Pods `1/1`, but `call /accounts/alice` answers `404` |

## Break it: the release that passed the port check

A rollout is only as safe as its readiness probe, because the controller trusts the probe to say when the new Pod can take traffic. You will ship a broken release twice: first with the wallet's real probes, then with a lazy port check. First make sure the wallet works (`call /accounts/alice` prints `200` and Alice's balance). The Deployment still has `maxSurge: 1` and `maxUnavailable: 0` from Part B.

**Step 1: the real probes.** The "release" starts the wrong program: a plain web server on port 8080 instead of `api.py`. Change the container command in the Pod template:

```bash
kubectl -n wallet patch deploy wallet-api --type json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/command","value":["python3","-m","http.server","8080"]}]'
kubectl -n wallet rollout status deploy/wallet-api --timeout=45s
kubectl -n wallet get pods -l app=wallet-api
call /accounts/alice
```

```text
deployment.apps/wallet-api patched
Waiting for deployment "wallet-api" rollout to finish: 1 out of 4 new replicas have been updated...
error: timed out waiting for the condition

NAME                         READY   STATUS    RESTARTS   AGE
wallet-api-8696f5fd4-g8vhh   0/1     Running   0          45s
wallet-api-ffd6cb76b-8zjdh   1/1     Running   0          2m18s
wallet-api-ffd6cb76b-k57jj   1/1     Running   0          2m18s
wallet-api-ffd6cb76b-lxtmk   1/1     Running   0          2m34s
wallet-api-ffd6cb76b-zcsgd   1/1     Running   0          47s
200 {"name": "alice", "balance": 90}
```

The new Pod still showed `RESTARTS 0` after 45 seconds: the liveness restarts begin later.

The new Pod listens on 8080, but `/readyz` returns 404, so the readiness probe fails and the Pod never becomes Ready. `rollout status` times out, the four old Pods stay `1/1`, and the call still answers `200`. Users notice nothing. Because `/healthz` also returns 404, the kubelet keeps restarting the new container after a while: the Pod stays `0/1` with a growing `RESTARTS`. Undo:

```bash
kubectl -n wallet rollout undo deploy/wallet-api
kubectl -n wallet rollout status deploy/wallet-api
```

```text
Warning: resource deployments/wallet-api was previously managed with 'kubectl apply'. Rolling back will not update the kubectl.kubernetes.io/last-applied-configuration annotation, ...
deployment.apps/wallet-api rolled back
deployment "wallet-api" successfully rolled out
```

**Step 2: the lazy probe.** Now ship the same broken program, but with the probes a hurried team might write: readiness only checks that port 8080 accepts a connection, and the liveness probe is removed because "it restarts things for no reason". A single `patch` changes the command and both probes:

```bash
kubectl -n wallet patch deploy wallet-api -p '{"spec":{"template":{"spec":{"containers":[{"name":"api","command":["python3","-m","http.server","8080"],"readinessProbe":{"httpGet":null,"tcpSocket":{"port":"http"}},"livenessProbe":null}]}}}}'
kubectl -n wallet rollout status deploy/wallet-api --timeout=90s
kubectl -n wallet get pods -l app=wallet-api
call /accounts/alice
call /readyz
```

```text
deployment.apps/wallet-api patched
Waiting for deployment "wallet-api" rollout to finish: 1 out of 4 new replicas have been updated...
...
Waiting for deployment "wallet-api" rollout to finish: 1 old replicas are pending termination...
deployment "wallet-api" successfully rolled out

NAME                          READY   STATUS        RESTARTS   AGE
wallet-api-5bd4b6d77d-cbv57   1/1     Running       0          3s
wallet-api-5bd4b6d77d-cn8gg   1/1     Running       0          5s
wallet-api-5bd4b6d77d-cxhpn   1/1     Running       0          2s
wallet-api-5bd4b6d77d-rrpmx   1/1     Running       0          8s
wallet-api-8696f5fd4-g8vhh    0/1     Terminating   0          54s
wallet-api-ffd6cb76b-k57jj    1/1     Terminating   0          2m27s
404 <!DOCTYPE HTML> <html lang="en">     <head>
404 <!DOCTYPE HTML> <html lang="en">     <head>
```

The two 404 lines are the `call` helper cutting the file server's HTML error page to 50 characters.

This time the port is open, so each new Pod is `1/1` within seconds, the controller removes the old ones, and `rollout status` ends with `successfully rolled out`. Every Pod looks healthy. Every request fails with `404`, because the program that answers is a file server. The Deployment says all is well, and users have been broken for as long as it takes someone to notice. Undo and check that the real API is back:

```bash
kubectl -n wallet rollout undo deploy/wallet-api
kubectl -n wallet rollout status deploy/wallet-api
call /accounts/alice
```

```text
deployment.apps/wallet-api rolled back
deployment "wallet-api" successfully rolled out
200 {"name": "alice", "balance": 90}
```

**Step 3: check the wallet.** Confirm `kubectl -n wallet get pods` shows the checkpoint's Pods, all `1/1`, and that `call /accounts/alice` prints `200` again.

1. In step 1 the rollout stalled and in step 2 it succeeded, with the same broken program. Which two lines of the patch made the difference?
2. Rewrite the lazy readiness probe so that it would have stopped step 2. Which endpoint would you ask for, and why is a successful response from it better evidence than an open port?
3. `minReadySeconds` makes a new Pod stay Ready for a while before the rollout continues. Would it have stopped step 2? Explain why or why not.
4. Your pipeline only runs `kubectl rollout status`. What second signal must it watch during a rollout, and how would it trigger `rollout undo`?
5. Delete the lab when you are done: `kind delete cluster --name cnlab-vol5`.
