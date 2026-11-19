# CKA drills

## Exam format and environment

The CKA is a 2-hour, hands-on exam of 15 to 20 command-line tasks on live clusters running Kubernetes v1.37; 66% passes. Checked against the Linux Foundation pages and the CNCF curriculum on 2026-11-16.

| Item | Value | Source |
| --- | --- | --- |
| Format | Online, proctored, performance-based: tasks solved on a command line | [CKA exam page](https://training.linuxfoundation.org/certification/certified-kubernetes-administrator-cka/) |
| Tasks and time | 15 to 20 tasks; 2 hours | [Important Instructions: CKA and CKAD](https://docs.linuxfoundation.org/tc-docs/certification/tips-cka-and-ckad) |
| Passing score | 66% or above | [FAQ: CKA, CKAD and CKS](https://docs.linuxfoundation.org/tc-docs/certification/faq-cka-ckad-cks) |
| Kubernetes version | v1.37; the environment follows the latest minor within about 4 to 8 weeks of its release | Exam page and Important Instructions |
| Retake and validity | One retake included; valid 2 years; 12 months to schedule and take it | Exam page |
| Curriculum | `CKA_Curriculum_v1.37.pdf` in [github.com/cncf/curriculum](https://github.com/cncf/curriculum) | CNCF curriculum repository |

**Environment.** The exam runs in the PSI Secure Browser with a Linux remote desktop. Each task names a host: you `ssh` to it, do the work, and `exit` back to the base system (hostname `base`); nested ssh is not supported and `base` must not be rebooted. On a host you may use `sudo -i`, and `kubectl` (with the `k` alias and Bash completion), `yq`, `curl`, `wget` and `man` are installed; `base` has none of them. In the terminal copy and paste with Ctrl+Shift+C and Ctrl+Shift+V, close tabs with Ctrl+Alt+W, and type `i` in vim because the Insert key is blocked. Source: [Important Instructions: CKA and CKAD](https://docs.linuxfoundation.org/tc-docs/certification/tips-cka-and-ckad).

**Allowed documentation** ([resources allowed](https://docs.linuxfoundation.org/tc-docs/certification/certification-resources-allowed)): kubernetes.io/docs, kubernetes.io/blog, helm.sh/docs and, for the CKA only, gateway-api.sigs.k8s.io, plus pages linked from a task's Quick Reference box. Searching kubernetes.io/docs is allowed, but you must not open external search results.

**Domains** (CNCF curriculum PDF): Troubleshooting 30%, Cluster Architecture, Installation and Configuration 25%, Services and Networking 20%, Workloads and Scheduling 15%, Storage 10%.

## Timed tasks by exam domain

Fourteen tasks, one or more per domain, about 85 minutes in total. The budgets are this guide's suggestion: the exam gives 2 hours for 15 to 20 tasks, so 6 to 8 minutes on average, and easy tasks should come in under the budget to pay for hard ones. All fourteen were solved on a kind cluster (kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1, Helm v4.3.1, 2026-11-17); the last column is how long the reference commands took when pasted, which is not a human time. Reference solutions are not printed here; they are in the Instructor Companion.

**Lab cluster.** Two nodes, with metrics-server installed (Metrics API card). On a node, the exam uses `ssh`; here use `docker exec -it cnlab-worker bash`.

```bash
cat > kind-2nodes.yaml <<'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes: [{role: control-plane}, {role: worker}]
EOF
kind create cluster --name cnlab --image kindest/node:v1.37.0 --config kind-2nodes.yaml
```

Run each task's **Setup** first, start a timer, and solve it with the Kubernetes documentation open (that is allowed in the exam; nothing else is). Then run the **Check**. Node names below are `cnlab-control-plane` and `cnlab-worker`; with another cluster name, change them.

| # | Domain (weight) | Task in one line | Budget | Reference ran in |
| --- | --- | --- | --- | --- |
| 1 | Troubleshooting (30%): clusters and nodes | A node is NotReady | 6 min | 2 s |
| 2 | Troubleshooting: services | A Service has no endpoints | 6 min | 1 s |
| 3 | Troubleshooting: application | A Pod crash-loops | 6 min | 2 s |
| 4 | Troubleshooting: monitor resource usage | Find the busiest Pod | 4 min | under 1 s |
| 5 | Cluster Architecture (25%): RBAC | Read-only access to Pods | 6 min | 2 s |
| 6 | Cluster Architecture: lifecycle | Back up etcd | 8 min | 1 s |
| 7 | Cluster Architecture: Helm | Install, upgrade, roll back a chart | 7 min | 4 s |
| 8 | Services and Networking (20%): NetworkPolicy | Only the frontend may reach the database | 8 min | 9 s |
| 9 | Services and Networking: Services | ClusterIP and NodePort for one Deployment | 5 min | 1 s |
| 10 | Workloads and Scheduling (15%): rolling update | Recover a stuck rollout | 5 min | 15 s |
| 11 | Workloads and Scheduling: autoscaling | Create an HPA | 5 min | 42 s (waits for metrics) |
| 12 | Workloads and Scheduling: scheduling | Taint, toleration, node selector | 6 min | 3 s |
| 13 | Storage (10%) | PV, PVC and a Pod that keeps data | 8 min | 3 s |
| 14 | Cluster Architecture: lifecycle | Drain a node, then uncordon | 5 min | 3 s (the drain itself) |

### Task 1 · NotReady node (6 min)

Setup: `docker exec cnlab-worker systemctl stop kubelet`, then wait about a minute.

Task: node `cnlab-worker` is `NotReady`. Find the cause and make it `Ready` again.

Check: `kubectl get node cnlab-worker` shows `Ready`. Cards: kubelet, Node, Troubleshooting playbook.

### Task 2 · Service without endpoints (6 min)

```bash
kubectl create ns d2; kubectl -n d2 create deploy shop --image=nginx:1.31.8 --replicas=2
kubectl -n d2 apply -f - <<'EOF'
apiVersion: v1
kind: Service
metadata: {name: shop}
spec: {selector: {app: shopp}, ports: [{port: 80, targetPort: 8080}]}
EOF
```

Task: in namespace `d2`, `http://shop` must return the nginx welcome page from inside the cluster. Fix the Service without touching the Deployment.

Check: `kubectl -n d2 run t --rm -i --restart=Never --image=busybox:1.37 -- wget -qO- -T 3 http://shop | grep -c 'Welcome to nginx'` prints `1`. Cards: Service, EndpointSlice.

### Task 3 · Crash loop (6 min)

```bash
kubectl create ns d3; kubectl -n d3 create cm reports-cfg --from-literal=app.conf='mode=dev'
kubectl -n d3 apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata: {name: reports}
spec:
  replicas: 1
  selector: {matchLabels: {app: reports}}
  template:
    metadata: {labels: {app: reports}}
    spec:
      containers:
      - name: app
        image: busybox:1.37
        command: ["sh","-c","grep -q '^mode=prod' /etc/app/app.conf || { echo 'FATAL: mode must be prod' >&2; exit 1; }; sleep 3600"]
        volumeMounts: [{name: cfg, mountPath: /etc/app}]
      volumes: [{name: cfg, configMap: {name: reports-cfg}}]
EOF
```

Task: Deployment `reports` in `d3` keeps failing. Find out why from the Pod's own output and fix it so the Pod is `Running`. (If `logs --previous` answers `unable to retrieve container logs`, wait for the next restart and try again.)

Check: `kubectl -n d3 get pods -l app=reports` shows `1/1 Running`. Cards: ConfigMap, Logs, events and kubectl debug.

### Task 4 · Busiest Pod (4 min)

```bash
kubectl create ns d4
kubectl -n d4 create deploy idle1 --image=busybox:1.37 -- sleep 3600
kubectl -n d4 create deploy idle2 --image=busybox:1.37 -- sleep 3600
kubectl -n d4 create deploy hog --image=busybox:1.37 -- sh -c 'while true; do :; done'
```

Task: after about 45 seconds, write the name of the Pod in `d4` that uses the most CPU to `/tmp/d4-answer`.

Check: `cat /tmp/d4-answer` starts with `hog-`. Card: Metrics API and metrics-server.

### Task 5 · RBAC (6 min)

Setup: `kubectl create ns d5`.

Task: in `d5` create ServiceAccount `auditor` and let it `get`, `list` and `watch` Pods in that namespace only, using a Role named `pod-reader` and a RoleBinding.

Check: `kubectl auth can-i list pods -n d5 --as=system:serviceaccount:d5:auditor` prints `yes`; `... delete pods -n d5 ...` prints `no`; `... list pods -n default ...` prints `no`. Card: RBAC.

### Task 6 · etcd snapshot (8 min)

Task: save a snapshot of etcd to `/var/lib/etcd/d6-backup.db` on the control-plane node and show its status. On kind etcd has no tools on the node, so run `etcdctl` and `etcdutl` inside the `etcd-cnlab-control-plane` Pod (`kubectl -n kube-system exec`); in the exam you run them on the node. Take the endpoint and certificate paths from the etcd static Pod manifest.

Check: `docker exec cnlab-control-plane ls -l /var/lib/etcd/d6-backup.db` shows a file of several MB; `etcdutl snapshot status` prints a table with `TOTAL KEYS`. Card: etcd backup and restore.

### Task 7 · Helm (7 min)

Setup: `mkdir /tmp/chart && cd /tmp/chart && helm create shop && kubectl create ns d7`.

Task: install `./shop` as release `shop` in `d7` with 2 replicas and Service type `NodePort`; upgrade it to 3 replicas with image tag `1.31.8`; then roll back to revision 1.

Check: `kubectl -n d7 get deploy shop -o jsonpath='{.spec.replicas}'` prints `2`; the Service type is `NodePort`; `helm history shop -n d7` lists 3 revisions. Card: Helm and Kustomize.

### Task 8 · NetworkPolicy (8 min)

```bash
kubectl create ns d8
kubectl -n d8 run db --image=nginx:1.31.8 --labels=role=db
kubectl -n d8 run frontend --image=busybox:1.37 --labels=role=frontend -- sleep 3600
kubectl -n d8 run other --image=busybox:1.37 --labels=role=other -- sleep 3600
```

Task: in `d8`, allow ingress to Pod `db` on TCP 80 only from Pods labelled `role=frontend`.

Check: with `DB=$(kubectl -n d8 get pod db -o jsonpath='{.status.podIP}')`, `kubectl -n d8 exec frontend -- wget -qO- -T 3 http://$DB` prints the nginx page and `kubectl -n d8 exec other -- wget -qO- -T 3 http://$DB` ends with `wget: download timed out`. Card: NetworkPolicy.

### Task 9 · Services (5 min)

Setup: `kubectl create ns d9; kubectl -n d9 create deploy web --image=nginx:1.31.8 --replicas=2`.

Task: expose Deployment `web` inside the cluster as Service `web-int` (port 80), and as NodePort Service `web-np` with node port 30080.

Check: `kubectl -n d9 get endpointslices` lists two addresses per Service, and a busybox Pod can `wget -qO- http://<worker IP>:30080`. Card: Service.

### Task 10 · Stuck rollout (5 min)

Setup: `kubectl create ns d10; kubectl -n d10 create deploy pay --image=nginx:1.30 --replicas=3; kubectl -n d10 rollout status deploy/pay; kubectl -n d10 set image deploy/pay nginx=nginx:1.99.99`.

Task: the update to `nginx:1.99.99` cannot finish. Bring the Deployment back to a working state, then update it to `nginx:1.31.8`.

Check: `kubectl -n d10 get deploy pay -o jsonpath='{.spec.template.spec.containers[0].image} {.status.readyReplicas}'` prints `nginx:1.31.8 3`. Card: Deployment.

### Task 11 · HPA (5 min)

Setup: `kubectl create ns d11` and apply the `burn` Deployment from the HorizontalPodAutoscaler card into it.

Task: create an HPA for `burn` with 2 to 5 replicas at 50% CPU.

Check: after about 40 seconds `kubectl -n d11 get hpa burn` shows a numeric target (`cpu: 200%/50%`), `MINPODS 2`, `MAXPODS 5`. Card: HorizontalPodAutoscaler.

### Task 12 · Scheduling (6 min)

Setup: `kubectl create ns d12; kubectl taint node cnlab-worker dedicated=batch:NoSchedule; kubectl label node cnlab-worker disk=ssd`.

Task: create Pod `job-x` (busybox, `sleep 3600`) in `d12` that runs on the node labelled `disk=ssd`, although that node is tainted.

Check: `kubectl -n d12 get pod job-x -o jsonpath='{.spec.nodeName}'` prints `cnlab-worker`. Afterwards remove the taint: `kubectl taint node cnlab-worker dedicated=batch:NoSchedule-`. Card: Taints, tolerations and affinity.

### Task 13 · Storage (8 min)

Setup: `kubectl create ns d13`.

Task: create a 1Gi `hostPath` PersistentVolume `pv-d13` (`/tmp/pv-d13`, class `manual`, reclaim policy `Retain`), a 500Mi claim `data` in `d13` that binds to it, and Pod `writer` that mounts it at `/data` and writes the text `hello` to `/data/f`.

Check: `kubectl get pv pv-d13 -o jsonpath='{.status.phase}'` prints `Bound`; `kubectl -n d13 exec writer -- cat /data/f` prints `hello`. Cards: PersistentVolume, PersistentVolumeClaim.

### Task 14 · Node maintenance (5 min)

Setup: a clean cluster (delete bare Pods left by other tasks first: a drain refuses them) and `kubectl create ns d14; kubectl -n d14 create deploy app --image=nginx:1.31.8 --replicas=3`.

Task: take `cnlab-worker` out of service for maintenance, show where the `app` Pods are now, and put the node back.

On the test cluster the drain evicted the three `app` Pods, which then waited as `Pending` (one schedulable node, and the control plane is tainted); after `uncordon` they were `Running` on the worker again within 30 s. Pods without a controller from other tasks block a drain, so delete them first.

Check: `kubectl get nodes` shows no `SchedulingDisabled`. Card: Node maintenance and eviction.

## Self-check list

Tick an item only when you did it from memory, with the documentation closed, in under the time it deserves. Cards are in this guide; the curriculum is `CKA_Curriculum_v1.37.pdf` (opened 2026-11-17).

**Troubleshooting (30%)**

- [ ] Find why a node is `NotReady` and bring it back (kubelet status, `journalctl -u kubelet`).
- [ ] Read a Pod's reason from `describe` events and `logs --previous`.
- [ ] Tell `Pending` for CPU, for a PVC and for a taint apart.
- [ ] Fix a Service with no endpoints (selector, `targetPort`) and test DNS from a Pod.
- [ ] Use `kubectl top` and `--sort-by` to find the busiest Pod.
- [ ] Check control-plane Pods and the static Pod manifests.

**Cluster Architecture, Installation and Configuration (25%)**

- [ ] Create a Role, ClusterRole and bindings, and verify with `auth can-i --as`.
- [ ] Take an etcd snapshot and describe the restore steps.
- [ ] Read `kubeadm upgrade plan` and state the upgrade order and the skew rules.
- [ ] Install, upgrade and roll back with Helm; render with Kustomize.
- [ ] Install a CRD and create an object; explain what an operator adds.

**Services and Networking (20%)**

- [ ] Write a NetworkPolicy from a sentence.
- [ ] Create ClusterIP and NodePort Services and read their EndpointSlices.
- [ ] Know where Ingress and Gateway API fit (Group 4 cards).

**Workloads and Scheduling (15%)**

- [ ] Roll out, pause, undo and check a Deployment.
- [ ] Create an HPA and read its conditions.
- [ ] Place a Pod with `nodeSelector`, taints and tolerations.
- [ ] Use ConfigMaps and Secrets in a Pod.

**Storage (10%)**

- [ ] Create a PV, a PVC and a Pod using it; state access modes and reclaim policies.
- [ ] Use a StorageClass for dynamic provisioning.

**Exam skills**

- [ ] Set the `k` alias and Bash completion, and use `--dry-run=client -o yaml` to generate manifests.
- [ ] Always pass `-n` and check the current context before each task.
