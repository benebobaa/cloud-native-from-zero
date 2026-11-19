# Milestone 5 · The Wallet on Kubernetes

## Goal

You will move the wallet from Docker Compose onto Kubernetes and prove that it keeps working when a node is taken away. You write the manifests yourself, from the labs of Chapters 5.1 to 5.5; this tab only fixes the target, the checks and the grade.

When you finish, one namespace named `wallet` holds: two Deployments (`wallet-api`, `wallet-worker`), a StatefulSet (`postgres`) with its own volume, two Services, a ConfigMap, a Secret and a PodDisruptionBudget. You then drain a node while a probe hammers the API, delete the database Pod, take an etcd snapshot, and run a check script that tests all of it.

**Versions tested** (2026-11-16, replayed 2026-11-17, Ubuntu 26.04 on WSL2, Docker Desktop): kind v0.33.0, node image `kindest/node:v1.37.0` (Kubernetes 1.37.0, containerd 2.3.4, etcd 3.7.0), kubectl v1.37.1, `wallet:v1` built from `wallet/`, `postgres:17`. Cluster: 1 control-plane node and 2 workers. The manifests in this tab and the numbers in What to expect come from that run. Postgres is not loaded with `kind load` (see the Hints); the nodes pull it. The renumbered check script printed in this tab (R1.1 to R8.1) was run on 2026-11-17 on a fresh kind cluster, after manifests 00 to 05 and a snapshot: passed 23, failed 0, MILESTONE 5 CHECKS: ALL PASS.

**Before you start:** a 3-node kind cluster (`kind create cluster --config kind-3nodes.yaml`, the file from Lab 5.1), `wallet:v1` loaded into every node (Lab 5.1 shows how), and the Lab 5.5 snapshot habit. Budget 3 to 4 hours.

## What you build

The picture shows every object you create and who talks to whom. Solid arrows carry requests; dashed arrows carry configuration or protection.

{{diagram milestone-5-01.jsx | wallet on Kubernetes · 8 object kinds in one namespace}}

Clients reach the API only through the Service. Both Deployments reach Postgres only through the headless Service, which resolves to the Pod. The ConfigMap and the Secret feed all three workloads; arrows are drawn to the two Deployments, and `postgres-0` reads the same two objects. The PVC is bound to a PV that lives on one node (Chapter 5.4).

## Requirements

Eight requirements, each with a command you can run and the output that proves it. The check script at the end of this tab runs the same commands; run them by hand first so you understand each result.

| # | Requirement | Check | Expected |
| --- | --- | --- | --- |
| R1 | Namespace `wallet` holds Deployments `wallet-api` and `wallet-worker`, StatefulSet `postgres`, Service `wallet-api` (ClusterIP), headless Service `postgres`, ConfigMap `wallet-config`, Secret `wallet-db`, PodDisruptionBudget for `wallet-api` | `kubectl -n wallet get deploy,sts,svc,cm,secret,pdb` | every name above is listed; `svc/postgres` shows `CLUSTER-IP None` |
| R2 | Configuration is split by sensitivity: the password lives only in the Secret; the ConfigMap holds non-secret settings; Pods read both through `env` (`configMapKeyRef`, `secretKeyRef`, `envFrom`) | `kubectl -n wallet get cm wallet-config -o yaml` | no key or value containing `pass`; the Deployments reference `secretKeyRef` or `secretRef` |
| R3 | `wallet-api` and `wallet-worker` run 2 replicas each. The API has a readiness probe on `/readyz` and a liveness probe on `/healthz`. Every container sets CPU and memory requests and a memory limit | `kubectl -n wallet get deploy` | `READY 2/2` for both; `kubectl -n wallet get deploy wallet-api -o yaml` shows both probes |
| R4 | Postgres runs as a StatefulSet with a `volumeClaimTemplates` entry of 1 Gi, a readiness probe, and a headless Service named in `serviceName` | `kubectl -n wallet get sts,pvc` | `postgres 1/1`; PVC `data-postgres-0` is `Bound` |
| R5 | The wallet works end to end through the Service | `kubectl -n wallet port-forward svc/wallet-api 18080:80`, then `wallet/test_e2e.sh http://localhost:18080` | last line `PASS` (`alice=70 bob=80` on a fresh database) |
| R6 | Data survives losing the database Pod | `kubectl -n wallet delete pod postgres-0`, wait for `Ready`, read `/accounts/alice` | the same balance as before the delete; the Pod has the same name and the same PVC |
| R7 | The service survives draining a node that does not hold `postgres-0`: zero failed requests from a probe that calls the Service twice a second | `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data` while the probe runs | the drain returns `drained`; the probe log has 0 `FAIL` lines |
| R8 | You hold a current etcd snapshot of the cluster | `etcdctl snapshot save` (Lab 5.5), then `etcdutl snapshot status` | a table with a hash, a revision and `TOTAL KEYS` above 0 |

Two details the checks depend on. First, `kubectl drain` refuses to evict a Pod that has no controller, so the probe Pod must sit on a node you do not drain; the check script pins it to the control-plane node with `spec.nodeName`. Second, R7 names a node that does *not* hold `postgres-0` on purpose: the next section shows what happens when you drain the node that does.

Background for each requirement: see Field Guide → 3 · Deployment, 3 · StatefulSet, 3 · Pod lifecycle and probes, 4 · Service, 5 · ConfigMap, 5 · Secret, 6 · PersistentVolumeClaim, 7 · PodDisruptionBudget, 11 · Node maintenance and eviction and 11 · etcd backup and restore.

## What to expect

Draining the node that holds the database volume takes the wallet down for as long as that node stays cordoned, and no setting in this milestone changes that. The table is what one reference run produced (kind 1.37.0, 3 nodes, local-path storage); your timings will differ, the behaviour will not.

| Event | What happens | Measured on the reference run |
| --- | --- | --- |
| First `kubectl apply` | `postgres-0` takes a few seconds to start; the API and worker Pods start in parallel and retry the connection | one `wallet-worker` Pod shows `RESTARTS 1` within the first minute, then stays `Running` |
| `kubectl drain` of a worker without `postgres-0` | the API and worker Pods on it are evicted and recreated on the other worker; the PDB lets one API Pod go because the other is Ready | drain returns `drained`; probe: 33 `ok`, 0 `FAIL` in the window |
| `kubectl delete pod postgres-0` | the StatefulSet recreates the same Pod name on the same node and re-attaches the same PVC | back to `Ready` in about 8 s after the node is schedulable; balances unchanged (`alice 70`, `bob 80`) |
| `kubectl drain` of the node that holds `postgres-0` | `postgres-0` is evicted and stays `Pending`: its PV is bound to that node, so the scheduler reports `didn't match PersistentVolume's node affinity` | probe saw `FAIL` from 1 s after the drain started until the node was uncordoned: first `FAIL` at +1 s, last at +157 s (104 `FAIL`, 15 `ok`) |
| the same drain, the PDB | the API Pods lose `/readyz` (it needs the database), so 0 of 2 are Ready; evicting the last one would break `minAvailable: 1` | `kubectl drain` repeats `Cannot evict pod as it would violate the pod's disruption budget` until its 2-minute timeout |
| `kubectl uncordon` of that node | `postgres-0` schedules, mounts its old volume and goes Ready; the API Pods follow | `postgres-0` Ready 8 s after uncordon; data intact |

Three mechanisms explain every row.

- **The volume pins the Pod.** A `local-path` PV carries a `nodeAffinity` for one hostname (Ch 5.4). The StatefulSet controller recreates `postgres-0` immediately, but the scheduler may only place it on that node. See [StatefulSet: stable storage](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/).
- **Readiness follows the dependency.** The wallet API reports ready only when it can reach Postgres, so an outage of the database also empties the Service's EndpointSlice (Ch 5.3). Clients get connection errors, not slow answers.
- **A PDB counts healthy Pods.** The documentation defines a healthy Pod as one with condition `Ready` equal to `True`, and with the default `unhealthyPodEvictionPolicy` (`IfHealthyBudget`) "drains can be blocked by misbehaving applications that are guarded by a PDB". `AlwaysAllow` lets a drain evict Pods that are running but not Ready. See [Specifying a Disruption Budget](https://kubernetes.io/docs/tasks/run-application/configure-pdb/) and [Safely Drain a Node](https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/).

The `RESTARTS 1` in row one is a real race, not a mistake in your manifests. Both programs run `CREATE TABLE IF NOT EXISTS` when they start; when two of them run it at the same moment on an empty database, Postgres can reject one with a `UniqueViolation`, the container exits, and Kubernetes restarts it (restart policy `Always`). The restart succeeds. In production you would run the schema creation once, as a Job or an init container, so that Pods never race. A restart count of 1 on a worker is accepted by the rubric; a Pod in `CrashLoopBackOff` is not.

## Deliverables

Submit one git repository named `wallet-k8s` with these four things.

1. **Manifests.** One YAML file per concern, numbered so that `kubectl apply -f .` works on an empty cluster: `00-namespace.yaml`, `01-config.yaml` (ConfigMap and Secret), `02-postgres.yaml` (headless Service and StatefulSet), `03-api.yaml` (Deployment and Service), `04-worker.yaml`, `05-pdb.yaml`. No hand-edited cluster state: if a step needs a `kubectl` command that is not in the README, the grader will not be able to reproduce your result.
2. **README.md.** The exact commands, in order, from an empty kind cluster to a passing check script. State your versions with the words "Versions tested" for what you ran.
3. **evidence.txt.** The output of each R1 to R8 command, the output of the check script, and the events of the Postgres drain (`kubectl -n wallet get events --sort-by=.lastTimestamp`). Paste real output; the grader compares it with the cluster.
4. **etcd snapshot proof.** Do not commit the snapshot file: an etcd snapshot holds every Secret in clear text (Lab 5.3 shows `s3cr3t` read straight out of etcd). Commit the `etcdutl snapshot status` table and the `sha256sum` of the file instead, and keep the file itself out of git.

Add one more file, `design-note.md`, of at most one page, answering three questions in your own words:

- Why is Postgres a StatefulSet and not a Deployment with a PVC? Name two things the StatefulSet gives you that the Deployment does not.
- You drained the node that held `postgres-0`. What did users see, for how long, and which two objects caused it (name the PV field and the PDB field)? Use your own measured timings.
- What would you change to get real high availability for the database? Cover storage (replicated volumes such as Longhorn or Rook-Ceph, Ch 5.4) and the database layer (an operator that manages replicas and failover, Vol 7), and say what each one costs you.

## Hints

- **Build it in the order of the picture, bottom up.** Namespace, ConfigMap and Secret, then Postgres alone: `kubectl -n wallet exec postgres-0 -- pg_isready -U wallet` must succeed before you start the API.
- **Postgres needs a data sub-directory.** Set `PGDATA` to a path below the mount point (for example `/var/lib/postgresql/data/pgdata`), because some volumes have a `lost+found` directory in their root and Postgres refuses to initialise there. The Postgres image takes `POSTGRES_USER`, `POSTGRES_DB` and `POSTGRES_PASSWORD` from the environment; `envFrom` with a `configMapRef` and a `secretRef` is the shortest way.
- **Compose the connection string in the Pod spec.** The wallet reads `DATABASE_URL`. Define `POSTGRES_PASSWORD` from the Secret first, then write `postgresql://wallet:$(POSTGRES_PASSWORD)@postgres:5432/wallet`: Kubernetes expands `$(NAME)` only for variables defined earlier in the same `env` list.
- **The hostname is the Service name.** `postgres` resolves through CoreDNS to the Pod because the Service is headless (Ch 5.3). Name it exactly as `serviceName` in the StatefulSet.
- **Name the container port.** Use `name: http` on the API port, then `targetPort: http` in the Service and `port: http` in the probes; you change the number in one place.
- **Probes.** The API serves `/healthz` (process alive, no database) and `/readyz` (database reachable). Using `/readyz` for liveness would restart healthy Pods whenever the database is down, a classic outage amplifier (Ch 5.2).
- **`kind load` and Postgres.** Load `wallet:v1` with `kind load docker-image wallet:v1`, or with the pipe from Lab 5.1 if that fails. If `kind load docker-image postgres:17` fails with `content digest ... not found` (Docker 29 with the containerd image store: it did on Docker Desktop and on Docker Engine 29.10.0), skip it: the nodes can pull from Docker Hub, or run `docker exec <node> crictl pull postgres:17` on each worker.
- **Find your drain target before you drain.** `kubectl -n wallet get pod -o wide` shows the node of each Pod. Drain a worker that is not the node of `postgres-0`, with `--ignore-daemonsets --delete-emptydir-data`. Uncordon it afterwards.
- **Read the scheduler.** When a Pod stays `Pending`, `kubectl -n wallet describe pod <name>` ends with the scheduler's reasons, one per node (Ch 5.4).
- **Snapshot flags.** Copy the `etcdctl` command with its four TLS flags from Lab 5.5 and run it with `kubectl -n kube-system exec etcd-<control-plane-node> -- etcdctl ...`. The snapshot lands in `/var/lib/etcd` on the node.

## Rubric

One hundred points. "Full" means the check script passes the matching lines and the grader finds no cheating shortcut (for example a password in the ConfigMap, or a Deployment for Postgres).

| Criterion | Points | Full marks | Partial credit |
| --- | --- | --- | --- |
| R1 Objects and layout | 10 | all eight kinds present, correct names, one namespace, files numbered, `kubectl apply -f .` works from empty | 5 if one kind is missing or the apply needs a second pass; 0 if objects are in `default` |
| R2 Configuration split | 10 | password only in the Secret; ConfigMap holds only non-secret keys; Pods read both through `env` | 5 if the password is in a ConfigMap or hard-coded in `DATABASE_URL`; 0 if it is in the image |
| R3 Deployments, probes, resources | 15 | 2 replicas each, readiness on `/readyz`, liveness on `/healthz`, requests and a memory limit on every container | 10 if a probe or the limits are missing; 5 if liveness uses `/readyz`; 0 if Pods are bare |
| R4 StatefulSet and storage | 15 | StatefulSet with `volumeClaimTemplates` 1 Gi, headless Service, readiness probe, PVC `Bound` | 10 if the Service is not headless or `serviceName` does not match; 5 if Postgres is a Deployment with a PVC |
| R5 End to end | 10 | `test_e2e.sh` prints `PASS` through the Service | 5 if it passes only against a Pod IP, not through the Service |
| R6 Persistence | 10 | balance unchanged after `delete pod postgres-0`; same Pod name and PVC | 5 if data survives only because the Pod was never deleted; 0 if it uses `emptyDir` |
| R7 Drain | 15 | drain of a node without `postgres-0` returns `drained` and the probe log has 0 `FAIL`; the grader sees a PDB and 2 replicas spread over 2 nodes | 10 if 1 to 3 `FAIL` lines; 5 if the drain needed `--force` or `--disable-eviction`; 0 if the PDB was deleted to make the drain pass |
| R8 etcd snapshot | 5 | `etcdutl snapshot status` table in the evidence, sha256 recorded, file not committed | 3 if the file is committed; 0 if only a screenshot of `snapshot save` |
| Design note | 10 | all three questions answered with the student's own measurements, correct names (`nodeAffinity` of the PV, `minAvailable` of the PDB) and a reasoned HA plan | 5 if the answers are generic; 0 if copied from this tab |

**Grade bands:** 90 to 100 distinction, 70 to 89 pass, below 70 repeat the failed requirements and resubmit once.

## The check script

This script tests R1 to R8 on your cluster and ends with `MILESTONE 5 CHECKS: ALL PASS` when everything holds. Save it as `check-milestone5.sh`, make it executable, and run it from a shell where `kubectl` points at your kind cluster. Read it before you run it: it deletes `postgres-0` once, drains one worker once (and uncordons it on exit), and creates one short-lived Pod named `m5-probe`.

```bash
#!/usr/bin/env bash
# Milestone 5 self-check: wallet on Kubernetes.
# Usage: ./check-milestone5.sh [namespace] [snapshot-path-inside-the-etcd-pod]
# Needs: kubectl (pointing at your cluster), python3, curl. Image wallet:v1 must be present on every node
# (the probe Pod reuses it, so no extra image is pulled).
# It deletes postgres-0 once and drains one worker once (then uncordons it). Run it on a lab cluster only.
NS=${1:-wallet}
SNAP=${2:-/var/lib/etcd/snapshot.db}
PORT=${PORT:-18090}
URL=http://localhost:$PORT
pass=0; fail=0; PF=; DRAINED=
ok()  { echo "PASS  $1"; pass=$((pass+1)); }
bad() { echo "FAIL  $1${2:+  ($2)}"; fail=$((fail+1)); }
chk() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1" "$3"; fi; }
cleanup() {
  [ -n "$PF" ] && kill "$PF" 2>/dev/null
  [ -n "$DRAINED" ] && kubectl uncordon "$DRAINED" >/dev/null 2>&1
  kubectl -n "$NS" delete pod m5-probe --now --ignore-not-found >/dev/null 2>&1
}
trap cleanup EXIT
k() { kubectl -n "$NS" "$@"; }
j() { curl -fsS -m 5 -H 'Content-Type: application/json' "$@"; }
jget() { python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }

echo "== R1 objects"
chk "R1.1 namespace $NS exists" "kubectl get ns $NS"
chk "R1.2 Deployment wallet-api"        "k get deploy wallet-api"
chk "R1.3 Deployment wallet-worker"     "k get deploy wallet-worker"
chk "R1.4 StatefulSet postgres"         "k get sts postgres"
chk "R1.5 Service wallet-api is ClusterIP with an IP" "[ \"\$(k get svc wallet-api -o jsonpath='{.spec.clusterIP}')\" != None ] && [ -n \"\$(k get svc wallet-api -o jsonpath='{.spec.clusterIP}')\" ]"
chk "R1.6 Service postgres is headless" "[ \"\$(k get svc postgres -o jsonpath='{.spec.clusterIP}')\" = None ]"
chk "R1.7 ConfigMap wallet-config"      "k get cm wallet-config"
chk "R1.8 Secret wallet-db"             "k get secret wallet-db"
chk "R1.9 PodDisruptionBudget for wallet-api" "k get pdb -o jsonpath='{.items[*].spec.selector.matchLabels.app}' | grep -q wallet-api"

echo "== R3 and R4 rollout state"
for d in wallet-api wallet-worker; do
  chk "R3.1 $d has >= 2 available replicas" "[ \"\$(k get deploy $d -o jsonpath='{.status.availableReplicas}')\" -ge 2 ]" "kubectl -n $NS get deploy $d"
done
chk "R4.1 StatefulSet postgres is Ready" "[ \"\$(k get sts postgres -o jsonpath='{.status.readyReplicas}')\" -ge 1 ]"
chk "R4.2 its PVC is Bound" "k get pvc -o jsonpath='{.items[*].status.phase}' | grep -q Bound && ! k get pvc -o jsonpath='{.items[*].status.phase}' | grep -qv Bound"

echo "== R2, R3 and R4 probes, resources, secrets"
chk "R3.2 api has readiness and liveness probes" "k get deploy wallet-api -o json | python3 -c 'import json,sys; c=json.load(sys.stdin)[\"spec\"][\"template\"][\"spec\"][\"containers\"][0]; assert \"readinessProbe\" in c and \"livenessProbe\" in c'"
chk "R4.3 postgres has a readiness probe" "k get sts postgres -o json | python3 -c 'import json,sys; c=json.load(sys.stdin)[\"spec\"][\"template\"][\"spec\"][\"containers\"][0]; assert \"readinessProbe\" in c'"
chk "R3.3 every container has cpu+memory requests and a memory limit" "k get deploy,sts -o json | python3 -c '
import json,sys
for o in json.load(sys.stdin)[\"items\"]:
    for c in o[\"spec\"][\"template\"][\"spec\"][\"containers\"]:
        r=c.get(\"resources\",{}); q=r.get(\"requests\",{}); l=r.get(\"limits\",{})
        assert \"cpu\" in q and \"memory\" in q and \"memory\" in l, o[\"metadata\"][\"name\"]'"
chk "R2.1 no password in the ConfigMap" "! k get cm wallet-config -o json | python3 -c 'import json,sys; d=json.load(sys.stdin).get(\"data\",{}); sys.exit(0 if any(\"pass\" in (k+v).lower() for k,v in d.items()) else 1)'"
chk "R2.2 the password reaches the Pods through the Secret (secretKeyRef or secretRef)" "k get deploy,sts -o json | python3 -c '
import json,sys
s=json.dumps(json.load(sys.stdin)); assert \"secretKeyRef\" in s or \"secretRef\" in s'"

echo "== R5 end to end"
kubectl -n "$NS" port-forward svc/wallet-api "$PORT":80 >/dev/null 2>&1 & PF=$!
sleep 3
A="chk-$RANDOM"; B="chk-$RANDOM"
j -X POST $URL/accounts -d "{\"name\":\"$A\",\"balance\":100}" >/dev/null 2>&1
j -X POST $URL/accounts -d "{\"name\":\"$B\",\"balance\":50}" >/dev/null 2>&1
T="t-$RANDOM"
j -X POST $URL/transfers -d "{\"id\":\"$T\",\"from\":\"$A\",\"to\":\"$B\",\"amount\":30}" >/dev/null 2>&1
st=pending
for _ in $(seq 20); do st=$(j $URL/transfers/$T 2>/dev/null | jget status 2>/dev/null); [ "$st" != pending ] && break; sleep 1; done
a=$(j $URL/accounts/$A 2>/dev/null | jget balance 2>/dev/null); b=$(j $URL/accounts/$B 2>/dev/null | jget balance 2>/dev/null)
chk "R5.1 transfer settles and balances move (alice 70, bob 80)" "[ \"$st\" = settled ] && [ \"$a\" = 70 ] && [ \"$b\" = 80 ]" "status=$st a=$a b=$b"

echo "== R6 data survives deleting postgres-0"
k delete pod postgres-0 --wait=true >/dev/null 2>&1
k wait --for=condition=Ready pod/postgres-0 --timeout=120s >/dev/null 2>&1
a2=; for _ in $(seq 30); do a2=$(j $URL/accounts/$A 2>/dev/null | jget balance 2>/dev/null) && break; sleep 2; done
chk "R6.1 balance of $A is still 70 after postgres-0 was recreated" "[ \"$a2\" = 70 ]" "got '$a2'"

echo "== R7 a drain of a node that does not hold postgres-0 loses no request"
PGNODE=$(k get pod postgres-0 -o jsonpath='{.spec.nodeName}')
CPNODE=$(kubectl get nodes -l node-role.kubernetes.io/control-plane -o jsonpath='{.items[0].metadata.name}')
VICTIM=$(kubectl get nodes --no-headers -l '!node-role.kubernetes.io/control-plane' -o custom-columns=N:.metadata.name | grep -v "^$PGNODE\$" | head -1)
if [ -z "$VICTIM" ] || [ -z "$CPNODE" ]; then
  bad "R7.1 need a control-plane node for the probe and a second worker to drain" "found control-plane='$CPNODE' victim='$VICTIM'"
else
  # the probe Pod sits on the control-plane node so the drain never moves it
  kubectl -n "$NS" apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Pod
metadata: {name: m5-probe}
spec:
  nodeName: $CPNODE
  terminationGracePeriodSeconds: 1
  containers:
    - name: p
      image: wallet:v1
      command: ["python3", "-u", "-c", "import time,urllib.request as u\nwhile True:\n    try:\n        u.urlopen('http://wallet-api/readyz', timeout=1).read(); r='ok'\n    except Exception:\n        r='FAIL'\n    print(int(time.time()), r)\n    time.sleep(0.5)"]
EOF
  k wait --for=condition=Ready pod/m5-probe --timeout=60s >/dev/null 2>&1; sleep 3
  T0=$(date +%s); DRAINED=$VICTIM
  kubectl drain "$VICTIM" --ignore-daemonsets --delete-emptydir-data --timeout=120s >/dev/null 2>&1; rc=$?
  sleep 10
  k rollout status deploy/wallet-api --timeout=60s >/dev/null 2>&1
  oks=$(k logs m5-probe | awk -v t=$T0 '$1>=t && $2=="ok"' | wc -l); fails=$(k logs m5-probe | awk -v t=$T0 '$1>=t && $2=="FAIL"' | wc -l)
  chk "R7.1 kubectl drain $VICTIM succeeded" "[ $rc = 0 ]" "exit $rc; a PodDisruptionBudget or a bare Pod can block it"
  chk "R7.2 0 failed requests during the drain ($oks ok, $fails failed)" "[ $fails = 0 ] && [ $oks -gt 10 ]"
  kubectl uncordon "$VICTIM" >/dev/null 2>&1; DRAINED=
fi

echo "== R8 etcd snapshot"
ETCDPOD=$(kubectl -n kube-system get pods -l component=etcd -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
chk "R8.1 etcdutl snapshot status passes on $SNAP" "kubectl -n kube-system exec $ETCDPOD -- etcdutl snapshot status $SNAP -w json | grep -q totalKey" "take it first: etcdctl snapshot save $SNAP (see Lab 5.5)"

echo; echo "passed: $pass   failed: $fail"
[ "$fail" = 0 ] && echo "MILESTONE 5 CHECKS: ALL PASS" || echo "MILESTONE 5 CHECKS: $fail FAILED"
[ "$fail" = 0 ]
```

**Run it.** Take the snapshot first (Lab 5.5, Part B), then run the script from a shell whose `kubectl` points at your kind cluster. The script needs `python3` and `curl` on your machine, and it opens a port-forward on local port 18090 (set `PORT=` to change it).

```bash
chmod +x check-milestone5.sh
./check-milestone5.sh wallet /var/lib/etcd/snapshot.db
```

Real output on 2026-11-17 (the account name in R6.1 is random):

```text
== R1 objects
PASS  R1.1 namespace wallet exists
PASS  R1.2 Deployment wallet-api
PASS  R1.3 Deployment wallet-worker
PASS  R1.4 StatefulSet postgres
PASS  R1.5 Service wallet-api is ClusterIP with an IP
PASS  R1.6 Service postgres is headless
PASS  R1.7 ConfigMap wallet-config
PASS  R1.8 Secret wallet-db
PASS  R1.9 PodDisruptionBudget for wallet-api
== R3 and R4 rollout state
PASS  R3.1 wallet-api has >= 2 available replicas
PASS  R3.1 wallet-worker has >= 2 available replicas
PASS  R4.1 StatefulSet postgres is Ready
PASS  R4.2 its PVC is Bound
== R2, R3 and R4 probes, resources, secrets
PASS  R3.2 api has readiness and liveness probes
PASS  R4.3 postgres has a readiness probe
PASS  R3.3 every container has cpu+memory requests and a memory limit
PASS  R2.1 no password in the ConfigMap
PASS  R2.2 the password reaches the Pods through the Secret (secretKeyRef or secretRef)
== R5 end to end
PASS  R5.1 transfer settles and balances move (alice 70, bob 80)
== R6 data survives deleting postgres-0
PASS  R6.1 balance of chk-28906 is still 70 after postgres-0 was recreated
== R7 a drain of a node that does not hold postgres-0 loses no request
PASS  R7.1 kubectl drain cnlab-vol5-worker2 succeeded
PASS  R7.2 0 failed requests during the drain (36 ok, 0 failed)
== R8 etcd snapshot
PASS  R8.1 etcdutl snapshot status passes on /var/lib/etcd/snapshot.db

passed: 23   failed: 0
MILESTONE 5 CHECKS: ALL PASS
```

Every line starts with `PASS` or `FAIL`. A `FAIL` line ends with a hint in parentheses. The last line is `MILESTONE 5 CHECKS: ALL PASS` or `MILESTONE 5 CHECKS: <n> FAILED`, and the exit code is 0 only for ALL PASS. The check numbers follow the Requirements table: `R3.1` is requirement R3, check 1.

| Check lines | Requirement | What the line proves | Not checked by the script (the grader looks) |
| --- | --- | --- | --- |
| `R1.1` to `R1.9` | R1 | every object kind exists, `wallet-api` has a cluster IP, `postgres` is headless | file numbering, `kubectl apply -f .` from an empty cluster |
| `R2.1`, `R2.2` | R2 | no key or value of the ConfigMap contains `pass`; Secret references are used | that the password is not hard-coded in `DATABASE_URL` |
| `R3.1` to `R3.3` | R3 | 2 available replicas each, both probes on the API, requests and a memory limit on every container | that liveness uses `/healthz` and readiness `/readyz` |
| `R4.1` to `R4.3` | R4 | the StatefulSet is Ready, its PVC is Bound, Postgres has a readiness probe | the 1 Gi size and `serviceName` |
| `R5.1` | R5 | through the Service: two accounts, one transfer, balances 70 and 80 |  |
| `R6.1` | R6 | the balance is unchanged after `postgres-0` is deleted and Ready again | that the Pod and the PVC keep their names |
| `R7.1`, `R7.2` | R7 | a worker without `postgres-0` drains with exit code 0 while a probe Pod on the control-plane node sees 0 `FAIL` lines | that the PDB was not deleted and that `--force` was not used |
| `R8.1` | R8 | `etcdutl snapshot status` reads the snapshot file | the `sha256sum` record and that the file is not committed |
