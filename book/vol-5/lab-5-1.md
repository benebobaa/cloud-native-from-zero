# Lab 5.1 · A kind Cluster and Objects in etcd

## Goal

You will open a real Kubernetes control plane and look at each part with your own commands: the static Pods that start it, the API by raw URL, the stored bytes in etcd and a live watch stream. Then you stop one component on purpose and find it from the symptoms alone.

### What you will build

{{diagram lab-5-1-01.jsx | what you will do in Lab 5.1 · four parts on one control-plane node}}

The terminal on the left reaches every box with one of four tools. Part A starts at the bottom of the drawing, with the files that create the control plane.

**Versions tested** (2026-11-16, Ubuntu 26.04 on WSL2, Docker Desktop): kind v0.33.0, node image `kindest/node:v1.37.0` (Kubernetes v1.37.0, containerd 2.3.4, etcd 3.7.0), kubectl v1.37.1, GNU binutils 2.46. Every output below came from those runs. Parts A to D were replayed on 2026-11-17 with the same versions and every step exited 0; the Break it experiments were not part of that replay. On Ubuntu 24.04 the Pod name suffixes, IP addresses and ages differ, the shapes do not. **Versions targeted, not run on the test machine:** the `sudo apt` and `sudo install` commands of Part A (no passwordless sudo there).

**Before you start:** Docker Engine from Vol 4, 8 GB of RAM, and the image `wallet:v1` (`docker build -t wallet:v1 wallet/` if `docker images wallet:v1` shows nothing). Keep two terminals open and work in `~/cn-lab/k8s/`.

## Part A · Start a cluster and tour the control plane (40 min)

You will install the tools, start a 3-node cluster and find the four control-plane programs as files, Pods and processes.

Install `kubectl` and `kind` with the commands from the [kubectl install page](https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/) and the [kind quick start](https://kind.sigs.k8s.io/docs/user/quick-start/), plus `binutils` for the `strings` command:

```bash
sudo apt install -y binutils curl
curl -LO "https://dl.k8s.io/release/v1.37.1/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
curl -Lo kind https://kind.sigs.k8s.io/dl/v0.33.0/kind-linux-amd64
sudo install -o root -g root -m 0755 kind /usr/local/bin/kind
kubectl version --client
kind version
```

Write the cluster description. Later labs of this volume reuse it, so keep the name `kind-3nodes.yaml`:

```bash
mkdir -p ~/cn-lab/k8s && cd ~/cn-lab/k8s
cat > kind-3nodes.yaml <<'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
  - role: worker
EOF
kind create cluster --name cnlab-vol5 --image kindest/node:v1.37.0 --config kind-3nodes.yaml
```

This takes one to two minutes and ends with `Set kubectl context to "kind-cnlab-vol5"`. Each node is a Docker container named `cnlab-vol5-control-plane`, `cnlab-vol5-worker` or `cnlab-vol5-worker2`. The cluster cannot see the images in your Docker, so copy `wallet:v1` into every node's container runtime:

```bash
for n in control-plane worker worker2; do
  docker save wallet:v1 | docker exec -i cnlab-vol5-$n ctr -n k8s.io images import -
done
```

`kind load docker-image wallet:v1 --name cnlab-vol5` does the same on plain Docker Engine (tested on 29.10.0, 2026-11-19). It failed with a content-digest error on the Docker Desktop of the test machine, and on Docker Engine it fails the same way for pulled images such as `postgres:17`. The pipe above works in every case, so the labs use it.

Check the nodes. You should see three nodes `Ready`, one with the role `control-plane`, all at kubelet version `v1.37.0` and runtime `containerd://2.3.4`:

```bash
kubectl get nodes -o wide
kubectl -n kube-system get pods -o wide
```

The control plane is ordinary Pods in the `kube-system` namespace (shortened to the first columns; the other nodes' `kindnet` and `kube-proxy` Pods are left out):

```text
NAME                                               READY   STATUS    RESTARTS   AGE   IP
coredns-559f6c778d-cmsnd                           1/1     Running   0          99s   10.244.0.3
coredns-559f6c778d-dt6hm                           1/1     Running   0          99s   10.244.0.2
etcd-cnlab-vol5-control-plane                      1/1     Running   0          106s  172.21.0.4
kindnet-bzlrs                                      1/1     Running   0          95s   172.21.0.3
kube-apiserver-cnlab-vol5-control-plane            1/1     Running   0          106s  172.21.0.4
kube-controller-manager-cnlab-vol5-control-plane   1/1     Running   0          106s  172.21.0.4
kube-proxy-mdfd8                                   1/1     Running   0          100s  172.21.0.4
kube-scheduler-cnlab-vol5-control-plane            1/1     Running   0          106s  172.21.0.4
```

Who started the API server? The kubelet did, from files. Look inside the control-plane node, which is only a Docker container, and list the processes that run beside the Pods:

```bash
docker exec cnlab-vol5-control-plane ls /etc/kubernetes/manifests
docker exec cnlab-vol5-control-plane ps -eo pid,comm,args | grep -E 'containerd |kubelet'
docker exec cnlab-vol5-control-plane crictl ps
```

```text
etcd.yaml
kube-apiserver.yaml
kube-controller-manager.yaml
kube-scheduler.yaml

    132 containerd      /usr/local/bin/containerd
    244 kubelet         /usr/bin/kubelet --bootstrap-kubeconfig=/etc/kubernetes/bootstrap-kubelet.conf --kubeconfig=...
```

The four files are the four programs. The kubelet runs them without asking any API server; `containerd` and the `kubelet` are the two processes of the node itself. `crictl ps` talks to containerd through the CRI (Ch 5.5) and lists the containers that run on this node, among them the four above. The Pods you see in `kubectl` are read-only mirrors that the kubelet creates in the API, so that you can see them.

Finally, the API server's own health report, and the leader leases that Part D explains:

```bash
kubectl get --raw "/readyz?verbose" | head -6
kubectl -n kube-system get lease
```

```text
[+]ping ok
[+]log ok
[+]etcd ok
[+]etcd-readiness ok
[+]informer-sync ok
[+]poststarthook/start-apiserver-admission-initializer ok

NAME                                   HOLDER                                                                      AGE
apiserver-w5cpdnfsz2xcbh3fdok3zuj5ya   apiserver-w5cpdnfsz2xcbh3fdok3zuj5ya_bf50f770-ed96-48bc-b743-cd3860defdda   5m14s
kube-controller-manager                cnlab-vol5-control-plane_a28824c4-292f-4f12-91a3-872b2d017225               5m11s
kube-scheduler                         cnlab-vol5-control-plane_0b1a8d78-04b9-4cd1-a3ea-3be01c574518               5m10s
```

1. Which four files are in the manifests directory? Which `kube-system` Pods are the mirrors of them?
2. The `ps` output shows `kubelet` and `containerd` as processes of the node, not as Pods. Why cannot they be Pods?
3. `[+]etcd ok` appears in the API server's health report. What does that tell you about which component the API server depends on?

## Part B · Ask the API by raw URL (30 min)

You will create a Deployment, read its `spec` and `status`, and prove that `kubectl` is only a client that sends HTTPS requests.

```bash
kubectl create deployment web --image=wallet:v1 --replicas=2 -- python3 -m http.server 8080
kubectl rollout status deploy/web
kubectl scale deploy/web --replicas=4
```

The `--` ends the options; what follows is the container's command (a plain web server, so the Pods have something to answer). A Deployment object has two halves. You wrote `spec`; the controllers write `status`:

```bash
kubectl get deploy web -o yaml | grep -E 'replicas:|maxSurge|maxUnavailable|availableReplicas'
```

You should see `replicas: 4` and the `maxSurge: 25%` and `maxUnavailable: 25%` that the API server filled in as defaults, then `availableReplicas: 4` under `status`. Now print the request that `kubectl` made, with `-v=6`:

```bash
kubectl get deploy web -v=6 2>&1 | grep Response
```

```text
"Response" verb="GET" url="https://127.0.0.1:39167/apis/apps/v1/namespaces/default/deployments/web" status="200 OK"
```

Read the path: `/apis/` + group `apps` + version `v1` + `namespaces/default/` + resource `deployments` + name `web`. Pods and Services are the oldest types, have no group, and live under `/api/v1`. Repeat the request yourself, and ask for something that does not exist:

```bash
kubectl get --raw /apis/apps/v1/namespaces/default/deployments/web | head -c 150
kubectl get --raw /api/v1/namespaces/default/pods/nosuch
```

The first prints the start of a JSON object (`"kind":"Deployment"`). The second prints one line, `Error from server (NotFound): pods "nosuch" not found`: the API server answered with a JSON `Status` object (code 404, reason `NotFound`) and `kubectl` turned it into text. The port number in your URL differs from the one shown, because kind picks a random local port. Ask the server what it serves, and how a field is documented:

```bash
kubectl api-versions | head -8
kubectl api-resources | wc -l
kubectl explain deploy.spec.strategy.rollingUpdate | sed -n '1,12p'
```

```text
admissionregistration.k8s.io/v1
apiextensions.k8s.io/v1
apiregistration.k8s.io/v1
apps/v1
authentication.k8s.io/v1
authorization.k8s.io/v1
autoscaling/v1
autoscaling/v2
72
```

`explain` prints `GROUP: apps`, `KIND: Deployment`, `VERSION: v1` and then the two fields `maxSurge` and `maxUnavailable` with their documentation: it reads the same schema the API server uses.

1. In the URL of the raw GET, which part is the API group and which the version? What is the path of a Pod named `x` in namespace `default`?
2. `kubectl api-resources` printed 72 lines. Why is that one more than the number of resource types?
3. You scaled with `kubectl scale`. Which half of the object did you change, and which half did the controllers change afterwards?
4. Read `maxSurge` in the `explain` output. How many extra Pods may exist during an update of four replicas with the default 25%? (Ch 5.2 uses this.)

## Part C · Read etcd directly (40 min)

You will open the database behind the API server, find an object as raw bytes, and watch a revision counter move.

`etcdctl` ships inside the etcd Pod, so run it there with `kubectl exec`. The three certificate flags are the ones the API server itself uses to get in. Define a helper once in each terminal, then store a ConfigMap and read it back from etcd:

```bash
etcd() {
  kubectl -n kube-system exec etcd-cnlab-vol5-control-plane -- etcdctl \
    --endpoints=https://127.0.0.1:2379 \
    --cacert=/etc/kubernetes/pki/etcd/ca.crt \
    --cert=/etc/kubernetes/pki/etcd/server.crt \
    --key=/etc/kubernetes/pki/etcd/server.key "$@"
}
kubectl create configmap hello --from-literal=greeting=hello-etcd
etcd get /registry/configmaps/default/hello | strings
```

```text
/registry/configmaps/default/hello
	ConfigMap
hello
default"
*$77266e3f-9767-4a06-badd-aa5aa3d49f332
kubectl-create
Update
...
greeting
hello-etcd
```

The key is a path: `/registry/<resource>/<namespace>/<name>`. The value is binary, because Kubernetes stores objects as protocol buffers (the first bytes are `k8s` and a zero); `strings` pulls out the readable parts, and `...` marks lines left out here. Now count what a fresh 3-node cluster stores, by resource:

```bash
etcd get /registry --prefix --keys-only | grep -v '^$' | awk -F/ '{print $3}' | sort | uniq -c | sort -rn | head -10
```

```text
     80 events
     77 clusterroles
     64 clusterrolebindings
     49 serviceaccounts
     14 configmaps
     13 pods
      6 leases
      5 namespaces
      4 services
      3 minions
```

`minions` is the old name for Node objects. Your numbers differ by a few, because the counts depend on the moment you look; in a replay on 2026-11-17 the top ten held apiregistration.k8s.io (22 keys, the built-in APIService objects) and flowschemas instead of minions, which then sat further down. Next, the revision counter. etcd keeps one counter for the whole store, and every write to any key raises it. Kubernetes shows a key's last revision as `metadata.resourceVersion`. Patch the ConfigMap and compare:

```bash
kubectl get cm hello -o jsonpath='{.metadata.resourceVersion}{"\n"}'
kubectl patch cm hello -p '{"data":{"greeting":"hello again"}}'
kubectl get cm hello -o jsonpath='{.metadata.resourceVersion}{"\n"}'
etcd get /registry/configmaps/default/hello -w fields | grep -E "ModRevision|CreateRevision|Version"
```

```text
939
configmap/hello patched
1003
"CreateRevision" : 939
"ModRevision" : 1003
"Version" : 2
```

`ModRevision` equals the second `resourceVersion`, and `Version` counts the writes to this one key (create, then patch). Your counter values differ, the equality does not. Treat `resourceVersion` as an opaque token in your own code: the API docs say it must be passed back unmodified. Now a lesson about secrets. Create one and read its stored bytes:

```bash
kubectl create secret generic db --from-literal=password=s3cret-pw
etcd get /registry/secrets/default/db | strings | tail -4
```

You should see the key `password` followed by `s3cret-pw`, in clear text. Kubernetes base64-encodes Secrets in its API but does not encrypt them in etcd unless you configure it (Going deeper in Ch 5.1, and Ch 5.3). Last, the health of etcd and its members:

```bash
etcd endpoint status -w table
etcd member list
```

The cluster has one member. `endpoint status` reported etcd 3.7.0, `IS LEADER true`, a database of 1.7 to 1.8 MB (two runs) and a quota of 2.1 GB.

1. Which resource has the most keys in a fresh cluster, and what kind of objects are they? (Part D shows who writes them.)
2. `Version` is 2 but `resourceVersion` is about 1000. Why do the two numbers differ?
3. The secret's value is plain text in etcd. Who can read it, and what would you have to change so that they cannot? Write a guess; Ch 5.3 and Vol 6 answer it.
4. The lab cluster has one etcd member. How many would you run in production, and how many failures does that tolerate?

## Part D · Watch and reconcile (40 min)

You will open a watch stream by hand, then follow the chain of loops that one `kubectl create deployment` sets off.

**A watch.** In terminal 1, start a raw watch on the `hello` ConfigMap. It prints the current object, then every change, and does not return:

```bash
kubectl get --raw "/api/v1/namespaces/default/configmaps?watch=1&fieldSelector=metadata.name=hello&resourceVersion=0" | cut -c1-110
```

In terminal 2, change the object twice:

```bash
kubectl patch cm hello -p '{"data":{"greeting":"third"}}'
kubectl patch cm hello -p '{"data":{"greeting":"fourth"}}'
```

Terminal 1 printed an `ADDED` line for the state it joined at, then one `MODIFIED` line per change (shortened here; press Ctrl+C to stop it). `resourceVersion` rose with every write:

```text
{"type":"ADDED","object":{"kind":"ConfigMap","apiVersion":"v1","metadata":{"name":"hello","namespace":"default","uid":"77266e3f-...","resourceVersion":"1011", ...}, "data":{"greeting":"third"}}}
{"type":"MODIFIED","object":{"kind":"ConfigMap", ... "resourceVersion":"1028", ... "data":{"greeting":"fourth"}}}
```

**The chain.** Create a second Deployment and list its Events. `-o custom-columns` chooses which fields to print; here it adds the component that wrote each Event:

```bash
kubectl create deployment web2 --image=wallet:v1 --replicas=2 -- python3 -m http.server 8080
kubectl get events --sort-by=.lastTimestamp -o custom-columns=REASON:.reason,OBJECT:.involvedObject.name,FROM:.source.component,MESSAGE:.message | grep web2
```

The Events of the first Pod, in order. In the test run the Deployment was called `web`; yours shows `web2` and another hash, the order is the same:

```text
REASON              OBJECT                  FROM                    MESSAGE
ScalingReplicaSet   web                     deployment-controller   Scaled up replica set web-5db6cf96 from 0 to 2
SuccessfulCreate    web-5db6cf96            replicaset-controller   Created pod: web-5db6cf96-678n8
Scheduled           web-5db6cf96-678n8      default-scheduler       Successfully assigned default/web-5db6cf96-678n8 to cnlab-vol5-worker2
Pulled              web-5db6cf96-678n8      kubelet                 Container image "wallet:v1" already present on machine ...
Created             web-5db6cf96-678n8      kubelet                 Container created
Started             web-5db6cf96-678n8      kubelet                 Container started
```

Read this list by cause, not by line order. `--sort-by=.lastTimestamp` has a one-second resolution, so lines from the same second may print in any order: in the 2026-11-17 replay `Scheduled` printed before `SuccessfulCreate` and `ScalingReplicaSet` came last, for the same reason.

Four different writers appear: the deployment controller, the replicaset controller, the scheduler and the kubelet. None called another: each woke because an object appeared in the API. The link between them is `ownerReferences`:

```bash
P=$(kubectl get pod -l app=web2 -o name | head -1)
kubectl get $P -o jsonpath='{.metadata.ownerReferences}'
RS=$(kubectl get rs -l app=web2 -o name | head -1)
kubectl get $RS -o jsonpath='{.metadata.ownerReferences}'
```

```text
Pod:        [{"kind":"ReplicaSet","name":"web-5db6cf96", "controller":true, ...}]
ReplicaSet: [{"kind":"Deployment","name":"web", "controller":true, ...}]
```

**Leases.** Controllers that run in several copies elect a leader through a `Lease` object. Read the scheduler's lease, then read its `renewTime` again after five seconds, and list the node heartbeats:

```bash
kubectl -n kube-system get lease kube-scheduler -o jsonpath='{.spec.holderIdentity}{"\n"}{.spec.leaseDurationSeconds}{"\n"}{.spec.renewTime}{"\n"}'
sleep 5
kubectl -n kube-system get lease kube-scheduler -o jsonpath='{.spec.renewTime}{"\n"}'
kubectl -n kube-node-lease get lease
```

The first command prints the holder (`cnlab-vol5-control-plane_` and a random suffix), then `15` (the lease lasts 15 seconds), then a timestamp. The second timestamp is later: the leader renews its lease all the time. The last command lists one Lease per node, which is how each kubelet reports that it is alive.

1. In the watch output, why did the stream start with `ADDED` although you did not create anything at that moment?
2. In the Events, which loop created the Pods, and which one chose their nodes? Which of the two never writes `spec.nodeName`?
3. The scheduler's `renewTime` moved between your two reads. Who wrote it, and what happens if the leader stops writing for longer than `leaseDurationSeconds`?
4. Which Event line would you expect to be missing if the scheduler were not running? Keep the answer for Break it.

## Checkpoint

You are done when all of these hold. Keep your answers to the questions of Parts A to D in `~/cn-lab/lab-5.1.md`.

| Check | Expected |
| --- | --- |
| `docker exec cnlab-vol5-control-plane ls /etc/kubernetes/manifests` | four files: `etcd.yaml`, `kube-apiserver.yaml`, `kube-controller-manager.yaml`, `kube-scheduler.yaml` |
| `kubectl get deploy web -o jsonpath='{.status.availableReplicas}'` | `4` |
| `kubectl get cm hello -o jsonpath='{.metadata.resourceVersion}'` against `ModRevision` in `etcd get ... -w fields` | the same number |
| `etcd get /registry/secrets/default/db \| strings \| grep s3cret` | `s3cret-pw` |
| `kubectl -n kube-system get lease kube-scheduler -o jsonpath='{.spec.leaseDurationSeconds}'` | `15` |
| Break it, experiment 1 | `2/4` and no new Pod while the controller manager is stopped; `4/4` after the restore |
| Break it, experiment 2 | Pod `lonely` is `Pending`, `NODE <none>`, `Events: <none>`; then `Running` after the restore |
| Break it, experiment 3 | `kubectl` fails with `connection reset by peer`; `curl` from a worker node prints `200` |

## Break it: stop one component at a time

Because the control plane is static Pods, moving a manifest out of the directory stops that component within seconds, and moving it back starts it again. You will stop three components, one at a time, and find each one from its symptoms alone. Write your prediction before every `mv`, and restore each component before the next experiment. Set two shortcuts and list the `web` Pods:

```bash
M=/etc/kubernetes/manifests
N=cnlab-vol5-control-plane
kubectl get pods -l app=web -o wide
```

**Experiment 1: the controller manager.** Stop it, delete one `web` Pod, look at the Deployment, then ask for four replicas:

```bash
docker exec $N mv $M/kube-controller-manager.yaml /tmp/
kubectl -n kube-system get pods | grep controller-manager
kubectl delete pod $(kubectl get pod -l app=web -o name | head -1 | cut -d/ -f2) --wait=false
kubectl get deploy web
kubectl scale deploy/web --replicas=4
kubectl get deploy web
```

The Pod list has no controller manager. `--wait=false` makes `kubectl delete` return at once instead of waiting for the Pod to disappear. The deleted Pod shows `Terminating` and nothing replaces it. The Deployment still says what you asked for, but nobody acts on it:

```text
NAME   READY   UP-TO-DATE   AVAILABLE   AGE
web    2/4     2            2           62s
```

The API server accepted the new `spec` and stored it. No loop compared it with the actual state. Restore the component and watch the gap close:

```bash
docker exec $N mv /tmp/kube-controller-manager.yaml $M/
kubectl get pods -l app=web
kubectl get deploy web
```

```text
NAME                 READY   STATUS    RESTARTS   AGE
web-5db6cf96-bldk8   1/1     Running   0          6s
web-5db6cf96-bmwtd   1/1     Running   0          88s
web-5db6cf96-c45xt   1/1     Running   0          6s
web-5db6cf96-cbdh9   1/1     Running   0          6s
NAME   READY   UP-TO-DATE   AVAILABLE   AGE
web    4/4     4            4           88s
```

Within 25 seconds four Pods ran, three of them 6 seconds old: the controller manager started, saw the difference between 4 and 1, and created the missing Pods in one pass.

**Experiment 2: the scheduler.** Scale back to 2 first (`kubectl scale deploy/web --replicas=2`). Stop the scheduler, then create a bare Pod:

```bash
docker exec $N mv $M/kube-scheduler.yaml /tmp/
kubectl run lonely --image=wallet:v1 -- sleep 3600
kubectl get pod lonely -o wide
kubectl describe pod lonely | tail -3
```

```text
NAME     READY   STATUS    RESTARTS   AGE   IP       NODE     NOMINATED NODE   READINESS GATES
lonely   0/1     Pending   0          7s    <none>   <none>   <none>           <none>
Node-Selectors:              <none>
Tolerations:                 node.kubernetes.io/not-ready:NoExecute op=Exists for 300s
                             node.kubernetes.io/unreachable:NoExecute op=Exists for 300s
Events:                      <none>
```

`Pending`, no node and no events at all: not even a `FailedScheduling`, because nobody tried. Restore the scheduler and look again:

```bash
docker exec $N mv /tmp/kube-scheduler.yaml $M/
kubectl get pod lonely -o wide
kubectl describe pod lonely | tail -3
```

```text
NAME     READY   STATUS    RESTARTS   AGE   IP           NODE                NOMINATED NODE   READINESS GATES
lonely   1/1     Running   0          32s   10.244.1.4   cnlab-vol5-worker   <none>           <none>
Events:
  Type    Reason     Age   From               Message
  ----    ------     ----  ----               -------
  Normal  Scheduled  24s   default-scheduler  Successfully assigned default/lonely to cnlab-vol5-worker
```

**Experiment 3: the API server.** Note the IP of one `web` Pod first (`kubectl get pods -l app=web -o wide`), then stop the API server and try both paths:

```bash
IP=<IP of a web Pod>
docker exec $N mv $M/kube-apiserver.yaml /tmp/
kubectl get pods
docker exec cnlab-vol5-worker curl -s -o /dev/null -w '%{http_code}\n' http://$IP:8080/
docker exec $N mv /tmp/kube-apiserver.yaml $M/
```

`kubectl` fails with `read: connection reset by peer`, but the `curl` from a worker node to the Pod prints `200`. The control plane is gone and the application keeps serving. After the restore, `kubectl get pods` worked again within 30 seconds.

1. Experiment 1 left a deleted Pod in `Terminating` and no replacement. Which component ended the container on the node, and which one would have created the replacement?
2. You ran a Pod with no events (experiment 2). Write the one-line rule you would give a teammate to tell "the scheduler is dead" from "the scheduler found no node".
3. In experiment 3 which of the two paths (`kubectl` and `curl`) goes through the control plane, and which through the data plane? What could you not do during those seconds?
4. Delete the test objects and the cluster when you are done: `kubectl delete deploy web web2`, `kubectl delete pod lonely`, then `kind delete cluster --name cnlab-vol5`. Lab 5.2 starts from a fresh cluster.
