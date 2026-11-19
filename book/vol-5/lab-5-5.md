# Lab 5.5 · kubeadm, CRI-O and an etcd Restore

## Goal

You will look inside a real kubeadm control-plane node, back up etcd and restore it, empty a node without losing a request, and then build a two-machine cluster by hand and swap its container runtime.

**Versions tested** (2026-11-16, replayed 2026-11-17 and 2026-11-18, Ubuntu 26.04 on WSL2 with Docker Desktop; parts A to C): kind v0.33.0, node image `kindest/node:v1.37.0` (kubeadm v1.37.0, containerd v2.3.4, etcd 3.7.0), kubectl v1.37.1. Every output in parts A to C came from those runs. The replays of 2026-11-17 and 2026-11-18 matched them except where the text says otherwise (A4, B3, B4 and C3 changed after the replays; A2 and B1 differ only in numbers); Break it was not part of the replays. Node names, IDs and timestamps differ on your machine; the shapes do not.

**Versions targeted, not run on the test machine** (part D): Ubuntu 24.04 LTS on two VMs, kubeadm, kubelet and kubectl 1.37 from the `pkgs.k8s.io` v1.37 repository, CRI-O v1.37, the Flannel Pod network. The steps are copied from the official pages linked in part D. We have not executed them, so read the expected result there as what the documentation promises.

**Before you start:** the 3-node cluster from Lab 5.1 (`kind create cluster --name cnlab-vol5 --image kindest/node:v1.37.0 --config kind-3nodes.yaml`) with the wallet deployed as in Milestone 5 (your numbered manifests `00` to `04`). Nodes are `cnlab-vol5-control-plane`, `cnlab-vol5-worker` and `cnlab-vol5-worker2`. Part C adds one more file, `05-pdb.yaml`. Part D needs two Ubuntu 24.04 VMs with 2 CPUs and 2 GB RAM each and full network access to each other. Plan about 4 hours: 45 minutes each for parts A to C, 90 minutes for part D.

### What you will build

{{diagram lab-5-5-01.jsx | what you will do in Lab 5.5 · three parts on kind, one on two VMs}}

Three parts happen on your laptop in a kind cluster, which is a set of Docker containers pretending to be VMs. Part D, with dashed lines, needs real VMs.

## Part A · Look inside a kubeadm node (45 min)

You will find, on disk and in the runtime, everything that `kubeadm init` made. A kind node is a Docker container that runs a real kubelet, so it has the same files as a VM. `docker exec <node> <command>` runs one command inside it.

**A1 · The control plane is four files.** List the folder that the kubelet watches, and the line of its configuration that names it:

```bash
docker exec cnlab-vol5-control-plane kubeadm version -o short
docker exec cnlab-vol5-control-plane ls /etc/kubernetes/manifests
docker exec cnlab-vol5-control-plane grep staticPodPath /var/lib/kubelet/config.yaml
kubectl -n kube-system get pods -o wide
```

You should see `v1.37.0`, then the four files `etcd.yaml`, `kube-apiserver.yaml`, `kube-controller-manager.yaml` and `kube-scheduler.yaml`, then `staticPodPath: /etc/kubernetes/manifests`. The last command lists Pods named `etcd-cnlab-vol5-control-plane`, `kube-apiserver-cnlab-vol5-control-plane` and so on. They are mirrors: the kubelet runs the file and reports a read-only copy to the API server.

**A2 · The certificates and their expiry.**

```bash
docker exec cnlab-vol5-control-plane kubeadm certs check-expiration
```

The output has eleven rows from `admin.conf` to `super-admin.conf`, and a second table with three certificate authorities. On the test machine every row said `364d`, one day short of a year because the cluster was minutes old. The third column counts down, so `kubeadm certs check-expiration` is the command to put in a calendar alert.

**A3 · The runtime below the kubelet.** Look at the worker, where the wallet runs. First the kubelet's own settings, then the runtime through the CRI:

```bash
docker exec cnlab-vol5-worker grep -E 'cgroupDriver|containerRuntimeEndpoint|staticPodPath' /var/lib/kubelet/config.yaml
docker exec cnlab-vol5-worker crictl version
docker exec cnlab-vol5-worker crictl ps
docker exec cnlab-vol5-worker crictl pods
```

Real output on the test machine (the wallet was running; the two tables are trimmed to the columns that fit):

```text
cgroupDriver: systemd
containerRuntimeEndpoint: unix:///run/containerd/containerd.sock
staticPodPath: /etc/kubernetes/manifests

RuntimeName:  containerd
RuntimeVersion:  v2.3.4
RuntimeApiVersion:  v1

CONTAINER      IMAGE          STATE     NAME         POD
e69f126b2ac75  140936e8665d5  Running   postgres     postgres-0
dd923ce583595  4c8a356793e7a  Running   api          wallet-api
3e48351746247  4626fe10df5b9  Running   kindnet-cni  kindnet-vh
5008be313d467  d6a28daf3e6b0  Running   kube-proxy   kube-proxy
```

`crictl ps` lists containers and `crictl pods` lists the Pod sandboxes that hold them. Your IDs differ.

**A4 · Replay `kubeadm init` without changing anything.** `--dry-run` runs every phase but writes to a scratch folder and sends the API calls to a fake client. Setting `KUBEADM_INIT_DRYRUN_DIR` picks that folder. `--node-name` keeps the pretend node apart from the real one, and `--kubernetes-version` stops kubeadm from asking the internet for the newest patch release (without it we saw it choose `v1.37.2`). `--ignore-preflight-errors=all` is needed only because this node already runs a control plane; the paragraph after the output says what happens without it.

```bash
docker exec -e KUBEADM_INIT_DRYRUN_DIR=/tmp/kdry cnlab-vol5-control-plane \
  kubeadm init --dry-run --node-name dryrun --kubernetes-version v1.37.0 \
  --ignore-preflight-errors=all > dryrun.txt 2>&1
grep -oE '^\[[a-z-]+\]' dryrun.txt | grep -v dryrun | uniq
grep -c WARNING dryrun.txt
grep 'adding the taints' dryrun.txt
grep -A1 'kubeadm join' dryrun.txt | tail -2
```

Real output of the replay on 2026-11-18 (the token and hash are random):

```text
[init]
[preflight]
[certs]
[kubeconfig]
[etcd]
[control-plane]
[kubelet-start]
[patches]
[kubelet-start]
[wait-control-plane]
[upload-config]
[kubelet]
[upload-certs]
[mark-control-plane]
[bootstrap-token]
[addons]
14
[mark-control-plane] Marking the node dryrun as control-plane by adding the taints [node-role.kubernetes.io/control-plane:NoSchedule]
kubeadm join 172.21.0.4:6443 --token abcdef.0123456789abcdef \
	--discovery-token-ca-cert-hash sha256:<hash>
```

The dry run exits with code 0 after about 2,000 lines of output, and the greps print sixteen phase tags (`[kubelet-start]` appears twice), the number 14, the taint line and the join line. The 14 is the count of WARNING lines. They are the reason for the flag: ports 6443, 10257, 10259, 10250, 2379 and 2380 are in use, the four manifests and `/var/lib/etcd` already exist, and swap and the hostname `dryrun` (twice) get a warning. Without `--ignore-preflight-errors=all` the same checks are errors. The dry run then stops in the preflight phase with `[ERROR Port-6443]: Port 6443 is in use`, ten more `[ERROR ...]` lines (11 in total on the test machine) and `error: error execution phase preflight: preflight checks failed`. Ignoring them is safe here because a dry run writes only to `/tmp/kdry`. We listed `/etc/kubernetes` and `/etc/kubernetes/manifests` after the run, and the real certificates, kubeconfigs and manifests were untouched.

**A5 · The join token.** The real cluster has one too:

```bash
docker exec cnlab-vol5-control-plane kubeadm token list
```

On the test machine it showed `abcdef.0123456789abcdef`, usages `authentication,signing`, group `system:bootstrappers:kubeadm:default-node-token` and a 24-hour TTL (the TTL column showed 23h, the time left, a few minutes after the cluster started). That token comes from the kind configuration. A token that `kubeadm init` makes has a random value.

1. Which of the four manifests would you edit to give the API server a new flag? What does the kubelet do the moment you save it?
2. `kubectl get nodes` works only while the API server runs. Which command in this part still works if it does not?
3. In `dryrun.txt`, find the `etcd.yaml` that kubeadm would write. Which `--data-dir` does it use, and why does Part B care?

## Part B · Back up etcd and restore it (45 min)

You will take a snapshot, change the cluster, then go back to the snapshot and see exactly what a restore undoes. The tools are in the etcd image, so you run them inside the etcd Pod with `kubectl exec`, one call per command.

**B1 · Make a ConfigMap to lose, then save.** The `hello` ConfigMap will exist at snapshot time. Later you will delete it.

```bash
kubectl create configmap hello --from-literal=greeting=hi
kubectl -n kube-system exec etcd-cnlab-vol5-control-plane -- etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save /var/lib/etcd/snapshot.db
```

The three certificate flags are copied from the etcd manifest you listed in Part A. Real output ends with:

```text
Snapshot saved at /var/lib/etcd/snapshot.db
Server version 3.7.0
{"level":"info","ts":"2026-11-17T06:58:31.017425Z","caller":"snapshot/v3_snapshot.go:111","msg":"fetched snapshot","endpoint":"https://127.0.0.1:2379","size":"2.9 MB","took":"239.105279ms","etcd-version":"3.7.0"}
{"level":"info","ts":"2026-11-17T06:58:31.019458Z","caller":"snapshot/v3_snapshot.go:121","msg":"saved","path":"/var/lib/etcd/snapshot.db"}
```

`/var/lib/etcd` is a folder of the node, mounted into the Pod, so the file is on the node's disk. Now check it with the offline tool, `etcdutl`, which reads the file and needs no certificates:

```bash
kubectl -n kube-system exec etcd-cnlab-vol5-control-plane -- etcdutl snapshot status /var/lib/etcd/snapshot.db -w table
docker exec cnlab-vol5-control-plane ls -l /var/lib/etcd
```

```text
┌──────────┬──────────┬────────────┬────────────┬─────────┐
│   HASH   │ REVISION │ TOTAL KEYS │ TOTAL SIZE │ VERSION │
├──────────┼──────────┼────────────┼────────────┼─────────┤
│ ce72d714 │     1304 │        518 │     2.9 MB │   3.7.0 │
└──────────┴──────────┴────────────┴────────────┴─────────┘
```

The listing shows the `member` folder and `snapshot.db` of 2.9 MB (the first run, in a cluster that held more objects, wrote 8.8 MB). Your hash, revision and key count differ. The chapter's chart shows how long the save, the restore and the switch took on the test machine. **Treat this file as a secret.** It holds every Secret in the cluster, and Milestone 5 reads it from this exact path, so keep it there and never commit it to git.

**B2 · Change the cluster after the snapshot.**

```bash
kubectl create configmap after-snapshot --from-literal=k=v
kubectl delete configmap hello
kubectl get configmap
```

You should see `after-snapshot` and no `hello`.

**B3 · Restore into a new folder.** `etcdutl snapshot restore` only writes files. It does not touch the running etcd.

```bash
kubectl -n kube-system exec etcd-cnlab-vol5-control-plane -- etcdutl snapshot restore /var/lib/etcd/snapshot.db --data-dir /var/lib/etcd/restored --bump-revision 1000000000 --mark-compacted
docker exec cnlab-vol5-control-plane ls /var/lib/etcd /var/lib/etcd/restored
```

The log ends with a `restored snapshot` line that names the `wal-dir` and `data-dir` under `/var/lib/etcd/restored`. The listing shows `member`, `restored` and `snapshot.db` in the first folder and `member` in the second.

`--bump-revision 1000000000 --mark-compacted` makes the restored database continue at a revision far above anything the old cluster reached. etcd 3.7.0 documents them in `etcdutl snapshot restore --help`: "How much to increase the latest revision after restore" and "Mark the latest revision after restore as the point of scheduled compaction (required if --bump-revision > 0)". The number is our choice. We added the flags after two failed replays, described under B4. We tested only this value and have not proven why the flags help (our guess: components remember the newest resource version they saw, and a plain restore starts lower).

**B4 · Swap the data directory with the API server stopped.** The documentation says to stop every API server, restore, then restart them ([Operating etcd clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)). While the API server is down `kubectl` cannot answer, so you work on the node with `crictl`. First stop it. The kubelet stops a static Pod when its manifest leaves the folder:

```bash
docker exec cnlab-vol5-control-plane mv /etc/kubernetes/manifests/kube-apiserver.yaml /etc/kubernetes/kube-apiserver.yaml.off
until [ -z "$(docker exec cnlab-vol5-control-plane crictl ps -q --name kube-apiserver)" ]; do sleep 1; done
```

The loop ended after 31 s on the test machine, in both runs. Now point etcd at the new folder. etcd is a static Pod too, so editing its manifest restarts it. Remember the old container ID, change the `--data-dir` flag, read the line back and wait for a new container:

```bash
OLD=$(docker exec cnlab-vol5-control-plane crictl ps -q --name '^etcd$')
docker exec cnlab-vol5-control-plane sed -i 's#--data-dir=/var/lib/etcd$#--data-dir=/var/lib/etcd/restored#' /etc/kubernetes/manifests/etcd.yaml
docker exec cnlab-vol5-control-plane grep -n data-dir /etc/kubernetes/manifests/etcd.yaml
until NEW=$(docker exec cnlab-vol5-control-plane crictl ps -q --name '^etcd$'); [ -n "$NEW" ] && [ "$NEW" != "$OLD" ]; do sleep 1; done
```

```text
18:    - --data-dir=/var/lib/etcd/restored
```

The new etcd container started 13 to 15 s after the edit. Last, put the API server manifest back, wait until it is ready, and look at the result:

```bash
docker exec cnlab-vol5-control-plane mv /etc/kubernetes/kube-apiserver.yaml.off /etc/kubernetes/manifests/kube-apiserver.yaml
until kubectl get --raw /readyz >/dev/null 2>&1; do sleep 2; done
kubectl get configmap hello
kubectl get configmap
kubectl -n wallet get pods
```

Real output of the replay on 2026-11-18 (the API server answered 5 s after its manifest came back):

```text
NAME    DATA   AGE
hello   1      56s
NAME               DATA   AGE
hello              1      57s
kube-root-ca.crt   1      3m52s
NAME                             READY   STATUS    RESTARTS   AGE
postgres-0                       1/1     Running   0          3m4s
wallet-api-ffd6cb76b-hcsjx       1/1     Running   0          3m4s
wallet-api-ffd6cb76b-lhz7q       1/1     Running   0          3m4s
wallet-worker-6cbdf67665-kf282   1/1     Running   0          3m4s
wallet-worker-6cbdf67665-t4pts   1/1     Running   0          3m4s
```

`hello` is back, `after-snapshot` is gone, and the single get and the list agree. We repeated the list twice more, 10 s apart, with the same answer. The cluster went back in time to the snapshot. The wallet Pods are `Running`: the kubelets kept the containers they had, because a restore changes what the API server knows, not what is running.

Two earlier attempts failed, and this is why B3 and B4 look as they do. First, on 2026-11-17 we edited only the etcd manifest and left the API server running. `kubectl get configmap hello` then found `hello`, but `kubectl get configmap` listed `after-snapshot` and not `hello`. The two answers still disagreed when we stopped watching after 3 minutes, and they agreed after we restarted the API server. Second, on 2026-11-18 we stopped the API server as above but restored without the two flags. The cluster looked healthy, yet `kube-proxy` on a worker held the rule `default/kubernetes:https has no endpoints` and rejected traffic to the API Service. New CoreDNS Pods stayed `0/1` with `Plugins not ready: "kubernetes"` until we restarted the kube-proxy DaemonSet and then CoreDNS. With the flags in B3 neither problem appeared: the rule was absent and a CoreDNS restart finished normally. We have one run of each variant, not a statistic.

On a real kubeadm cluster there is one more step that kind does not need: set `etcd.local.dataDir` in the `kubeadm-config` ConfigMap. Otherwise the next `kubeadm upgrade` writes an etcd manifest for the old folder. The documentation also recommends restarting the scheduler, the controller manager and the kubelets after the restore, and with several control-plane nodes you stop every API server first (see [Operating etcd clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)). On our one-node cluster we restarted none of the three. The scheduler and the controller manager had restarted themselves (the documentation says they lose their leader lock during a restore), and a scale-up of `wallet-worker` from 2 to 3 Pods and back worked right after B4.

1. The restore wrote to `/var/lib/etcd/restored`, not over `/var/lib/etcd/member`. Why is a new folder safer than deleting the old one first?
2. The snapshot has no `after-snapshot`, but the cluster also created Pods and leases after your snapshot. Where did those changes go, and why did the wallet Pods not stop?
3. A snapshot holds objects, not volume contents. Which data of the wallet would you still lose if the node's disk died?

## Part C · Empty a node without losing a request (45 min)

You will add a budget for the API, measure a drain with a request probe, and see how cordon and drain differ. A **request probe** is a Pod that calls the wallet API twice a second and prints `ok` or `FAIL`, so you can count failures instead of guessing.

**C1 · The budget and the probe.** Save the budget as `05-pdb.yaml`. It says that at least one `wallet-api` Pod must stay available:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: wallet-api
  namespace: wallet
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: wallet-api
```

Save the probe as `probe.yaml`. It is pinned to the control-plane node, which you will not drain, so the probe itself never moves:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: probe
  namespace: wallet
spec:
  nodeName: cnlab-vol5-control-plane
  terminationGracePeriodSeconds: 1
  containers:
    - name: c
      image: busybox:1.37
      command:
        - sh
        - -c
        - |
          while true; do
            if wget -q -T 1 -O /dev/null http://wallet-api/readyz 2>/dev/null; then echo "$(date +%s) ok"; else echo "$(date +%s) FAIL"; fi
            sleep 0.5
          done
```

```bash
kubectl apply -f 05-pdb.yaml -f probe.yaml
kubectl -n wallet wait --for=condition=Ready pod/probe --timeout=60s
kubectl -n wallet get pdb
kubectl -n wallet get pods -o wide
```

The budget shows `MIN AVAILABLE 1`, and its `ALLOWED DISRUPTIONS` is 1 while both API Pods are `Ready`. The Pod listing tells you which node holds `postgres-0` and which nodes hold the two `wallet-api` Pods. The drain in C3 targets a worker that holds an API Pod but not `postgres-0`. That drain has something to evict, and it can still finish.

**C2 · Cordon is only half a drain.** Cordon marks a node unschedulable and leaves its Pods alone.

```bash
kubectl cordon cnlab-vol5-worker2
kubectl get nodes
kubectl uncordon cnlab-vol5-worker2
```

The first command prints `node/cnlab-vol5-worker2 cordoned`, and `kubectl get nodes` then shows `SchedulingDisabled` next to its status. Nothing was evicted.

**C3 · A drain that has something to evict.** Pick a worker that holds a `wallet-api` Pod but not `postgres-0`. The first two lines below find it. `grep -vx` drops the node of `postgres-0` by exact match. A plain `grep -v` would also drop `cnlab-vol5-worker2` when `postgres-0` runs on `cnlab-vol5-worker`. Restart the probe so that its log covers only this drain:

```bash
PG=$(kubectl -n wallet get pod postgres-0 -o jsonpath='{.spec.nodeName}')
VICTIM=$(kubectl -n wallet get pods -l app=wallet-api -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}' | grep -vx "$PG" | head -1)
echo "postgres-0 on $PG, draining $VICTIM"
kubectl -n wallet delete pod probe --now
kubectl apply -f probe.yaml
kubectl -n wallet wait --for=condition=Ready pod/probe --timeout=60s
kubectl drain $VICTIM --ignore-daemonsets --delete-emptydir-data --timeout=120s
```

If `VICTIM` is empty, both API Pods run on the node of `postgres-0`. Delete one of them with `kubectl -n wallet delete pod <name>`, wait for the replacement and look again (we did not need this). If the drain stops with `cannot delete Pods that declare no controller ... default/client`, a bare Pod from Lab 5.3 is in the way. Run `kubectl delete pod client` and repeat the drain command (we met this once, in a cluster that still had the Lab 5.3 Pod).

Real output of the replay on 2026-11-18 (our test cluster had another name, so we shortened the node names to the ones in this lab):

```text
postgres-0 on cnlab-vol5-worker2, draining cnlab-vol5-worker
pod "probe" deleted from wallet namespace
pod/probe created
pod/probe condition met
node/cnlab-vol5-worker cordoned
Warning: ignoring DaemonSet-managed Pods: kube-system/kindnet-kcsvf, kube-system/kube-proxy-c8xb9
evicting pod wallet/wallet-worker-6cbdf67665-kf282
evicting pod wallet/wallet-api-ffd6cb76b-lhz7q
pod/wallet-api-ffd6cb76b-lhz7q evicted
pod/wallet-worker-6cbdf67665-kf282 evicted
node/cnlab-vol5-worker drained
```

Now read what the users saw, and put the node back:

```bash
kubectl -n wallet get pods -o wide
kubectl -n wallet logs probe | grep -c ok
kubectl -n wallet logs probe | grep -c FAIL
kubectl uncordon $VICTIM
```

```text
NAME                             READY   STATUS    RESTARTS   AGE    IP           NODE                       NOMINATED NODE   READINESS GATES
postgres-0                       1/1     Running   0          5m1s   10.244.1.5   cnlab-vol5-worker2         <none>           <none>
probe                            1/1     Running   0          23s    10.244.0.7   cnlab-vol5-control-plane   <none>           <none>
wallet-api-ffd6cb76b-hcsjx       1/1     Running   0          5m1s   10.244.1.2   cnlab-vol5-worker2         <none>           <none>
wallet-api-ffd6cb76b-smgzc       1/1     Running   0          15s    10.244.1.9   cnlab-vol5-worker2         <none>           <none>
wallet-worker-6cbdf67665-hxn8r   1/1     Running   0          15s    10.244.1.8   cnlab-vol5-worker2         <none>           <none>
wallet-worker-6cbdf67665-t4pts   1/1     Running   0          5m1s   10.244.1.4   cnlab-vol5-worker2         <none>           <none>
39
0
node/cnlab-vol5-worker uncordoned
```

The drain evicted one `wallet-api` Pod and one `wallet-worker` Pod. Both were recreated on the other worker, with an AGE of 15 s, and the probe logged 39 `ok` lines and 0 `FAIL` lines while this happened. The 0 means something because Pods really were evicted: the budget let the one API Pod on the drained node leave while the other kept answering. Your `ok` count depends on how long you waited, but the `FAIL` count should be 0. Two other runs agree: the first drain on 2026-11-16 logged 33 `ok` and 0 `FAIL`, and a drain on 2026-11-18 on another fresh cluster, which also evicted one API and one worker Pod, logged 34 `ok` and 0 `FAIL`. A third, on a cluster where we had moved CoreDNS Pods onto the drained worker, evicted them too and logged 50 `ok` and 2 `FAIL`, so a drain that also takes the cluster DNS can cost a few requests. We did not investigate those two.

1. Which two Pods did the drain evict, and which Pods did it leave alone? Why those?
2. Predict, then reason: with `replicas: 1` for `wallet-api` and the same budget, what would the drain print, and for how long?
3. After `uncordon`, nothing moves back to the drained node by itself. Which component decides where the next new Pod goes, and what does it look at?

## Part D · Two VMs: build a cluster by hand and swap a runtime (90 min, targeted)

**These steps were not run on the test machine.** We have no VMs there. Every command below is copied from the official pages that we opened on 2026-11-17, and the expected results are what those pages promise. If a page and this lab disagree, the page wins, and you should tell your lecturer. Pages: [Installing kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/), [Creating a cluster with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/), [Container Runtimes](https://kubernetes.io/docs/setup/production-environment/container-runtimes/), [CRI-O packaging](https://github.com/cri-o/packaging), and [Changing the container runtime on a node](https://kubernetes.io/docs/tasks/administer-cluster/migrating-from-dockershim/change-runtime-containerd/).

You need two Ubuntu 24.04 VMs. Call them `cp1` (control plane) and `w1` (worker). The install page asks for 2 GB RAM or more per machine, 2 CPUs or more on the control plane, full network access between the machines, and a unique hostname, MAC address and `product_uuid` on each.

**D1 · Prepare both VMs.** Check that the identifiers differ, then switch swap off. By default the kubelet will not start on a node with swap.

```bash
sudo cat /sys/class/dmi/id/product_uuid
ip link
sudo swapoff -a
```

The install page says that `swapoff -a` lasts only until the next reboot. Open `/etc/fstab` and remove or comment out any swap line so that it stays off. Then enable IPv4 forwarding, as the Container Runtimes page shows, and load the module that the Flannel Pod network needs ([Flannel README](https://github.com/flannel-io/flannel)):

```bash
cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.ipv4.ip_forward = 1
EOF
sudo sysctl --system
sysctl net.ipv4.ip_forward
sudo modprobe br_netfilter
```

Expected from the page: `net.ipv4.ip_forward = 1`.

**D2 · Install a runtime, kubeadm, kubelet and kubectl on both VMs.** First install containerd by following [getting started with containerd](https://github.com/containerd/containerd/blob/main/docs/getting-started.md), as the Container Runtimes page says. Create its configuration and turn on the systemd cgroup driver:

```bash
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml
```

In that file, set `SystemdCgroup = true` in the `runc.options` section of the `io.containerd.cri.v1.runtime` plug-in (the containerd 2.x spelling on the page). Then restart it:

```bash
sudo systemctl restart containerd
```

Now add the Kubernetes package repository for v1.37 and install the three tools, exactly as the install page shows. The `hold` line stops a routine `apt upgrade` from moving the cluster to a new version by accident.

```bash
sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl gpg
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.37/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.37/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
sudo apt-get update
sudo apt-get install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl
sudo systemctl enable --now kubelet
kubeadm version
```

Expected: `kubeadm version` prints a `v1.37.x` version.

**D3 · Initialise the control plane on `cp1`.** The Flannel manifest expects the Pod network `10.244.0.0/16`, so pass it to kubeadm (the create-cluster page says the value depends on the add-on you choose).

```bash
sudo kubeadm init --pod-network-cidr=10.244.0.0/16
```

Expected from the page: the preflight checks run, the phases you saw in part A scroll by, and the output ends with `Your Kubernetes control-plane has initialized successfully!` and a `kubeadm join` line. Copy that line. It holds the bootstrap token, which lives 24 hours. Then give your user access and install the Pod network:

```bash
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config
kubectl apply -f https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml
kubectl get nodes
kubectl get pods --all-namespaces
```

Expected from the page: until a Pod network is installed, the CoreDNS Pods stay `Pending`. This is by design, because kubeadm does not choose a network for you. After the Flannel manifest is applied, CoreDNS should reach `Running`.

**D4 · Join `w1`.** On `w1`, run the join line from `kubeadm init` with `sudo`. It has this shape:

```bash
sudo kubeadm join <control-plane-host>:6443 --token <token> --discovery-token-ca-cert-hash sha256:<hash>
```

If the token has expired, make a new line on `cp1` with `kubeadm token create --print-join-command`. Then, on `cp1`:

```bash
kubectl get nodes -o wide
```

Expected: two nodes, `cp1` with the role `control-plane` and `w1`, both `Ready` once the Pod network runs on `w1`. The `CONTAINER-RUNTIME` column reads `containerd://` and a version.

**D5 · Swap `w1` from containerd to CRI-O.** The page for changing a runtime shows the order of steps (it uses Docker Engine and containerd as its example, so the CRI-O details below come from the CRI-O packaging page). Drain first. The Container Runtimes page warns that changing the runtime on a node that already runs Pods "can cause errors when trying to re-create the Pod sandbox".

```bash
kubectl drain w1 --ignore-daemonsets
```

On `w1`, stop the kubelet and the old runtime, then add the CRI-O v1.37 repository and install it (commands from the CRI-O packaging page; the Kubernetes repository is already set up):

```bash
sudo systemctl stop kubelet
sudo systemctl disable containerd --now
KUBERNETES_VERSION=v1.37
CRIO_VERSION=v1.37
curl -fsSL https://download.opensuse.org/repositories/isv:/cri-o:/stable:/$CRIO_VERSION/deb/Release.key | sudo gpg --batch --yes --dearmor -o /etc/apt/keyrings/cri-o-apt-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/cri-o-apt-keyring.gpg] https://download.opensuse.org/repositories/isv:/cri-o:/stable:/$CRIO_VERSION/deb/ /" | sudo tee /etc/apt/sources.list.d/cri-o.list
sudo apt-get update
sudo apt-get install -y cri-o
sudo systemctl start crio.service
```

CRI-O uses the `systemd` cgroup driver by default, which matches the kubelet. Its socket is `/var/run/crio/crio.sock`. Now find where the kubelet's configuration names the runtime socket, and change it:

```bash
sudo grep -r containerRuntimeEndpoint /var/lib/kubelet/
```

The changing-runtime page says to set `containerRuntimeEndpoint` to the new socket in `/var/lib/kubelet/instance-config.yaml`, or `--container-runtime-endpoint` in `/var/lib/kubelet/kubeadm-flags.env`. Use `unix:///var/run/crio/crio.sock` as the value, in whichever file your `grep` found. Then start the kubelet and let the node take Pods again:

```bash
sudo systemctl start kubelet
kubectl get nodes -o wide
kubectl uncordon w1
```

Expected: `w1` is `Ready`, and its `CONTAINER-RUNTIME` column now reads `cri-o://` and a `1.37` version. The changing-runtime page shows the same check for its own example. Nothing else changed: the kubelet cannot tell the two runtimes apart, which is the point of the CRI. On `w1`, `sudo crictl --runtime-endpoint unix:///var/run/crio/crio.sock ps` talks to CRI-O directly.

If you want to start over, the create-cluster page says to drain and delete each node, then run `sudo kubeadm reset` on it.

## Checkpoint

You are done when all of these hold. Commit your notes and `05-pdb.yaml`, but not `snapshot.db`.

| Check | Expected |
| --- | --- |
| `docker exec cnlab-vol5-control-plane ls /etc/kubernetes/manifests` | `etcd.yaml`, `kube-apiserver.yaml`, `kube-controller-manager.yaml`, `kube-scheduler.yaml` |
| `docker exec cnlab-vol5-control-plane kubeadm certs check-expiration` | eleven rows; `RESIDUAL TIME` is about a year (`364d` on a new cluster); `EXTERNALLY MANAGED` is `no` |
| `docker exec cnlab-vol5-worker grep containerRuntimeEndpoint /var/lib/kubelet/config.yaml` | `unix:///run/containerd/containerd.sock` |
| `grep -oE '^\[[a-z-]+\]' dryrun.txt \| grep -v dryrun \| uniq` | `sixteen lines from [init] to [addons] ([kubelet-start] appears twice)`, with `[mark-control-plane]` and `[bootstrap-token]` among them |
| `kubectl -n kube-system exec etcd-cnlab-vol5-control-plane -- etcdutl snapshot status /var/lib/etcd/snapshot.db -w table` | one row with a hash, a revision, a key count above 0 and a size of several MB |
| `kubectl get configmap hello`, then kubectl get configmap, once the API server is back after B4 | hello is found, and the list shows hello and kube-root-ca.crt and no after-snapshot (the same on every repeat) |
| `kubectl get configmap after-snapshot` after B4 | `Error from server (NotFound)`: configmaps "after-snapshot" not found |
| `kubectl -n wallet logs probe \| grep -c FAIL` after the C3 drain of a worker that holds a wallet-api Pod but not postgres-0 | `0` |
| Break it: `kubectl drain` of the node with `postgres-0` | the `Cannot evict pod as it would violate the pod's disruption budget` retries, then a timeout; after `uncordon`, `postgres-0` is `Running` again |
| Part D (targeted, from the documentation) | `kubectl get nodes -o wide` lists `cp1` and `w1` as `Ready`; after the swap, `w1` shows `cri-o://1.37.x` in `CONTAINER-RUNTIME` |
| Notebook | answers to the questions in parts A to C, your snapshot's hash and revision, and your Break it notes |

Parts A to C were run on the test machine; the Part D row is what the documentation promises, not something we saw.

## Break it: drain the node that holds the database

A budget protects the API, but the database lives on one node. You will drain that node and read the failure.

Open two terminals. In terminal 2, watch the Pods:

```bash
kubectl -n wallet get pods -o wide -w
```

In terminal 1, restart the probe, find the node of `postgres-0`, and drain it (here `cnlab-vol5-worker`):

```bash
kubectl -n wallet delete pod probe --now
kubectl apply -f probe.yaml
kubectl -n wallet wait --for=condition=Ready pod/probe --timeout=60s
kubectl -n wallet get pod postgres-0 -o wide
kubectl drain cnlab-vol5-worker --ignore-daemonsets --delete-emptydir-data --timeout=120s
```

The drain does not finish. Real output from the test machine, trimmed:

```text
error when evicting pods/"wallet-api-ffd6cb76b-wndxt" -n "wallet" (will retry after 5s): Cannot evict pod as it would violate the pod's disruption budget.
evicting pod wallet/wallet-api-ffd6cb76b-wndxt
...
error: unable to drain node "cnlab-vol5-worker" due to error: error when evicting pods/"wallet-api-ffd6cb76b-wndxt" -n "wallet": global timeout reached: 2m0s, continuing command...
```

While it retries, diagnose from terminal 2 and a third command:

```bash
kubectl -n wallet get events --field-selector reason=FailedScheduling
kubectl -n wallet logs probe | grep -c FAIL
```

On the test machine, `postgres-0` was `Pending` and both `wallet-api` Pods showed `0/1`. The Event said `0/3 nodes are available: 1 node(s) didn't match PersistentVolume's node affinity, 1 node(s) had untolerated taint(s), 1 node(s) were unschedulable.` After the 2-minute drain, 104 of the 119 probe requests had failed (the chapter's measurement; the first failure came 1 second in, the last 157 seconds in).

Now repair it without touching the budget:

```bash
kubectl uncordon cnlab-vol5-worker
kubectl -n wallet wait --for=condition=Ready pod/postgres-0 --timeout=120s
kubectl -n wallet get pods -o wide
```

On the test machine `postgres-0` was `Ready` 8 seconds after the uncordon, on the same node with the same data, and the API Pods followed.

1. Name the two facts that make `postgres-0` impossible to move. Where in the cluster is each one stored? (Ch 5.4 has the answer.)
2. The drain retried on `wallet-api`, not on `postgres-0`. Why did the budget block the API Pod? Hint: look at the `READY` column of the API Pods.
3. The drain page recommends `unhealthyPodEvictionPolicy: AlwaysAllow` on budgets. Would it have let this drain finish? Would the wallet have survived it? Argue both.
4. Write two sentences for your Milestone 5 design note: what you would change so that draining the database node is safe. We did not test any such change here.
5. Part B had you restore etcd. If this node's disk had died instead of being drained, which of your wallet's data could a snapshot bring back, and which not?
