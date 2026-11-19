# Lab 7.1 · Argo CD Deploys the Wallet

## Goal

Ship the wallet three ways, then prove that git is the only way into the cluster. You build plain Kustomize overlays, turn the same manifests into a Helm chart, and let Argo CD pull the overlay from a git server inside the cluster.

{{diagram lab-7-1-01.jsx | what you will build · Lab 7.1}}

In Parts A and B you apply YAML yourself. In Part C only the push arrow is yours: Argo CD does the rest.

**Versions tested.** Kubernetes 1.37.0 (kind v0.33.0, node image `kindest/node:v1.37.0`), kubectl 1.37.1 (Kustomize v5.8.1), Helm v4.3.1, Argo CD v3.6.1, Postgres 17, git 2.53.0, wallet image `wallet:v1` (first built in Lab 3.1, explained in Vol 4). Test machine: Ubuntu 26.04 on WSL2 with Docker Desktop; the wallet image was loaded with `docker save` and `kind load image-archive` (the labs note this because `kind load docker-image` failed there). Not run: Flux, Argo Rollouts, ApplicationSet, a webhook, Ubuntu 24.04 itself.

**Lab only.** The git server in this lab has no login, and the dev overlay holds a literal password. Both exist so that you can finish in one afternoon. Neither belongs in production, and Part A shows where production gets the password instead.

## Setup

```bash
export KUBECONFIG=$PWD/kubeconfig          # never touch another cluster's kubeconfig
kind create cluster --name cnlab --image kindest/node:v1.37.0
docker save wallet:v1 -o wallet-v1.tar
kind load image-archive wallet-v1.tar --name cnlab   # on Docker Engine: kind load docker-image wallet:v1 --name cnlab
```

Expected: the last line of `kind create cluster` is `Have a nice day!` and `kubectl get nodes` shows one node `Ready` at `v1.37.0`. It took 17 seconds on the test machine once the node image was cached.

## Part A · Kustomize: one base, two overlays

Build it by hand first: three plain manifests, then two overlays that change them. Create the repository and the base. These are your Vol 5 manifests with two changes: no namespace, and the password comes from a Secret.

```bash
mkdir -p ~/wallet-gitops && cd ~/wallet-gitops
git init -b main
git config user.name "Your Name" && git config user.email you@example.com
mkdir -p kustomize/base kustomize/overlays/dev kustomize/overlays/prod
```

```yaml
# kustomize/base/postgres.yaml
apiVersion: v1
kind: Service
metadata:
  name: wallet-postgres
spec:
  clusterIP: None
  selector: {app: wallet-postgres}
  ports: [{name: pg, port: 5432}]
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: wallet-postgres
spec:
  serviceName: wallet-postgres
  replicas: 1
  selector:
    matchLabels: {app: wallet-postgres}
  template:
    metadata:
      labels: {app: wallet-postgres}
    spec:
      containers:
      - name: postgres
        image: postgres:17
        ports: [{containerPort: 5432, name: pg}]
        env:
        - {name: POSTGRES_USER, value: wallet}
        - {name: POSTGRES_DB, value: wallet}
        - {name: PGDATA, value: /var/lib/postgresql/data/pgdata}
        - name: POSTGRES_PASSWORD          # the base never contains the value, only a reference
          valueFrom:
            secretKeyRef: {name: wallet-db, key: POSTGRES_PASSWORD}
        readinessProbe:
          exec: {command: ["pg_isready", "-U", "wallet"]}
          periodSeconds: 3
        resources:
          requests: {cpu: 100m, memory: 128Mi}
          limits: {memory: 512Mi}
        volumeMounts: [{name: data, mountPath: /var/lib/postgresql/data}]
  volumeClaimTemplates:
  - metadata: {name: data}
    spec:
      accessModes: [ReadWriteOnce]
      resources: {requests: {storage: 1Gi}}
```

```yaml
# kustomize/base/api.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wallet-api
spec:
  replicas: 1
  selector:
    matchLabels: {app: wallet-api}
  template:
    metadata:
      labels: {app: wallet-api}
      annotations: {prometheus.io/scrape: "true", prometheus.io/port: "8080", prometheus.io/path: /metrics}
    spec:
      containers:
      - name: api
        image: wallet:v1
        command: ["python3", "api.py"]
        ports: [{containerPort: 8080, name: http}]
        env:
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef: {name: wallet-db, key: POSTGRES_PASSWORD}
        - name: DATABASE_URL               # $(VAR) is expanded from the entries above it
          value: postgresql://wallet:$(POSTGRES_PASSWORD)@wallet-postgres:5432/wallet
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
spec:
  selector: {app: wallet-api}
  ports: [{name: http, port: 80, targetPort: http}]
```

```yaml
# kustomize/base/worker.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wallet-worker
spec:
  replicas: 1
  selector:
    matchLabels: {app: wallet-worker}
  template:
    metadata:
      labels: {app: wallet-worker}
    spec:
      containers:
      - name: worker
        image: wallet:v1
        command: ["python3", "worker.py"]
        env:
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef: {name: wallet-db, key: POSTGRES_PASSWORD}
        - name: DATABASE_URL
          value: postgresql://wallet:$(POSTGRES_PASSWORD)@wallet-postgres:5432/wallet
        resources:
          requests: {cpu: 50m, memory: 64Mi}
          limits: {memory: 128Mi}
```

The base lists its files. The dev overlay adds a label and generates the Secret; the prod overlay patches the API and generates nothing.

```yaml
# kustomize/base/kustomization.yaml
resources: [postgres.yaml, api.yaml, worker.yaml]
```

```yaml
# kustomize/overlays/dev/kustomization.yaml
resources: [../../base]
labels:
- pairs: {env: dev}
  includeSelectors: false
# LAB ONLY. A literal password in git is exactly what production must never do.
# Production overlays omit this block; the Secret wallet-db comes from Sealed Secrets,
# External Secrets or SOPS (Ch 7.1, Ch 6.3).
secretGenerator:
- name: wallet-db
  literals: [POSTGRES_PASSWORD=lab-only-change-me]
  options:
    labels: {purpose: lab-only}
```

```yaml
# kustomize/overlays/prod/kustomization.yaml
resources: [../../base]
labels:
- pairs: {env: prod}
  includeSelectors: false
# No secretGenerator here: Secret wallet-db must already exist (Sealed Secrets / External Secrets / SOPS).
patches:
- target: {kind: Deployment, name: wallet-api}
  patch: |-
    - {op: replace, path: /spec/replicas, value: 3}
    - {op: replace, path: /spec/template/spec/containers/0/resources/limits/memory, value: 256Mi}
```

Render both overlays without a cluster, and count what differs:

```bash
kubectl kustomize kustomize/overlays/dev  | grep -E '^kind:|replicas:|env: dev|name: wallet-db'  | sort | uniq -c
kubectl kustomize kustomize/overlays/prod | grep -E '^kind:|replicas:|memory: 256Mi|env: prod'    | sort | uniq -c
```

Expected output on the test machine:

```text
---- dev ----
      3               name: wallet-db-dg6b9c9668
      6     env: dev
      1   name: wallet-db-dg6b9c9668
      3   replicas: 1
      2 kind: Deployment
      1 kind: Secret
      2 kind: Service
      1 kind: StatefulSet
---- prod ----
      1             memory: 256Mi
      5     env: prod
      2   replicas: 1
      1   replicas: 3
      2 kind: Deployment
      2 kind: Service
      1 kind: StatefulSet
```

Read the two blocks against each other. Dev has a `Secret` and six objects labelled `env: dev`; the Secret's name appears once as the object and three times as a `secretKeyRef` (Kustomize rewrote the references in all three workloads to the hashed name). Prod has five objects, no `Secret`, and the API at `replicas: 3` with a `256Mi` limit; the worker and the database stay at `replicas: 1` because they come from the base. The `---- dev ----` and `---- prod ----` lines are added here for reading. The hash suffix is computed from the Secret's content, so yours matches only if you typed the same literal.

Apply the dev overlay to a scratch namespace and run the end-to-end test from Vol 4:

```bash
kubectl create namespace wallet-dev
kubectl apply -k kustomize/overlays/dev -n wallet-dev
kubectl -n wallet-dev rollout status statefulset/wallet-postgres
kubectl -n wallet-dev rollout status deployment/wallet-api
kubectl -n wallet-dev port-forward svc/wallet-api 18080:80 &
<your wallet repo>/test_e2e.sh http://localhost:18080     # the e2e script from Vol 4
kill %1
```

```text
secret/wallet-db-dg6b9c9668 created
service/wallet-api created
service/wallet-postgres created
deployment.apps/wallet-api created
deployment.apps/wallet-worker created
statefulset.apps/wallet-postgres created
...
transfer=settled big=rejected alice=70 bob=80
PASS
```

**Two things to notice.** First, `grep -rn lab-only-change-me .` finds the password in exactly one file, the dev overlay, and the Secret carries the label `purpose=lab-only`. Second, the API waits up to 30 seconds for Postgres when it starts (the wallet's `connect` retries), so the first `rollout status` of the API can take half a minute on a cold node. That is the wallet being patient, not a failure.

## Part B · Helm: the same manifests as a chart

A chart is these manifests with the changing values cut out. Build it from the base with five `sed` edits, so that you see exactly what became a value.

```bash
mkdir -p chart/wallet/templates
cp kustomize/base/{api,worker,postgres}.yaml chart/wallet/templates/
cd chart/wallet
cat > Chart.yaml <<'EOF'
apiVersion: v2
name: wallet
description: The digital wallet - API, worker and Postgres
type: application
version: 0.1.0
appVersion: "v1"
EOF
cat > values.yaml <<'EOF'
image:
  repository: wallet
  tag: v1
api:
  replicas: 1
  memoryLimit: 128Mi
worker:
  replicas: 1
postgres:
  enabled: true
db:
  existingSecret: wallet-db   # the chart never holds the password
EOF
cat > templates/_helpers.tpl <<'EOF'
{{- define "wallet.image" -}}
{{ .Values.image.repository }}:{{ .Values.image.tag }}
{{- end -}}
EOF
cd templates
sed -i 's|image: wallet:v1|image: {{ include "wallet.image" . }}|' api.yaml worker.yaml
sed -i 's|replicas: 1|replicas: {{ .Values.api.replicas }}|' api.yaml
sed -i 's|replicas: 1|replicas: {{ .Values.worker.replicas }}|' worker.yaml
sed -i 's|limits: {memory: 128Mi}|limits: {memory: {{ .Values.api.memoryLimit }}}|' api.yaml
sed -i 's|secretKeyRef: {name: wallet-db,|secretKeyRef: {name: {{ .Values.db.existingSecret }},|' api.yaml worker.yaml postgres.yaml
{ echo '{{- if .Values.postgres.enabled }}'; cat postgres.yaml; echo '{{- end }}'; } > p.tmp && mv p.tmp postgres.yaml
cd ~/wallet-gitops
```

Check the chart without a cluster, then install it in its own namespace. The chart does not create the password Secret, so you create it first. In a real team that step is done by one of the tools from Part A; here you do it by hand with a random value that never touches git.

```bash
helm lint chart/wallet
helm template wallet chart/wallet | grep -E '^kind:|^  name:'
kubectl create namespace wallet-helm
kubectl -n wallet-helm create secret generic wallet-db --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 12)"
helm install wallet chart/wallet -n wallet-helm
kubectl -n wallet-helm rollout status deployment/wallet-api
helm upgrade wallet chart/wallet -n wallet-helm --set api.replicas=3
helm history wallet -n wallet-helm
helm rollback wallet 1 -n wallet-helm
helm history wallet -n wallet-helm
kubectl -n wallet-helm get secret
```

Expected, shortened to the lines that matter:

```text
==> Linting chart/wallet
[INFO] Chart.yaml: icon is recommended
1 chart(s) linted, 0 chart(s) failed
kind: Service        name: wallet-api
kind: Service        name: wallet-postgres        <- five objects: no Secret in the chart
kind: Deployment     name: wallet-api
kind: Deployment     name: wallet-worker
kind: StatefulSet    name: wallet-postgres
...
REVISION   STATUS       CHART         DESCRIPTION
1          superseded   wallet-0.1.0  Install complete
2          deployed     wallet-0.1.0  Upgrade complete
...                                     (after the rollback)
1          superseded   wallet-0.1.0  Install complete
2          superseded   wallet-0.1.0  Upgrade complete
3          deployed     wallet-0.1.0  Rollback to 1
NAME                           TYPE                 DATA
sh.helm.release.v1.wallet.v1   helm.sh/release.v1   1
sh.helm.release.v1.wallet.v2   helm.sh/release.v1   1
sh.helm.release.v1.wallet.v3   helm.sh/release.v1   1
wallet-db                      Opaque               1
```

Three facts to take from this output. A rollback is a new revision (3), not a return to revision 1. Helm stored one Secret per revision in the namespace, which is why `helm history` works from any laptop. And the `wallet-db` Secret is not part of the release: `helm uninstall` leaves it behind, which is what you want for a password.

```bash
helm uninstall wallet -n wallet-helm
kubectl delete namespace wallet-helm wallet-dev
git add -A && git commit -m "wallet: chart and kustomize overlays"
```

## Part C · Argo CD: git is the only way in

Now the cluster pulls. You need three things in the cluster: Argo CD, a git server it can reach, and an `Application` that points at your overlay.

**Install Argo CD.** Its CRDs are too large for a client-side apply, so use `--server-side`. Dex (single sign-on) and the notifications controller are not needed here; stopping them saves memory on an 8 GB laptop.

```bash
kubectl create namespace argocd
kubectl apply -n argocd --server-side -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.6.1/manifests/install.yaml
kubectl -n argocd scale deployment argocd-dex-server argocd-notifications-controller --replicas=0
kubectl -n argocd rollout status deployment/argocd-server
kubectl -n argocd get pods
```

```text
NAME                                                READY   STATUS    RESTARTS   AGE
argocd-application-controller-0                     1/1     Running   0          48s
argocd-applicationset-controller-794bb95c9d-jw9h2   1/1     Running   0          50s
argocd-redis-5869b7547-c5tck                        1/1     Running   0          50s
argocd-repo-server-7d55cc466b-nrrs8                 1/1     Running   0          49s
argocd-server-85b849c688-rrqdl                      1/1     Running   0          49s
```

**A git server inside the cluster.** The Application needs a repository URL the cluster can reach. This lab-only server reuses the Argo CD image, which already contains `git daemon`; the `--enable=receive-pack` flag lets you push without SSH keys. Save this as `git-server.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata: {name: git}
---
# LAB ONLY: an unauthenticated git server so the cluster has a repository to pull from.
apiVersion: apps/v1
kind: Deployment
metadata: {name: git-server, namespace: git}
spec:
  replicas: 1
  selector: {matchLabels: {app: git-server}}
  template:
    metadata: {labels: {app: git-server}}
    spec:
      initContainers:
      - name: init-repo
        image: quay.io/argoproj/argocd:v3.6.1
        command: [git, init, --bare, --initial-branch=main, /git/wallet-gitops.git]
        volumeMounts: [{name: repos, mountPath: /git}]
      containers:
      - name: git
        image: quay.io/argoproj/argocd:v3.6.1
        command: [git, daemon, --reuseaddr, --base-path=/git, --export-all, --enable=receive-pack, --verbose, /git]
        ports: [{containerPort: 9418}]
        volumeMounts: [{name: repos, mountPath: /git}]
      volumes: [{name: repos, emptyDir: {}}]
---
apiVersion: v1
kind: Service
metadata: {name: git-server, namespace: git}
spec:
  selector: {app: git-server}
  ports: [{port: 9418}]
```

```bash
kubectl apply -f git-server.yaml
kubectl -n git rollout status deployment/git-server
kubectl -n git port-forward svc/git-server 9418:9418 &        # a tunnel from your laptop, for the push
cd ~/wallet-gitops
git remote add origin git://localhost:9418/wallet-gitops.git
git push -u origin main
```

```text
To git://localhost:9418/wallet-gitops.git
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'.
```

(On the test machine the tunnel used local port 19418 because that port was free and 9418 might not be; everything else is as shown.) The `emptyDir` volume means the repository disappears if the git Pod restarts. Your laptop still has the full history, so push again.

**The Application.** Save this as `application.yaml`. It is the file from the theory, with automated sync, prune and self-heal all on:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata: {name: wallet, namespace: argocd}
spec:
  project: default
  source:
    repoURL: git://git-server.git.svc:9418/wallet-gitops.git
    targetRevision: main
    path: kustomize/overlays/dev
  destination: {server: https://kubernetes.default.svc, namespace: wallet}
  syncPolicy:
    automated: {prune: true, selfHeal: true}
    syncOptions: [CreateNamespace=true]
```

```bash
kubectl apply -f application.yaml
kubectl -n argocd get application wallet -w
```

```text
NAME     SYNC STATUS   HEALTH STATUS
wallet
wallet   Synced        Progressing
wallet   Synced        Healthy          <- 22 seconds after the apply on the test machine
```

This is the first point where you did not run `kubectl apply` on the wallet yourself. Everything in the `wallet` namespace now exists because a commit says so.

**Look at it in the web UI.** Argo CD's server serves HTTPS with a self-signed certificate, which a browser rejects in a scripted test. For the lab, switch it to plain HTTP on the tunnel, then log in as `admin` with the generated password.

```bash
kubectl -n argocd patch configmap argocd-cmd-params-cm --type merge -p '{"data":{"server.insecure":"true"}}'
kubectl -n argocd rollout restart deployment argocd-server
kubectl -n argocd rollout status deployment argocd-server
kubectl -n argocd port-forward svc/argocd-server 8080:80 &
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
```

Open `http://localhost:8080`, log in, and open the `wallet` application in the tree view. The screenshot below is the application tree after the lab: Argo CD 3.6.1, `Healthy`, `Synced to main`, with the Secret, both Services, both Deployments and their ReplicaSets.

![Argo CD web UI, application wallet: Healthy, Synced to main, resource tree](images/lab-7-1-argocd-healthy.png)

*Argo CD v3.6.1 tree view of the application `wallet`, captured with Playwright on the test machine.*

**Make Argo CD fight you.** First, change the cluster by hand. Watch the Deployment while you scale it:

```bash
kubectl -n wallet get deployment wallet-api -w &
kubectl -n wallet scale deployment wallet-api --replicas=5
```

```text
NAME         READY   UP-TO-DATE   AVAILABLE   AGE
wallet-api   1/1     1            1           55s
wallet-api   1/5     1            1           55s     <- your change
wallet-api   1/5     5            1           56s
wallet-api   1/1     5            1           56s     <- Argo CD reverts it ...
wallet-api   1/1     1            1           56s     <- ... within one second
```

Self-heal won: the live replica count went back to what git says. The Deployment events agree: `Scaled up ... from 1 to 5` and, one second later, `Scaled down ... from 5 to 1`.

**Now change the cluster the right way.** Add a patch to the dev overlay, commit, push, and wait:

```bash
cat >> kustomize/overlays/dev/kustomization.yaml <<'EOF'
patches:
- target: {kind: Deployment, name: wallet-api}
  patch: |-
    - {op: replace, path: /spec/replicas, value: 2}
EOF
git add -A && git commit -m "dev: run 2 API replicas" && git push
date +%T; kubectl -n wallet get deployment wallet-api -w
```

Nothing happens for a while, because Argo CD polls git every three minutes by default. On the test machine the push was at 10:59:46 and the second replica appeared at 11:02:14, 2 minutes 28 seconds later. To skip the wait, ask Argo CD to look now:

```bash
kubectl -n argocd annotate application wallet argocd.argoproj.io/refresh=hard --overwrite
```

The moral of the two experiments: a change made in the cluster lasts about a second, and a change made in git reaches the cluster within the poll interval. That asymmetry is what makes git the only door.

## Checkpoint

Run each command and compare. Every row was run on the test machine.

| # | Command | Expected |
| --- | --- | --- |
| 1 | `helm lint chart/wallet` | `1 chart(s) linted, 0 chart(s) failed` |
| 2 | `kubectl kustomize kustomize/overlays/prod \| grep -E 'replicas: 3\|memory: 256Mi'` | two lines: `replicas: 3` and `memory: 256Mi` |
| 3 | `grep -rn lab-only-change-me . --exclude-dir=.git` | exactly one line, in `kustomize/overlays/dev/kustomization.yaml` |
| 4 | `grep -rniE password kustomize/base chart \| grep -v secretKeyRef \| grep -v POSTGRES_PASSWORD` | one line only: the comment in `chart/wallet/values.yaml` (`the chart never holds the password`) |
| 5 | `kubectl -n wallet get secret --show-labels` | one Secret `wallet-db-<hash>` with labels `env=dev,purpose=lab-only` |
| 6 | `kubectl -n argocd get application wallet` | `Synced` and `Healthy` |
| 7 | `kubectl -n wallet scale deployment wallet-api --replicas=5`, then `kubectl -n wallet get deployment wallet-api` a few seconds later | back at the replica count git says |
| 8 | `git log --oneline` | your commits, including `dev: run 2 API replicas`; after Break it also a `Revert` commit |

## Break it

Ship a typo, watch Argo CD report it, and roll back the GitOps way. Add a new image tag and a short progress deadline to the dev overlay. The deadline is only here so that the lab does not wait the default ten minutes before Argo CD calls the rollout failed.

```bash
cat >> kustomize/overlays/dev/kustomization.yaml <<'EOF'
images:
- {name: wallet, newTag: v1-typo}
EOF
# and add one more line to the existing patch, under the replicas line:
#     - {op: add, path: /spec/progressDeadlineSeconds, value: 30}
git add -A && git commit -m "release: wallet v1-typo" && git push
kubectl -n argocd annotate application wallet argocd.argoproj.io/refresh=hard --overwrite
kubectl -n argocd get application wallet -w
```

```text
11:02:28  wallet   OutOfSync     Healthy       <- git moved, the cluster has not
11:02:40  wallet   Synced        Progressing   <- Argo CD applied it
11:03:00  wallet   Synced        Degraded      <- 20 seconds later
```

The interesting word is the pair `Synced` and `Degraded`. The cluster equals git, and git is wrong. Find out why with the commands you used in Vol 5:

![Argo CD web UI, application wallet: Degraded, Synced, caused by Deployment wallet-api](images/lab-7-1-argocd-degraded.png)

*The same application during Break it: `Degraded`, `Synced to main`, "Caused by apps/Deployment:wallet/wallet-api". Captured with Playwright.*

```bash
kubectl -n wallet get pods
kubectl -n wallet describe pod <the new wallet-api pod> | tail -8
kubectl -n wallet get deployment wallet-api -o jsonpath='{.status.conditions[?(@.type=="Progressing")].reason}'
```

```text
wallet-api-5d87ffd844-tpvlv      0/1   ImagePullBackOff   0   84s
wallet-api-6dbd75f46c-8mx49      1/1   Running            0   5m20s   <- the old Pod still serves
wallet-worker-7d69886688-kwsgq   0/1   ImagePullBackOff   0   84s
...
Warning  Failed  kubelet  Failed to pull image "wallet:v1-typo": ... pull access denied, repository does not exist
ProgressDeadlineExceeded
```

The rolling update protected users: the old Pods kept running because the new ones never became ready. Fix it by going back through git, not by `kubectl edit`, which self-heal would undo anyway:

```bash
git revert --no-edit HEAD
git push
kubectl -n argocd annotate application wallet argocd.argoproj.io/refresh=hard --overwrite
git log --oneline
```

```text
aca6f16 Revert "release: wallet v1-typo"
e90b6dd release: wallet v1-typo
b47c14f dev: run 2 API replicas
6d44e27 drop progressDeadlineSeconds from base
...
11:04:19  wallet   Synced   Degraded
11:04:28  wallet   Synced   Healthy         <- 9 seconds after the revert reached Argo CD
```

The bad commit and its revert are both in `git log`. That is the audit trail a `kubectl edit` at 2 a.m. never leaves.

**Questions to answer in your notes.** (1) Which of the three Argo CD switches (auto-sync, self-heal, prune) would you turn off first in production, and why? (2) The worker also got the typo tag. Why did the worker's `Deployment` not turn the application `Degraded` before the API's did? (3) What would `helm rollback` have done in the same situation, and what would Argo CD have done next?

Clean up when you are done: `kill %1 %2` (the tunnels), `kind delete cluster --name cnlab`.
