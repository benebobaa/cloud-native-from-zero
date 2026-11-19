# CKAD drills

## Exam format and environment

The CKAD is a 2-hour, hands-on exam of 15 to 20 command-line tasks on live clusters running Kubernetes v1.37; 66% passes. Checked against the Linux Foundation pages and the CNCF curriculum on 2026-11-16.

| Item | Value | Source |
| --- | --- | --- |
| Format | Online, proctored, performance-based: tasks solved on a command line | [CKAD exam page](https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/) |
| Tasks and time | 15 to 20 tasks; 2 hours | [Important Instructions: CKA and CKAD](https://docs.linuxfoundation.org/tc-docs/certification/tips-cka-and-ckad) |
| Passing score | 66% or above | [FAQ: CKA, CKAD and CKS](https://docs.linuxfoundation.org/tc-docs/certification/faq-cka-ckad-cks) |
| Kubernetes version | v1.37 | Exam page and Important Instructions |
| Retake and validity | One retake included; valid 2 years; 12 months to schedule and take it | Exam page |
| Curriculum | `CKAD_Curriculum_v1.37.pdf` in [github.com/cncf/curriculum](https://github.com/cncf/curriculum) | CNCF curriculum repository |

**Environment.** Identical to the CKA: PSI Secure Browser, a Linux remote desktop, one named host per task reached with `ssh` and left with `exit`, `sudo -i` available, and `kubectl` with the `k` alias and Bash completion, `yq`, `curl`, `wget` and `man` on the hosts. See the [Important Instructions](https://docs.linuxfoundation.org/tc-docs/certification/tips-cka-and-ckad).

**Allowed documentation** ([resources allowed](https://docs.linuxfoundation.org/tc-docs/certification/certification-resources-allowed)): kubernetes.io/docs, kubernetes.io/blog and helm.sh/docs, plus pages linked from a task's Quick Reference box. The Gateway API site is allowed for the CKA only.

**Domains** (CNCF curriculum PDF): Application Environment, Configuration and Security 25%, Application Design and Build 20%, Application Deployment 20%, Services and Networking 20%, Application Observability and Maintenance 15%. The PDF lists Kustomize beside the Services and Networking domain; the coverage matrix treats it as Application Deployment.

## Timed tasks by exam domain

Fourteen tasks across the five domains, about 80 minutes in total. The budgets are this guide's suggestion (the exam gives 2 hours for 15 to 20 tasks, 6 to 8 minutes on average). All fourteen were solved on a kind cluster (kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 with Kustomize v5.8.1, 2026-11-17); the last column is how long the pasted reference commands took, not a human time. Reference solutions are in the Instructor Companion. Container image building (the first Application Design and Build bullet) is not a Kubernetes object and is practised in Vol 4. Helm is drilled in CKA task 7.

**Lab cluster.** The same two-node `cnlab` cluster as the CKA drills, with metrics-server. Run each task's **Setup**, start a timer, solve with the Kubernetes documentation open, then run the **Check**. Use a new namespace per task, as below.

| # | Domain (weight) | Task in one line | Budget | Reference ran in |
| --- | --- | --- | --- | --- |
| 1 | Application Design and Build (20%) | CronJob with history limits, run once by hand | 5 min | 5 s |
| 2 | Application Design and Build | Pod with a log-tailing sidecar | 6 min | 5 s |
| 3 | Application Deployment (20%) | Canary beside a stable Deployment | 6 min | 4 s |
| 4 | Application Deployment | Rolling update strategy, then rollback | 6 min | 9 s |
| 5 | Application Deployment | Kustomize overlay | 6 min | 2 s |
| 6 | Application Observability and Maintenance (15%) | Fix a liveness probe, add readiness | 6 min | 19 s |
| 7 | Application Observability and Maintenance | Debug two broken Pods | 6 min | 2 s |
| 8 | Application Observability and Maintenance | Fix a removed API version | 4 min | 2 s |
| 9 | Application Environment, Configuration and Security (25%) | ConfigMap as file, Secret as variable | 5 min | 2 s |
| 10 | Application Environment, Configuration and Security | ServiceAccount and Role used from a Pod | 6 min | 14 s |
| 11 | Application Environment, Configuration and Security | Lock down a container | 5 min | 2 s |
| 12 | Application Environment, Configuration and Security | Deployment rejected by a quota | 6 min | 5 s |
| 13 | Application Environment, Configuration and Security | Use a CRD you did not write | 6 min | 4 s |
| 14 | Services and Networking (20%) | Service plus NetworkPolicy | 8 min | 4 s |

### Task 1 · CronJob (5 min)

Setup: `kubectl create ns a1`.

Task: in `a1` create CronJob `report` (busybox:1.37, command `sh -c 'date; echo report done'`) that runs every 5 minutes, forbids concurrent runs, keeps 2 successful and 1 failed Jobs. Then start one run now as Job `manual`.

Check: `kubectl -n a1 get cj report -o jsonpath='{.spec.concurrencyPolicy}/{.spec.successfulJobsHistoryLimit}/{.spec.failedJobsHistoryLimit}'` prints `Forbid/2/1`; `kubectl -n a1 logs job/manual` contains `report done`. Card: CronJob, Job.

### Task 2 · Sidecar (6 min)

Setup: `kubectl create ns a2`.

Task: Pod `app` in `a2` with container `main` (busybox, appends a line `line N` to `/var/log/app.log` every second) and container `tail` that shows that file with `tail -F`. They share an `emptyDir` at `/var/log`.

Check: `kubectl -n a2 logs app -c tail` shows lines starting with `line`. Card: Init and sidecar containers.

### Task 3 · Canary (6 min)

Setup: `kubectl create ns a3`.

Task: in `a3` run Deployment `shop-stable` (4 replicas, `nginx:1.30`) and `shop-canary` (1 replica, `nginx:1.31.8`), both with Pod label `app=shop` plus a `track` label that differs. Create Service `shop` that selects only `app=shop`.

Check: `kubectl -n a3 get endpointslices -l kubernetes.io/service-name=shop -o jsonpath='{range .items[*].endpoints[*]}{.targetRef.name}{"\n"}{end}' | wc -l` prints `5` (80% stable, 20% canary). Card: Deployment, Service.

### Task 4 · Rolling update (6 min)

Setup: `kubectl create ns a4; kubectl -n a4 create deploy web --image=nginx:1.30 --replicas=3`.

Task: set the strategy of `web` to `maxSurge: 1`, `maxUnavailable: 0`; update the image to `nginx:1.31.8` and wait for the rollout; then undo it.

Check: the image is `nginx:1.30` again, `maxUnavailable` is `0`, and `kubectl -n a4 rollout history deploy/web` lists revisions 2 and 3. Card: Deployment.

### Task 5 · Kustomize (6 min)

Setup: `kubectl create ns a5`, and a directory `base/` with a one-replica Deployment `api` (`nginx:1.30`, label `app=api`) and a `kustomization.yaml` listing it.

Task: write `overlays/prod/kustomization.yaml` that uses the base, sets namespace `a5`, prefix `prod-`, 3 replicas, image tag `1.31.8`, and the label `env=prod` (not in selectors); apply it.

Check: `kubectl -n a5 get deploy prod-api -o jsonpath='{.spec.replicas} {.spec.template.spec.containers[0].image}'` prints `3 nginx:1.31.8`. Card: Helm and Kustomize.

### Task 6 · Probes (6 min)

```bash
kubectl create ns a6
kubectl -n a6 apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata: {name: web}
spec:
  containers:
  - name: nginx
    image: nginx:1.31.8
    livenessProbe: {httpGet: {path: /healthz, port: 80}, initialDelaySeconds: 2, periodSeconds: 2, failureThreshold: 2}
EOF
```

Task: wait 20 seconds: the Pod restarts. Find out why, then recreate it so that it is stable, with a readiness probe on `/` (every 3 s) and a working liveness probe.

Check: after 20 more seconds `kubectl -n a6 get pod web` shows `1/1 Running 0`. Card: Pod lifecycle and probes.

### Task 7 · Debug (6 min)

```bash
kubectl create ns a7
kubectl -n a7 run web --image=nginx:1.3l.8
kubectl -n a7 run crashy --image=busybox:1.37 -- sh -c 'echo "starting"; echo "ERROR: cannot open /data/in.csv" >&2; exit 2'
```

Task: after 30 seconds, say why `web` does not start and why `crashy` fails, from the cluster's own messages. Fix `web` (a bare Pod: its image can be changed in place).

Check: `kubectl -n a7 get pod web` shows `1/1 Running`. Card: Logs, events and kubectl debug.

### Task 8 · API deprecation (4 min)

Setup: `kubectl create ns a8`, and a file `old-pdb.yaml` with `apiVersion: policy/v1beta1`, `kind: PodDisruptionBudget`, name `web-pdb`, namespace `a8`, `minAvailable: 1`, selector `app=web`.

Task: `kubectl apply -f old-pdb.yaml` fails. Find the supported version on this cluster and fix the file.

Check: `kubectl -n a8 get pdb web-pdb` exists. Cards: API groups, versions and deprecation; PodDisruptionBudget.

### Task 9 · ConfigMap and Secret (5 min)

Setup: `kubectl create ns a9`.

Task: create ConfigMap `app-cfg` (`LOG_LEVEL=debug`, file key `app.properties` with `mode=prod`) and Secret `db-pass` (`DB_PASSWORD=s3cr3t!`). Pod `app` (busybox, sleeps) gets `LOG_LEVEL` and `DB_PASSWORD` as environment variables and `app.properties` as a read-only file at `/etc/app/app.properties`.

Check: `kubectl -n a9 exec app -- sh -c 'echo $LOG_LEVEL $DB_PASSWORD; cat /etc/app/app.properties'` prints `debug s3cr3t!` and `mode=prod`. Cards: ConfigMap, Secret.

### Task 10 · ServiceAccount (6 min)

Setup: `kubectl create ns a10`.

Task: create ServiceAccount `reader`, a Role that lets it `list` Pods in `a10`, and a RoleBinding. Run Pod `lister` (image `registry.k8s.io/kubectl:v1.37.1`, args `get pods -n a10`, `restartPolicy: Never`) as that ServiceAccount.

Check: `kubectl -n a10 logs lister` lists `lister` itself. Cards: ServiceAccount, RBAC.

### Task 11 · SecurityContext (5 min)

Setup: `kubectl create ns a11`.

Task: Pod `locked` (busybox, sleeps): user 1000, must not run as root, read-only root file system, no privilege escalation, all capabilities dropped, seccomp `RuntimeDefault`.

Check: `kubectl -n a11 exec locked -- id -u` prints `1000`; `kubectl -n a11 exec locked -- touch /x` ends with `Read-only file system`. Card: SecurityContext and capabilities.

### Task 12 · Quota (6 min)

Setup: `kubectl create ns a12; kubectl -n a12 create quota cap --hard=pods=4,requests.cpu=500m,limits.cpu=1; kubectl -n a12 create deploy api --image=nginx:1.31.8 --replicas=3`.

Task: the Deployment has no Pods. Read the reason and fix the Deployment (not the quota) so that all 3 replicas run.

Check: `kubectl -n a12 get deploy api -o jsonpath='{.status.readyReplicas}'` prints `3`. Cards: ResourceQuota, Requests, limits and QoS.

### Task 13 · CRD (6 min)

Setup: apply the `CronTab` CRD (group `stable.example.com`, version `v1`, namespaced, short name `ct`, `spec.cronSpec` required string, `spec.image` string, `spec.replicas` integer minimum 1) and `kubectl create ns a13`.

Task: find the resource with `kubectl api-resources`, read its fields with `kubectl explain` (if it says `couldn't find resource`, wait a few seconds for the API's schema to refresh and repeat), create `nightly` with `cronSpec: "0 3 * * *"`, `image: backup:1`, `replicas: 2`, and show that an object without `cronSpec` is rejected.

Check: `kubectl -n a13 get ct nightly` works and the invalid one gives `spec.cronSpec: Required value`. Card: CustomResourceDefinition.

### Task 14 · Service and NetworkPolicy (8 min)

```bash
kubectl create ns a14
kubectl -n a14 run api --image=nginx:1.31.8 --labels=app=api --port=80; kubectl -n a14 expose pod api --port=80
kubectl -n a14 run web --image=busybox:1.37 --labels=app=web -- sleep 3600
kubectl -n a14 run rogue --image=busybox:1.37 --labels=app=rogue -- sleep 3600
```

Task: allow ingress to Pod `api` on TCP 80 only from Pods labelled `app=web`.

Check: `kubectl -n a14 exec web -- wget -qO- -T 3 http://api` prints the nginx page; the same command from `rogue` ends with `wget: download timed out`. Cards: NetworkPolicy, Service.

## Self-check list

Tick an item only when you did it from memory, with the documentation closed. The curriculum is `CKAD_Curriculum_v1.37.pdf` (opened 2026-11-17).

**Application Design and Build (20%)**

- [ ] Choose between Deployment, DaemonSet, Job and CronJob for a given job.
- [ ] Write a multi-container Pod (sidecar, init container) sharing a volume.
- [ ] Use an `emptyDir`, a PersistentVolumeClaim and a ConfigMap volume.
- [ ] Explain what goes into an image and how a tag becomes a Pod's `image` (Vol 4).

**Application Deployment (20%)**

- [ ] Tune `maxSurge` and `maxUnavailable`; roll back.
- [ ] Build a canary or blue/green with two Deployments and one Service.
- [ ] Install a Helm chart with `--set`; render a Kustomize overlay.

**Application Observability and Maintenance (15%)**

- [ ] Write liveness, readiness and startup probes and read their failures.
- [ ] Use `logs`, `logs --previous`, `describe`, `events`, `top` and `kubectl debug`.
- [ ] Find a removed API version (`api-versions`, `explain`) and fix a manifest.

**Application Environment, Configuration and Security (25%)**

- [ ] Use ConfigMaps and Secrets as variables and as files.
- [ ] Set requests and limits; read a ResourceQuota or LimitRange rejection.
- [ ] Create a ServiceAccount with a Role and use it from a Pod.
- [ ] Set a securityContext (user, read-only file system, capabilities).
- [ ] Discover and use a CRD with `api-resources` and `explain`.
- [ ] Explain authentication, authorization and admission in order.

**Services and Networking (20%)**

- [ ] Create a Service and read its EndpointSlices.
- [ ] Write a NetworkPolicy from a sentence and test it from two Pods.
- [ ] Expose an app with an Ingress rule (Group 4 cards).

**Exam skills**

- [ ] Generate YAML with `--dry-run=client -o yaml`, and set the `k` alias and completion.
- [ ] Pass `-n` every time and check the context at the start of each task.
