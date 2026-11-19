# Lab 4.2 · runc, nerdctl and crictl

## Goal

You will start the wallet's image with three different programs and no Docker: runc from a bundle you write, containerd with `ctr` and `nerdctl`, and containerd's CRI with `crictl` playing the kubelet. Then you will swap runc for gVisor and measure what that costs.

**Versions tested** (2026-11-17, Docker Desktop on WSL2, Ubuntu 26.04): Docker Engine 29.9.2; `kindest/node:v1.37.0` (Debian 13), which carries runc 1.4.3, containerd v2.3.4 and crictl v1.36.0; nerdctl v2.4.2, built from the v2.4.2 source with `CGO_ENABLED=0 go build ./cmd/nerdctl` because GitHub release downloads were blocked on the test network; gVisor `runsc` release-20261109.0 (checksum verified); `postgres:17`; `wallet:alpine` from Lab 4.1. **Not run:** Kata Containers; a native containerd install with `apt` on Ubuntu 24.04; rootless mode; the nerdctl release tarball in the download command below (the same binary was built from source instead); a kubelet-driven cluster (that is Vol 5).

**Before you start:** `wallet:alpine` from Lab 4.1, Docker running, about 3 GB of free disk and 2 GB of free RAM. Nothing publishes a port on your machine: the wallet listens on port 8080 inside the lab node only.

### What you will build

{{diagram lab-4-2-01.jsx | what you will build in Lab 4.2 · one panel per part}}
## Part A · Build the lab machine

You will start a disposable node and a database, then check the three tools you will use.

**Step 1: start the node and the database.** The node is a container that runs systemd, containerd and runc, the same image kind uses for its nodes (Lab 0.1).

```bash
docker run -d --name lab42-node --hostname lab42-node --privileged \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  --tmpfs /tmp --tmpfs /run --volume /var --volume /lib/modules:/lib/modules:ro \
  kindest/node:v1.37.0
docker run -d --name lab42-db -e POSTGRES_USER=wallet -e POSTGRES_PASSWORD=wallet \
  -e POSTGRES_DB=wallet postgres:17
sleep 10
DB=$(docker inspect -f '{{.NetworkSettings.Networks.bridge.IPAddress}}' lab42-db); echo DB=$DB
docker exec lab42-node sh -c 'runc --version | head -1; containerd --version; crictl --version; systemctl is-active containerd'
```

```text
DB=172.17.0.2
runc version 1.4.3
containerd github.com/containerd/containerd/v2 v2.3.4 db8809540e1a7a9da5d518876894933ff55692ab
crictl version 1.36.0
active
```

The flags turn a container into something that behaves like a machine. `--privileged` gives it every capability and device, `seccomp=unconfined` and `apparmor=unconfined` remove the default filters so that runc can start containers inside it, the two `--tmpfs` mounts are what systemd expects, and the `--volume /var` gives containerd a real volume for its layers, since a layered filesystem generally cannot sit on another layered filesystem. This container is as powerful as root on a Docker host: use it only for this lab and remove it at the end. Your `DB` address may differ from `172.17.0.2`; use yours below.

**Step 2: bring the wallet image and nerdctl into the node.**

```bash
mkdir -p ~/cn-lab && cd ~/cn-lab
docker save wallet:alpine -o wallet-alpine.tar
docker cp wallet-alpine.tar lab42-node:/root/wallet-alpine.tar
curl -fsSL -o nerdctl.tgz https://github.com/containerd/nerdctl/releases/download/v2.4.2/nerdctl-2.4.2-linux-amd64.tar.gz
tar -xzf nerdctl.tgz nerdctl && docker cp nerdctl lab42-node:/usr/local/bin/nerdctl
docker exec lab42-node nerdctl --version
```

```text
nerdctl version 2.4.2
```

The `curl` line was not run on the test network (see Versions tested). If your network blocks it, build the same version from source with Go: `git clone --depth 1 --branch v2.4.2 https://github.com/containerd/nerdctl && cd nerdctl && CGO_ENABLED=0 go build ./cmd/nerdctl`.

The node has no Docker inside it, and that is the point. Whatever starts a container below is containerd, runc or gVisor, never `dockerd`.

## Part B · runc by hand

You will write the bundle for the wallet yourself and start it with runc, with no daemon involved.

**Step 1: make the root filesystem.** On your machine, export the image's merged filesystem into a bundle directory inside the node, then open a shell in the node. This is the layers of Ch 4.1 flattened into one directory.

```bash
docker create --name lab42-tmp wallet:alpine
docker exec lab42-node mkdir -p /root/bundle/rootfs
docker export lab42-tmp | docker exec -i lab42-node tar -x -C /root/bundle/rootfs
docker rm lab42-tmp
docker exec -it lab42-node bash
```

Every command in Parts B to E runs in that shell, inside the node, unless a step says "on your machine".

**Step 2: let runc write a template `config.json`.**

```bash
export DB=172.17.0.2        # your own address from Part A
cd /root/bundle
du -sh rootfs; ls rootfs
runc spec; ls
jq -c '{args: .process.args, cwd: .process.cwd, user: .process.user, ns: [.linux.namespaces[].type], readonly: .root.readonly}' config.json
```

```text
73M	rootfs
app  bin  dev  etc  home  lib  media  mnt  opt  proc  root  run  sbin  srv  sys  tmp  usr  var
config.json  rootfs
{"args":["sh"],"cwd":"/","user":{"uid":0,"gid":0},"ns":["pid","network","ipc","uts","mount","cgroup"],"readonly":true}
```

The template runs `sh` as root in six new namespaces with a read-only root. The rootfs is 73 MB, the unpacked size you measured in Lab 4.1.

**Step 3: turn the template into the wallet.** Edit the file with `jq`, one field per line of the filter:

```bash
jq '.process.args = ["python3", "api.py"]
  | .process.terminal = false
  | .process.cwd = "/app"
  | .process.user = {"uid": 10001, "gid": 10001}
  | .process.env += ["DATABASE_URL=postgresql://wallet:wallet@" + env.DB + ":5432/wallet"]
  | .linux.namespaces |= map(select(.type != "network"))
  | .linux.resources.memory.limit = 134217728' config.json > config.new && mv config.new config.json
jq -c '{args: .process.args, cwd: .process.cwd, user: .process.user, ns: [.linux.namespaces[].type], memory: .linux.resources.memory}' config.json
```

```text
{"args":["python3","api.py"],"cwd":"/app","user":{"uid":10001,"gid":10001},"ns":["pid","ipc","uts","mount","cgroup"],"memory":{"limit":134217728}}
```

The changes are the program and its directory, the non-root user from the image, the database address, a 128 MiB memory limit, and the removal of the network namespace. Without its own network namespace the container shares the node's network, so it can reach the database over Docker's bridge without any network setup. Ch 4.3 shows the proper way.

**Step 4: start it.**

```bash
runc run -d wallet-api < /dev/null > /root/api.log 2>&1
sleep 6
runc list
curl -s localhost:8080/healthz; curl -s localhost:8080/readyz
```

```text
ID           PID         STATUS      BUNDLE         CREATED                          OWNER
wallet-api   255         running     /root/bundle   2026-11-17T03:17:58.821144541Z   root
{"status": "ok"}
{"status": "ready"}
```

The wallet runs, and `/readyz` proves it reached Postgres. No daemon, no image store and no shim took part: runc made the process and left. Your PID will differ.

**Step 5: look at what runc built.** These are the Linux features of Ch 1.5.

```bash
P=$(runc state wallet-api | jq .pid); echo "pid=$P"
for n in pid mnt net; do printf "%s  container=%s  node=%s\n" $n "$(readlink /proc/$P/ns/$n)" "$(readlink /proc/1/ns/$n)"; done
grep NSpid /proc/$P/status
cat /proc/$P/cgroup; cat /sys/fs/cgroup/wallet-api/memory.max
runc exec wallet-api id
runc exec wallet-api touch /x
```

```text
pid=255
pid  container=pid:[4026533651]  node=pid:[4026533950]
mnt  container=mnt:[4026533240]  node=mnt:[4026533947]
net  container=net:[4026533952]  node=net:[4026533952]
NSpid:	255	1
0::/wallet-api
134217728
uid=10001(wallet) gid=10001(wallet)
touch: /x: Read-only file system
```

The pid and mount namespaces differ from the node's, the network namespace is the same (you removed it), the process is PID 255 outside and PID 1 inside, its cgroup is `/wallet-api` with `memory.max` set to 128 MiB, and the read-only root refuses a write.

**Step 6: the lifecycle.** Stop the wallet, then run another container in two steps to see the `created` state.

```bash
runc kill wallet-api TERM; sleep 2; runc list; tail -1 /root/api.log; runc delete wallet-api; runc list
runc create demo < /dev/null; runc list; ps -eo pid,args | grep 'runc init' | grep -v grep
runc start demo; sleep 2; runc list; runc delete -f demo
```

```text
ID           PID         STATUS      BUNDLE         CREATED                          OWNER
wallet-api   0           stopped     /root/bundle   2026-11-17T03:17:58.821144541Z   root
wallet-api: got SIGTERM, shutting down
ID          PID         STATUS      BUNDLE      CREATED     OWNER
ID           PID         STATUS      BUNDLE         CREATED                          OWNER
demo         372         created     /root/bundle   2026-11-17T03:18:07.054780123Z   root
    372 runc init
ID           PID         STATUS      BUNDLE         CREATED                          OWNER
demo         372         running     /root/bundle   2026-11-17T03:18:07.054780123Z   root
```

Answer in your notes: (1) Which line of `config.json` stopped the `touch /x`, and which kernel feature enforces it? (2) The wallet printed `got SIGTERM`: who sent the signal, and why did the container still show as `stopped` until `runc delete`? (3) Between `runc create` and `runc start`, what was running, and which process was the wallet?

## Part C · containerd, `ctr`, `nerdctl` and the shim

You will start the same image through containerd, find the shim above it, and restart the daemon under a running container.

**Step 1: load the image into containerd and look at how it stores it.** The tarball is the `docker save` archive from Part A; containerd reads the OCI layout you opened in Lab 4.1.

```bash
ctr images import /root/wallet-alpine.tar
ctr images ls | cut -c1-120
ctr namespaces ls
ctr snapshots ls | awk '{print substr($1,1,19), substr($2,1,19), $3}'
```

```text
application/vnd.oci.image.index.v1+json sha256:447e75eaea0fe9b6c7fa0481ee804450700b0f88eac5edc4917ff6a459ca68b4
Importing	elapsed: 4.2 s	total:   0.0 B	(0.0 B/s)
REF                             TYPE                                    DIGEST
docker.io/library/wallet:alpine application/vnd.oci.image.index.v1+json sha256:447e75eaea0fe9b6c7fa0481ee804450700b0f88e
NAME    LABELS
default
k8s.io
KEY PARENT KIND
sha256:043441cd41bd sha256:adbd01eaec3a Committed
sha256:1548f81cc15f sha256:75f1d9657d88 Committed
sha256:75f1d9657d88 Committed
sha256:83456c905f38 sha256:1548f81cc15f Committed
sha256:89dfbb5e5304 sha256:98b0d7fb463e Committed
sha256:94bff2e95931 sha256:83456c905f38 Committed
sha256:98b0d7fb463e sha256:043441cd41bd Committed
sha256:adbd01eaec3a sha256:94bff2e95931 Committed
```

There are 8 committed snapshots, one per layer of `wallet:alpine`, each with the previous one as its parent: the layer stack of Ch 4.1 as a chain. The index digest differs from the one in Lab 4.1 because your build is a different build. Two containerd namespaces exist, `default` and `k8s.io`; you imported into `default`.

**Step 2: run it with `ctr`.**

```bash
ctr run -d --net-host --env DATABASE_URL=postgresql://wallet:wallet@$DB:5432/wallet \
  docker.io/library/wallet:alpine wallet-ctr python3 api.py
sleep 7
ctr containers ls; ctr tasks ls
curl -s localhost:8080/healthz
```

```text
CONTAINER     IMAGE                              RUNTIME
wallet-ctr    docker.io/library/wallet:alpine    io.containerd.runc.v2
TASK          PID    STATUS
wallet-ctr    520    RUNNING
{"status": "ok"}
```

containerd separates a **container** (the metadata and the snapshot) from a **task** (the running process). `--net-host` again means "no network namespace", as in Part B.

**Step 3: find the shim, and the runc that containerd used.**

```bash
ps -eo pid,ppid,args | grep -E 'containerd-shim|python3 api.py' | grep -v grep | cut -c1-110
runc --root /run/containerd/runc/default list
ls /run/containerd/io.containerd.runtime.v2.task/default/wallet-ctr
jq -c '{args: .process.args, user: .process.user, ns: [.linux.namespaces[].type]}' /run/containerd/io.containerd.runtime.v2.task/default/wallet-ctr/config.json
ctr snapshots ls | grep -c Active
```

```text
    497       1 /usr/local/bin/containerd-shim-runc-v2 -namespace default -id wallet-ctr -address /run/contain
    520     497 python3 api.py
ID           PID         STATUS      BUNDLE                                                             CREATED                          OWNER
wallet-ctr   520         running     /run/containerd/io.containerd.runtime.v2.task/default/wallet-ctr   2026-11-17T03:18:21.126801698Z   root
bootstrap.json
config.json
init.pid
log
log.json
options.json
rootfs
runtime
s
shim-binary-path
work
{"args":["python3","api.py"],"user":{"uid":10001,"gid":10001,"additionalGids":[10001]},"ns":["pid","ipc","uts","mount"]}
1
```

Three things match the chapter. The wallet's parent is the shim (PID 497), whose own parent is PID 1. `runc list` with containerd's state directory shows the same container, and its bundle sits under `/run/containerd/`: containerd wrote a bundle with a `config.json` like the one you wrote in Part B. One snapshot is `Active`: the container's writable layer.

**Step 4: restart the daemon under the running container.**

```bash
ps -eo pid,args | grep 'python3 api.py' | grep -v grep
systemctl restart containerd; sleep 4
ps -eo pid,args | grep 'python3 api.py' | grep -v grep; ctr tasks ls; curl -s localhost:8080/healthz
```

```text
    520 python3 api.py
    520 python3 api.py
TASK          PID    STATUS
wallet-ctr    520    RUNNING
{"status": "ok"}
```

The same PID 520 before and after: the daemon restarted and the wallet never noticed. Clean up the container (`ctr tasks kill wallet-ctr; sleep 2; ctr tasks rm wallet-ctr; ctr containers rm wallet-ctr`) and move on.

**Step 5: do the same with `nerdctl`.** It reads the image you already imported and gives you Docker-style commands.

```bash
nerdctl load -i /root/wallet-alpine.tar | tail -1
nerdctl images
nerdctl run -d --name wallet-nerd --net host --memory 128m \
  -e DATABASE_URL=postgresql://wallet:wallet@$DB:5432/wallet wallet:alpine | cut -c1-12
sleep 7
nerdctl ps
nerdctl exec wallet-nerd id
nerdctl logs wallet-nerd 2>&1 | tail -2
ps -eo pid,ppid,args | grep -E 'containerd-shim|python3 api.py' | grep -v grep | cut -c1-90
nerdctl rm -f wallet-nerd
```

```text
Loaded image: docker.io/library/wallet:alpine
IMAGE            ID              DISK USAGE    CONTENT SIZE    EXTRA
wallet:alpine    447e75eaea0f    102MB         25.4MB
<untagged>       2495e327f603    0B            0B
1de6d2d9b3ff
CONTAINER ID    IMAGE                              COMMAND             CREATED          STATUS    PORTS    NAMES
1de6d2d9b3ff    docker.io/library/wallet:alpine    "python3 api.py"    7 seconds ago    Up                 wallet-nerd
uid=10001(wallet) gid=10001(wallet) groups=10001(wallet)
wallet-api pid=1 port=8080
127.0.0.1 - - [17/Nov/2026 03:18:44] "GET /healthz HTTP/1.1" 200 -
    731       1 /usr/local/bin/containerd-shim-runc-v2 -namespace default -id 1de6d2d9b3ff
    770     731 python3 api.py
wallet-nerd
```

The output looks like Docker's, yet no Docker is involved: the process tree is the same shim-and-runc pair. The `<untagged>` row is the build attestation manifest that BuildKit attached to the image in Lab 4.1; it is not a second image.

Answer in your notes: (1) Why did the wallet survive `systemctl restart containerd`, and which process in `ps` is the reason? (2) `ctr` and `nerdctl` both showed `wallet:alpine` without a second import: which containerd namespace do they share, and which one would the kubelet use? (3) How does `--memory 128m` in `nerdctl` end up in the same field you edited by hand in Part B?

## Part D · `crictl`: you play the kubelet

You will send the CRI calls of the sequence diagram by hand: a Pod sandbox first, then a container inside it.

**Step 1: give the CRI its own copy of the image.** The CRI works in the containerd namespace `k8s.io`, so the image from Part C is invisible to it until you load it there.

```bash
nerdctl --namespace k8s.io load -i /root/wallet-alpine.tar | tail -1
crictl images | grep -E 'IMAGE|wallet|pause'
```

```text
Loaded image: docker.io/library/wallet:alpine
IMAGE                                           TAG                  IMAGE ID            SIZE
docker.io/library/wallet                        alpine               36d2f4defd897       25.4MB
registry.k8s.io/pause                           3.10                 873ed75102791       320kB
```

The `pause` image is the Pod sandbox. The node image ships it, so no pull is needed.

**Step 2: describe the Pod sandbox, and read the error.** A CRI Pod config is JSON. This one asks for the node's own network (`"network": 2` is the CRI mode `NODE`) because this machine has no network plugin; Vol 6 explains why Pods normally get their own.

```bash
mkdir -p /root/cri /tmp/wallet-pod-logs && cd /root/cri
cat > pod.json <<JSON
{
  "metadata": {"name": "wallet-pod", "namespace": "lab", "uid": "wallet-uid-1", "attempt": 1},
  "log_directory": "/tmp/wallet-pod-logs",
  "linux": {"security_context": {"namespace_options": {"network": 2}}}
}
JSON
crictl runp pod.json
```

```text
time="2026-11-17T03:18:58Z" level=fatal msg="run pod sandbox: rpc error: code = Unknown desc = failed to start sandbox \"90db44a2...\": failed to create containerd task: failed to create shim task: OCI runtime create failed: runc create failed: expected cgroupsPath to be of format \"slice:prefix:name\" for systemd cgroups, got \"/k8s.io/90db44a2...\" instead"
```

Read it from the left: the CRI call (`run pod sandbox`), then containerd (`failed to create containerd task`), then the shim, then runc, which names the real reason. This is the cgroup driver rule from part 4: containerd is set to use systemd's cgroup driver, which wants a slice name, and your config gave no parent. The kubelet always supplies one; you add `cgroup_parent`:

```bash
cat > pod.json <<JSON
{
  "metadata": {"name": "wallet-pod", "namespace": "lab", "uid": "wallet-uid-1", "attempt": 1},
  "log_directory": "/tmp/wallet-pod-logs",
  "linux": {
    "cgroup_parent": "lab.slice",
    "security_context": {"namespace_options": {"network": 2}}
  }
}
JSON
```

**Step 3: describe the container, then run the three calls.**

```bash
cat > api.json <<JSON
{
  "metadata": {"name": "api"},
  "image": {"image": "docker.io/library/wallet:alpine"},
  "command": ["python3", "api.py"],
  "envs": [{"key": "DATABASE_URL", "value": "postgresql://wallet:wallet@$DB:5432/wallet"}],
  "log_path": "api.log",
  "linux": {"resources": {"memory_limit_in_bytes": 134217728}}
}
JSON
POD=$(crictl runp pod.json); echo "POD=${POD:0:13}"
crictl pods
CTR=$(crictl create $POD api.json pod.json); echo "CTR=${CTR:0:13}"
crictl ps -a
crictl start $CTR; sleep 7
crictl ps
curl -s localhost:8080/healthz
```

```text
POD=2a7228fa0ca13
POD ID              CREATED                  STATE               NAME                NAMESPACE           ATTEMPT             RUNTIME
2a7228fa0ca13       Less than a second ago   Ready               wallet-pod          lab                 1                   (default)
CTR=feb2bf0f4aab8
CONTAINER           IMAGE                             CREATED                  STATE               NAME                ATTEMPT             POD ID              POD                 NAMESPACE
feb2bf0f4aab8       docker.io/library/wallet:alpine   Less than a second ago   Created             api                 0                   2a7228fa0ca13       unknown             unknown
feb2bf0f4aab8bd9169dfb22a0e6f361e4cf099e081799903b11eee9dcef68cb
CONTAINER           IMAGE                             CREATED             STATE               NAME                ATTEMPT             POD ID              POD                 NAMESPACE
feb2bf0f4aab8       docker.io/library/wallet:alpine   7 seconds ago       Running             api                 0                   2a7228fa0ca13       unknown             unknown
{"status": "ok"}
```

The container passes through `Created` and `Running`, the same states as in runc. The `unknown` in the POD columns appears because only a kubelet fills in the Kubernetes metadata.

**Step 4: inspect what the CRI built.**

```bash
C=$(crictl ps -q)
crictl exec $C id
crictl logs --tail=1 $C
crictl inspect $C | jq -c '{state: .status.state, pid: .info.pid, cgroupsPath: .info.runtimeSpec.linux.cgroupsPath, memory: .info.runtimeSpec.linux.resources.memory.limit}'
ps -eo pid,ppid,args | grep -E 'containerd-shim|/pause|python3 api.py' | grep -v grep | cut -c1-100
systemd-cgls --no-pager 2>/dev/null | grep -A5 lab.slice
crictl info | jq -c '.config.containerd.runtimes | keys'
```

```text
uid=10001(wallet) gid=10001(wallet) groups=10001(wallet)
127.0.0.1 - - [17/Nov/2026 03:19:12] "GET /healthz HTTP/1.1" 200 -
{"state":"CONTAINER_RUNNING","pid":1292,"cgroupsPath":"lab.slice:cri-containerd:feb2bf0f4aab8bd9169dfb22a0e6f361e4cf099e081799903b11eee9dcef68cb","memory":134217728}
   1202       1 /usr/local/bin/containerd-shim-runc-v2 -namespace k8s.io -id 2a7228fa0ca1339aa2cb412
   1225    1202 /pause
   1292    1202 python3 api.py
├─lab.slice
│ ├─cri-containerd-feb2bf0f4aab8bd9169dfb22a0e6f361e4cf099e081799903b11eee9dcef68cb.scope …
│ │ └─1292 python3 api.py
│ └─cri-containerd-2a7228fa0ca1339aa2cb412dd04fbfc0cff5547de35ba9f726c5674495fc0ac6.scope …
│   └─1225 /pause
["runc","test-handler"]
```

This is the process tree from the part 1 diagram: one shim for the Pod, with `/pause` and your container below it. The container's cgroup is a systemd scope under the slice you named, and the 128 MiB limit from `api.json` arrived in the runtime spec. The node's containerd already has two runtime handlers, `runc` and the `test-handler` that Kubernetes' own tests use.

**Step 5: remove the Pod.**

```bash
crictl stopp $POD; crictl rmp $POD; crictl pods
```

```text
Stopped sandbox 2a7228fa0ca1339aa2cb412dd04fbfc0cff5547de35ba9f726c5674495fc0ac6
Removed sandbox 2a7228fa0ca1339aa2cb412dd04fbfc0cff5547de35ba9f726c5674495fc0ac6
POD ID              CREATED             STATE               NAME                NAMESPACE           ATTEMPT             RUNTIME
```

In a real cluster you would now run `docker exec <node> crictl ps` on a kind node and see the control plane's containers listed the same way. Try that in Vol 5.

Answer in your notes: (1) Which line of the error message names the layer that actually refused? (2) What would the kubelet have to send that you left out in Step 2, and what happens on a real node if the kubelet's cgroup driver and containerd's differ? (3) Why does `crictl ps` show `unknown` under POD and NAMESPACE?

## Part E · gVisor: the same image on a user-space kernel

You will add gVisor as a second runtime in containerd, start the same image under both runtimes, and time them.

**Step 1: download gVisor, on your machine.** The release has a checksum; verify it before you copy anything into the node.

```bash
mkdir -p ~/cn-lab/gvisor && cd ~/cn-lab/gvisor
B=https://storage.googleapis.com/gvisor/releases/release/20261109.0/x86_64
curl -fsSLO $B/gvisor.tar.bz2 && curl -fsSLO $B/gvisor.tar.bz2.sha512
sha512sum -c gvisor.tar.bz2.sha512
mkdir x && tar -xjf gvisor.tar.bz2 -C x && ls x
docker exec lab42-node mkdir -p /usr/local/gvisor
docker cp x/. lab42-node:/usr/local/gvisor/
```

```text
gvisor.tar.bz2: OK
containerd-shim-runsc-v1  gvisor-bin  runsc
```

**Step 2: register `runsc` with containerd, in the node.** One stanza names a new runtime handler and says which shim runs it. Then restart containerd and ask the CRI which handlers it knows.

```bash
cd /usr/local/gvisor && ln -sf $PWD/runsc /usr/local/bin/runsc && ln -sf $PWD/containerd-shim-runsc-v1 /usr/local/bin/containerd-shim-runsc-v1
runsc --version | head -1
cp /etc/containerd/config.toml /root/config.toml.orig
cat >> /etc/containerd/config.toml <<TOML

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"
TOML
systemctl restart containerd; sleep 3
crictl info | jq -c '.config.containerd.runtimes | keys'
```

```text
runsc version release-20261109.0
["runc","runsc","test-handler"]
```

The runtime type `io.containerd.runsc.v1` tells containerd to start the program `containerd-shim-runsc-v1`. This handler name, `runsc`, is what a Kubernetes RuntimeClass would put in its `handler` field.

**Step 3: start the same image under both runtimes and compare.** The function builds a Pod and a container from your Part D files; the container just sleeps, because this lab needs a process to run commands in, not the database.

```bash
cd /root/cri
mk() {  # usage: mk <name> [runtime]
  sed "s/wallet-pod/$1/; s/wallet-uid-1/uid-$1/" pod.json > pod-$1.json
  jq --arg n "c-$1" '.metadata.name=$n | .command=["sleep","3600"] | .envs=[]' api.json > ctr-$1.json
  P=$(crictl runp ${2:+--runtime $2} pod-$1.json); C=$(crictl create $P ctr-$1.json pod-$1.json); crictl start $C > /dev/null; echo $C > /root/$1.id
}
mk sand-runc; mk sand-runsc runsc
crictl pods
for r in runc runsc; do echo "== $r"; crictl exec $(cat /root/sand-$r.id) uname -r; crictl exec $(cat /root/sand-$r.id) dmesg | head -3; done
echo "== host view of the gVisor container"; ps -eo pid,ppid,args | grep -E 'runsc|gvisor' | grep -v grep | cut -c1-60 | head -6
```

```text
POD ID              CREATED             STATE               NAME                NAMESPACE           ATTEMPT             RUNTIME
aa3ffb6d21fb9       1 second ago        Ready               sand-runsc          lab                 1                   runsc
8f98bcaab7189       2 seconds ago       Ready               sand-runc           lab                 1                   (default)
== runc
6.18.58.1-microsoft-standard-WSL2
[ 1353.316887] br-f05abc3f06bd: port 2(vethdb2247e) entered disabled state
[ 1353.316938] vethdb2247e: entered allmulticast mode
[ 1353.317067] vethdb2247e: entered promiscuous mode
== runsc
4.19.0-gvisor
[   0.000000] Starting gVisor...
[   0.194985] Mounting deweydecimalfs...
[   0.563956] Granting licence to kill(2)...
== host view of the gVisor container
   1699       1 /usr/local/gvisor/containerd-shim-runsc-v1 -
   1715    1699 runsc-gofer --root=/run/containerd/runsc/k8s
   1721    1699 runsc-sandbox --panic-log=/tmp/sand-runsc-lo
   1722    1699 runsc-fd-parking
   1736    1721 [gvisor_sentry]
   1745    1721 [gvisor_sentry]
```

The runc container reports the real kernel of your Docker host and reads that kernel's log, which here contains messages about Docker's network bridge: it shares the kernel with everything else. The gVisor container reports `4.19.0-gvisor`, a version string made up by the Sentry, and its `dmesg` is the Sentry's own boot log. On the node, the gVisor process tree has a shim, a Gofer (`runsc-gofer`), the sandbox (`runsc-sandbox`) and several `gvisor_sentry` processes. The wallet's `sleep` is not in the list: the Sentry hides it inside.

**Step 4: time both.** Write a small benchmark with three loops: pure computation, many `stat()` system calls, and many file reads. Run it five times in each container, alternating.

```bash
cat > /root/bench.py <<'PY'
import os, time
def t(f):
    s = time.perf_counter(); f(); return round(time.perf_counter() - s, 3)
def cpu():
    x = 0
    for i in range(3000000): x += i * i
def stat():
    for _ in range(20000): os.stat('/etc/hostname')
def read():
    for _ in range(4000):
        with open('/etc/hostname', 'rb') as f: f.read()
print(f"cpu={t(cpu)} stat={t(stat)} read={t(read)}")
PY
for i in 1 2 3 4 5; do for r in runc runsc; do printf "%s " $r; crictl exec $(cat /root/sand-$r.id) python3 -c "$(cat /root/bench.py)"; done; done
```

```text
runc cpu=0.66 stat=0.089 read=0.091
runsc cpu=0.617 stat=0.892 read=7.174
runc cpu=1.167 stat=0.205 read=0.196
runsc cpu=1.817 stat=2.769 read=1.777
runc cpu=0.591 stat=0.126 read=0.13
runsc cpu=0.914 stat=2.402 read=10.438
runc cpu=0.94 stat=0.108 read=0.101
runsc cpu=0.831 stat=2.636 read=1.475
runc cpu=0.544 stat=0.112 read=0.115
runsc cpu=0.884 stat=6.537 read=12.345
```

The test machine was busy with other jobs, so single runs vary a lot: the same gVisor read loop took between 1.5 and 12.3 seconds. The chart therefore uses the best of the five runs of each runtime, the run that was disturbed least. Your numbers will differ; the shape should not.

{{diagram lab-4-2-02.jsx | measured 2026-11-17 in Lab 4.2 Part E · 5 runs per runtime, raw rows in data/vol4-runtime-bench-2026-11-17.csv · machine shared with other jobs}}
Computation is not slowed, because the Sentry only gets involved when a process asks the kernel for something. Every `stat()` and every file read is such a request, and under gVisor each one is handled in user space instead of the host kernel. The wallet's own work is mostly network and database calls, which are also system calls, so measure your service before you choose a sandbox.

**Step 5: ask for a runtime that is not installed.**

```bash
sed 's/wallet-pod/wallet-kata/; s/wallet-uid-1/uid-kata/' pod.json > pod-kata.json
crictl runp --runtime kata pod-kata.json 2>&1 | cut -c1-230
```

```text
time="2026-11-17T03:19:42Z" level=fatal msg="run pod sandbox: rpc error: code = Unknown desc = unable to get OCI runtime for sandbox \"ba24c50e9b26...\": no runtime for \"kata\" is configured"
```

This is the error a Pod gets when its RuntimeClass names a handler that this node's containerd does not have. Kata Containers would need a shim, a hypervisor and a guest kernel on the node, and a stanza like the one you wrote for `runsc`.

Answer in your notes: (1) Which two facts in Step 3 show that the gVisor container does not use the host kernel? (2) Why is the computation loop unaffected while the `stat` loop is slow? (3) Name a workload on the wallet's platform that you would put behind gVisor, one that you would not, and what you measured or would measure to decide.

## Checkpoint

You are done when each row gives the expected result. All commands run in the node unless the row says otherwise.

| Check | Command | Expected |
| --- | --- | --- |
| The node has the tools | on your machine: `docker exec lab42-node sh -c 'runc --version \| head -1; crictl --version'` | `runc version 1.4.3` and `crictl version 1.36.0` (or newer patch versions) |
| runc made new namespaces | the `readlink` loop of Part B, step 5 | `pid` and `mnt` inodes differ between container and node |
| The wallet is PID 1 inside | `grep NSpid /proc/$P/status` | two numbers; the second is `1` |
| The memory limit reached the cgroup | `cat /sys/fs/cgroup/wallet-api/memory.max` (while it runs) | `134217728` |
| The root is read-only | `runc exec wallet-api touch /x` | `Read-only file system` |
| Create and start are separate | `runc create demo`, then `runc list` | status `created`, and `runc init` in `ps` |
| The shim is the container's parent | Part C, step 3 `ps` line | `python3 api.py` has the shim's PID as PPID; the shim's PPID is `1` |
| The daemon can restart | Part C, step 4 | the same PID before and after `systemctl restart containerd` |
| The CRI path works | Part D, step 3 | Pod `Ready`, container `Running`, `curl` prints `{"status": "ok"}` |
| gVisor has its own kernel | `crictl exec $(cat /root/sand-runsc.id) uname -r` | `4.19.0-gvisor`, different from the node's `uname -r` |
| gVisor costs system calls | the timing loop of Part E | the `stat` and file-read loops at least 5 times slower under `runsc`; the addition loop within 2 times |
| An unknown handler fails clearly | Part E, step 5 | `no runtime for "kata" is configured` |

Clean up when you finish Break it: leave the node's shell with `exit`, then on your machine run `docker rm -fv lab42-node lab42-db`. Removing the node removes everything you installed in it. Delete `~/cn-lab/gvisor`, `~/cn-lab/nerdctl.tgz`, `~/cn-lab/nerdctl` and `~/cn-lab/wallet-alpine.tar` if you no longer need them. Keep `wallet:alpine`; Lab 4.3 uses it.

## Break it: kill the shim

A container is only as safe as its supervisor. You will kill a shim without warning and read what the node does about it.

```bash
ps -eo pid,ppid,args | grep -E 'sleep 3600|shim' | grep -v grep | cut -c1-110
S=$(ps -eo pid,ppid,args | grep 'sleep 3600' | grep -v grep | head -1 | awk '{print $2}'); echo "shim pid=$S"
kill -9 $S; sleep 4
crictl ps -a | cut -c1-120
crictl pods | cut -c1-110
ps -eo pid,args | grep 'sleep 3600' | grep -v grep | wc -l
journalctl -u containerd --no-pager -n 400 | grep 'dead shim' | tail -1 | cut -c1-200
```

```text
   1590       1 /usr/local/bin/containerd-shim-runc-v2 -namespace k8s.io -id 8f98bcaab718992741e7bda4e15cded2e
   1658    1590 sleep 3600
   1699       1 /usr/local/gvisor/containerd-shim-runsc-v1 -namespace k8s.io -address /run/containerd/containe
   1783       1 /usr/local/gvisor/containerd-shim-runsc-v1 -namespace k8s.io -address /run/containerd/containe
shim pid=1590
CONTAINER           IMAGE                             CREATED             STATE               NAME                ATTEMP
bd847a0e8637c       docker.io/library/wallet:alpine   22 seconds ago      Running             c-sand-runsc        0
d8924b3726701       docker.io/library/wallet:alpine   23 seconds ago      Exited              c-sand-runc         0
POD ID              CREATED             STATE               NAME                NAMESPACE
aa3ffb6d21fb9       23 seconds ago      Ready               sand-runsc          lab
8f98bcaab7189       24 seconds ago      NotReady            sand-runc           lab
0
Nov 17 03:19:50 lab42-node containerd[1513]: time="2026-11-17T03:19:50.981531006Z" level=info msg="cleaning up dead shim" id=8f98bcaab718992741e7bda4e15cded2e0f050e977f88b47a9c4267569f1aef7 namespace=
```

The container exited with its shim, the Pod sandbox became `NotReady`, and containerd logged `cleaning up dead shim`. The gVisor Pod, which has its own shims, was not touched.

Answer in your notes: (1) You restarted containerd in Part C and nothing died; you killed a shim now and the container died. What is different about the two processes? (2) The Pod is `NotReady` and its container `Exited`. What does a kubelet have to notice, and do, to bring the wallet back, and which CRI calls from the sequence diagram does that involve? (3) Why is one shim per Pod a better design than one shim for the whole node, and what does it cost you in a node with 100 Pods?
