# Lab 6.1 · Cilium, Hubble and Default-Deny

**Goal.** Build a two-node kind cluster with no default network and no kube-proxy, let Cilium take over both jobs, watch every flow of the wallet in Hubble, then lock the wallet down with default-deny NetworkPolicies and prove each rule with a command. Time: about 3 to 4 hours, of which 15 minutes are image downloads.

**Versions tested** (run on 2026-11-17): kind v0.33.0, node image `kindest/node:v1.37.0` (Kubernetes 1.37.0), kubectl v1.37.1, Helm v4.3.1, Cilium 1.20.4 (Helm chart 1.20.4, Hubble CLI v1.20.4 shipped inside the agent image), wallet `wallet:v1` from Vol 3. Docker 29.9.2 on Docker Desktop with WSL2 (kernel 6.18.58.1-microsoft-standard-WSL2). Target OS Ubuntu 24.04 LTS; the test machine ran Ubuntu 26.04. Replayed on 2026-11-19 on Ubuntu 24.04.5 LTS (arm64, in a virtual machine) with Docker Engine 29.10.0 from Docker's apt repository: the Milestone 6 reference script, which runs every step of Labs 6.1 to 6.3, passed all 18 checks.

### What you will build

{{diagram lab-6-1-01.jsx | Lab 6.1 · what you will build}}

## Part A · A cluster with no network

A node without a CNI plugin is NotReady, and you will see exactly why before you fix it. Save this file as `kind.yaml`. It switches off kindnet (kind's built-in CNI) and kube-proxy, and maps port 80 of the worker to port 8088 of your laptop for Lab 6.2.

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  disableDefaultCNI: true     # no kindnet: Cilium will be the CNI
  kubeProxyMode: none         # no kube-proxy: Cilium will handle Services
nodes:
  - role: control-plane
  - role: worker
    extraPortMappings:        # lets the host reach the Gateway of Lab 6.2
      - {containerPort: 80, hostPort: 8088, listenAddress: "127.0.0.1"}
```

Use a separate kubeconfig so that no other cluster context on your laptop changes.

```bash
export KUBECONFIG=$HOME/cn-lab/vol6.kubeconfig
kind create cluster --name cnlab-vol6 --config kind.yaml --image kindest/node:v1.37.0
kubectl get nodes
kubectl describe node cnlab-vol6-worker | grep -E 'Ready +False'
docker exec cnlab-vol6-worker ls -la /etc/cni/net.d
kubectl get pods -n kube-system -l k8s-app=kube-dns
```

The real output on the test machine (kind took 45 seconds):

```text
NAME                    STATUS     ROLES           AGE   VERSION
cnlab-vol6-control-plane   NotReady   control-plane   20s   v1.37.0
cnlab-vol6-worker          NotReady   <none>          6s    v1.37.0

Ready  False  ...  KubeletNotReady  [container runtime network not ready: NetworkReady=false
  reason:NetworkPluginNotReady message:Network plugin returns error: cni plugin not initialized,
  CSINode is not yet initialized]

drwx------ 2 root root 4096 Aug 26 21:01 .          (the directory is empty)

NAME                       READY   STATUS    RESTARTS   AGE
coredns-559f6c778d-5lpr2   0/1     Pending   0          10s
coredns-559f6c778d-7xp6v   0/1     Pending   0          10s
```

Read the message: the kubelet asked the container runtime for a network, and the runtime found no file in `/etc/cni/net.d/`. That empty directory is the whole bug.

## Part B · Install Cilium and find the Ch 2.5 pieces on a real node

One Helm release gives you the CNI plugin, the eBPF datapath, the kube-proxy replacement and Hubble. Save the values as `cilium-values.yaml`.

```yaml
# Cilium 1.20.4 on kind: replaces kube-proxy and runs Hubble
image:
  pullPolicy: IfNotPresent
ipam:
  mode: kubernetes                 # use the PodCIDR that kubeadm gave each node
kubeProxyReplacement: true
k8sServiceHost: cnlab-vol6-control-plane   # no kube-proxy, so Cilium must be told where the API server is
k8sServicePort: 6443
operator:
  replicas: 1
hubble:
  relay: {enabled: true}
  ui: {enabled: true}
```

```bash
helm repo add cilium https://helm.cilium.io
helm install cilium cilium/cilium --version 1.20.4 -n kube-system -f cilium-values.yaml
kubectl -n kube-system rollout status ds/cilium --timeout=600s
kubectl get nodes -o wide
```

The first install pulls about 1 GB of images into each node. It took 6 minutes here on a corporate network; the Pods sit in `Init` and `ContainerCreating` while that happens, and that is normal. When the agents are ready, the nodes turn `Ready` and CoreDNS starts.

```bash
kubectl -n kube-system exec ds/cilium -c cilium-agent -- cilium-dbg status --brief
kubectl -n kube-system exec ds/cilium -c cilium-agent -- cilium-dbg status | grep -E 'KubeProxyReplacement|IPAM|Routing|Hubble'
kubectl get ds -A
```

```text
OK
KubeProxyReplacement:   True   [eth0 172.21.0.3 ... (Direct Routing)]
IPAM:                   IPv4: 7/254 allocated from 10.244.1.0/24,
Routing:                Network: Tunnel [vxlan]   Host: Legacy
Hubble:                 Ok   Current/Max Flows: 365/4095 (8.91%), Flows/s: 2.53

NAMESPACE     NAME           DESIRED   CURRENT   READY   ...
kube-system   cilium         2         2         2
kube-system   cilium-envoy   2         2         2        (there is no kube-proxy DaemonSet)
```

Two things in that output answer the chapter. `Tunnel [vxlan]` is the overlay of part 2, chosen by default. `10.244.1.0/24` is this node's PodCIDR, handed out by the Kubernetes control plane.

**1. Who runs `ip link add` now?** Look at what the plugin left on the node, and compare it with your hand-built network of Ch 2.5.

```bash
docker exec cnlab-vol6-worker cat /etc/cni/net.d/05-cilium.conflist
docker exec cnlab-vol6-worker ip -br link
docker exec cnlab-vol6-worker ip route
docker exec cnlab-vol6-worker ip -d link show type bridge
kubectl -n kube-system exec ds/cilium -c cilium-agent -- bpftool net show | grep lxc
```

```text
{ "cniVersion": "1.0.0", "name": "cilium",
  "plugins": [ { "type": "cilium-cni", "enable-debug": false, "log-file": "/var/run/cilium/cilium-cni.log" } ] }

cilium_net@cilium_host   cilium_host@cilium_net   cilium_vxlan
lxc_health@if6   lxc52f4b083fab4@if8   lxc45a219ad1f14@if10   ...      (one lxc... per Pod)

10.244.0.0/24 via 10.244.1.203 dev cilium_host proto kernel src 10.244.1.203 mtu 1450
10.244.1.0/24 via 10.244.1.203 dev cilium_host proto kernel src 10.244.1.203

(no output: there is no bridge)

lxc_health(7) tcx/ingress cil_from_container prog_id 1611 link_id 44
lxc52f4b083fab4(9) tcx/ingress cil_from_container prog_id 1616 link_id 47
```

Every `lxc...` interface is the host end of a veth pair, the same object you made in Ch 2.5. What changed is who plugs it in: no `cni0` bridge exists. Instead an eBPF program, `cil_from_container`, is attached to the `lxc...` end and decides where each packet goes. Two more facts to take from the output. The route to the other node's range (`10.244.0.0/24`) carries `mtu 1450`: that is the 50-byte VXLAN header from the chapter, measured. And the CNI file is the contract of part 1 in the flesh: a JSON list with one plugin.

**2. Where did kube-proxy go?** Count what kube-proxy would have written, then ask Cilium for its Service table.

```bash
docker exec cnlab-vol6-worker sh -c 'iptables-save | grep -c -E "KUBE-SVC|KUBE-SEP"'
kubectl -n kube-system exec ds/cilium -c cilium-agent -- cilium-dbg service list | head -8
```

```text
0

ID   Frontend               Service Type   Backend
1    10.96.0.1:443/TCP      ClusterIP      1 => 172.21.0.2:6443/TCP (active)
5    10.96.0.10:53/TCP      ClusterIP      1 => 10.244.1.4:53/TCP (active)
                                           2 => 10.244.1.31:53/TCP (active)
```

No Service rules are in iptables: every ClusterIP lives in an eBPF map and `cilium-dbg service list` prints it. The `KUBE-IPTABLES-HINT` and `KUBE-KUBELET-CANARY` chains you may still see in `iptables-save` are made by the kubelet, not by kube-proxy.

**3. What does that save?** An optional experiment with real numbers: create a default kind cluster (with kube-proxy in `iptables` mode), then 600 Services that all select one Pod, and count the lines `iptables-save` prints on the node after each batch. Repeat on the Cilium cluster. Both runs were measured on the test machine on 2026-11-17; the data file is `data/vol6-iptables-lines-vs-services-2026-11-17.csv`.

```bash
kubectl create ns scale
kubectl -n scale run backend --image=nginx --labels app=backend
mk() { for i in $(seq "$1" "$2"); do printf 'apiVersion: v1\nkind: Service\nmetadata: {name: svc-%d, namespace: scale}\nspec:\n  selector: {app: backend}\n  ports: [{port: 80}]\n---\n' "$i"; done; }
mk 1 100 | kubectl apply -f -          # then 101-300, then 301-600
docker exec <node> sh -c 'iptables-save | wc -l'     # the node's container name, as in docker ps
```

{{diagram lab-6-1-02.jsx | iptables-save lines per node vs number of Services · measured 2026-11-17, kind v0.33.0, one node · data: data/vol6-iptables-lines-vs-services-2026-11-17.csv}}

The slope is the point: with kube-proxy every Service costs about 7 more lines on every node, and an update must rewrite them. Cilium's iptables stayed at 89 lines because the Services live in a BPF map instead (it held 613 rows in `cilium-dbg service list` at 600 Services). Of those 89 lines, 42 name Cilium's own chains and 8 name kubelet chains (`grep -c CILIUM` and `grep -c KUBE-`); none is a Service rule.

## Part C · Run the wallet and watch it in Hubble

Hubble prints every flow the datapath sees, with its verdict. First put the wallet on the cluster. Save the manifest below as `wallet.yaml`. It is the Vol 5 wallet in one file, with one change on purpose: it has no network policy and no security settings yet.

```yaml
apiVersion: v1
kind: Namespace
metadata: {name: wallet}
---
apiVersion: v1
kind: Secret
metadata: {name: wallet-db, namespace: wallet}
stringData:
  POSTGRES_PASSWORD: lab-only-password   # a lab value; never a real secret (Ch 6.3, part 6)
---
apiVersion: v1
kind: Service
metadata: {name: postgres, namespace: wallet}
spec:
  clusterIP: None
  selector: {app: postgres}
  ports: [{name: pg, port: 5432}]
---
apiVersion: apps/v1
kind: StatefulSet
metadata: {name: postgres, namespace: wallet}
spec:
  serviceName: postgres
  replicas: 1
  selector: {matchLabels: {app: postgres}}
  template:
    metadata: {labels: {app: postgres}}
    spec:
      containers:
        - name: postgres
          image: postgres:17
          ports: [{containerPort: 5432, name: pg}]
          env:
            - {name: POSTGRES_USER, value: wallet}
            - {name: POSTGRES_DB, value: wallet}
            - {name: PGDATA, value: /var/lib/postgresql/data/pgdata}
            - name: POSTGRES_PASSWORD
              valueFrom: {secretKeyRef: {name: wallet-db, key: POSTGRES_PASSWORD}}
          readinessProbe:
            exec: {command: ["pg_isready", "-U", "wallet"]}
            periodSeconds: 3
          volumeMounts: [{name: data, mountPath: /var/lib/postgresql/data}]
  volumeClaimTemplates:
    - metadata: {name: data}
      spec:
        accessModes: ["ReadWriteOnce"]
        resources: {requests: {storage: 1Gi}}
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: wallet-api, namespace: wallet}
spec:
  replicas: 2
  selector: {matchLabels: {app: wallet-api}}
  template:
    metadata: {labels: {app: wallet-api}}
    spec:
      containers:
        - name: api
          image: wallet:v1
          command: ["python3", "api.py"]
          ports: [{containerPort: 8080, name: http}]
          env:
            - name: POSTGRES_PASSWORD
              valueFrom: {secretKeyRef: {name: wallet-db, key: POSTGRES_PASSWORD}}
            - {name: DATABASE_URL, value: "postgresql://wallet:$(POSTGRES_PASSWORD)@postgres:5432/wallet"}
          readinessProbe:
            httpGet: {path: /readyz, port: http}
            periodSeconds: 2
          livenessProbe:
            httpGet: {path: /healthz, port: http}
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata: {name: wallet-api, namespace: wallet}
spec:
  selector: {app: wallet-api}
  ports: [{name: http, port: 80, targetPort: http}]
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: wallet-worker, namespace: wallet}
spec:
  replicas: 1
  selector: {matchLabels: {app: wallet-worker}}
  template:
    metadata: {labels: {app: wallet-worker}}
    spec:
      containers:
        - name: worker
          image: wallet:v1
          command: ["python3", "worker.py"]
          env:
            - name: POSTGRES_PASSWORD
              valueFrom: {secretKeyRef: {name: wallet-db, key: POSTGRES_PASSWORD}}
            - {name: DATABASE_URL, value: "postgresql://wallet:$(POSTGRES_PASSWORD)@postgres:5432/wallet"}
```

The `wallet:v1` image must be inside the kind nodes. `kind load docker-image wallet:v1 --name cnlab-vol6` worked on plain Docker Engine 29.10.0 (tested 2026-11-19) but failed with a content-digest error on Docker Desktop, so the method shown pipes the image into containerd on the worker, which works on both (it took 52 seconds on Docker Desktop). The `postgres:17` image can be pulled by the node itself; that took about 4 minutes here.

```bash
docker save wallet:v1 | docker exec -i cnlab-vol6-worker ctr -n k8s.io images import -
kubectl apply -f wallet.yaml
kubectl -n wallet rollout status sts/postgres deploy/wallet-api deploy/wallet-worker --timeout=600s
kubectl get pods -n wallet -o wide
kubectl -n wallet port-forward svc/wallet-api 18080:80 &
./test_e2e.sh http://localhost:18080        # test_e2e.sh is in your wallet/ directory
kill %1
```

```text
NAME                           READY   STATUS    RESTARTS   AGE   IP             NODE
postgres-0                     1/1     Running   0          5m    10.244.1.24    cnlab-vol6-worker
wallet-api-9c46b9f74-9ldnj     1/1     Running   5          5m    10.244.1.61    cnlab-vol6-worker
wallet-api-9c46b9f74-jv47c     1/1     Running   5          5m    10.244.1.3     cnlab-vol6-worker
wallet-worker-7497dffc6c-6xppj 1/1     Running   2          5m    10.244.1.205   cnlab-vol6-worker

transfer=settled big=rejected alice=70 bob=80
PASS
```

The api and worker restarted a few times while Postgres was still starting. They exit or fail their liveness probe while the database does not answer yet, and the kubelet restarts them; this is expected here, not a fault. Now read the flows. `hubble` is inside the agent Pod; ask the agent on the worker node, because that is where all wallet Pods run.

```bash
CIL=$(kubectl -n kube-system get pod -l k8s-app=cilium --field-selector spec.nodeName=cnlab-vol6-worker -o name)
kubectl -n kube-system exec $CIL -c cilium-agent -- hubble observe -n wallet --to-port 5432 --last 4
```

```text
Nov 17 03:08:01.100: wallet/wallet-api-9c46b9f74-9ldnj:40428 (ID:39352) -> wallet/postgres-0:5432 (ID:39466) to-endpoint FORWARDED (TCP Flags: ACK)
Nov 17 03:08:01.101: wallet/wallet-api-9c46b9f74-9ldnj:40428 (ID:39352) -> wallet/postgres-0:5432 (ID:39466) to-endpoint FORWARDED (TCP Flags: ACK, PSH)
Nov 17 03:08:01.110: wallet/wallet-api-9c46b9f74-9ldnj:40428 (ID:39352) -> wallet/postgres-0:5432 (ID:39466) to-endpoint FORWARDED (TCP Flags: ACK, FIN)
```

Read one line from left to right: the time, the source Pod and port, the source's security identity (`ID:39352`, shared by every Pod with the labels of `wallet-api`), the destination Pod and port and its identity, where the packet went (`to-endpoint`), and the verdict. Two `wallet-api` Pods have the same ID: that is the identity model of part 4, visible.

The same flows are drawn by the Hubble UI. Forward its port and open the wallet namespace.

```bash
kubectl -n kube-system port-forward svc/hubble-ui 12000:80 &
# open http://localhost:12000/?namespace=wallet in a browser
```

**Cross-node traffic.** All wallet Pods share one node, so check the overlay with two throwaway Pods on different nodes. `nodeName` places a Pod by hand, even on the control-plane node, which normally refuses workloads.

```bash
kubectl create ns intruder
kubectl -n intruder run web --image=nginx --overrides='{"spec":{"nodeName":"cnlab-vol6-worker"}}'
kubectl -n intruder run xnode --image=curlimages/curl:8.15.0 --command --overrides='{"spec":{"nodeName":"cnlab-vol6-control-plane"}}' -- sleep 86400
kubectl -n intruder wait --for=condition=Ready pod/web pod/xnode --timeout=120s
WEB=$(kubectl -n intruder get pod web -o jsonpath='{.status.podIP}')
kubectl -n intruder exec xnode -- curl -s -o /dev/null -w '%{http_code}\n' http://$WEB
```

```text
200
```

The request went from a Pod on `10.244.0.0/24` to a Pod on `10.244.1.0/24` through the `cilium_vxlan` tunnel, with no route on the Docker network that knows either range. (The nginx image is pulled by the worker; on a slow link, pipe it in as you did for the wallet.)

## Part D · Default deny, then three paths

You will close every door in the `wallet` namespace and open exactly three paths: the entry point to `wallet-api`, `wallet-api` to `postgres`, and `wallet-worker` to `postgres`. In Lab 6.2 the entry point becomes a real Gateway. For now a Pod in an `edge` namespace stands in for it, and a Pod in an `intruder` namespace is the attacker.

```bash
kubectl create ns edge
kubectl -n edge run edge-client --image=curlimages/curl:8.15.0 --labels app=edge-client --command -- sleep 86400
kubectl -n intruder run intruder --image=curlimages/curl:8.15.0 --labels app=intruder --command -- sleep 86400
kubectl -n edge wait --for=condition=Ready pod/edge-client --timeout=120s
kubectl -n intruder wait --for=condition=Ready pod/intruder --timeout=120s
```

A small shell function prints OPEN when a connection is made and BLOCKED when it times out. `curl` exits with 52 when it reaches Postgres (which does not speak HTTP) and with 28 on a timeout, so both are readable.

```bash
probe() { # probe <namespace> <pod> <url>
  kubectl -n "$1" exec "$2" -- curl -s -m 3 -o /dev/null "$3" 2>/dev/null; c=$?
  case $c in 0|52) echo "OPEN    $1/$2 -> $3";; 28) echo "BLOCKED $1/$2 -> $3";; *) echo "ERROR($c) $1/$2 -> $3";; esac; }
probe edge edge-client http://wallet-api.wallet/healthz
probe intruder intruder http://wallet-api.wallet/healthz
probe intruder intruder http://postgres.wallet:5432/
```

All three print `OPEN`. That is the problem of part 4: today the intruder can talk to your database. Now apply the first policy. It selects every Pod and lists both directions, so everything is denied.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: default-deny, namespace: wallet}
spec:
  podSelector: {}            # every Pod in the namespace
  policyTypes: [Ingress, Egress]
```

```bash
kubectl apply -f 00-default-deny.yaml
probe edge edge-client http://wallet-api.wallet/healthz
kubectl -n kube-system exec $CIL -c cilium-agent -- hubble observe -n wallet --verdict DROPPED --last 4
```

```text
BLOCKED edge/edge-client -> http://wallet-api.wallet/healthz
Nov 17 03:07:23.089: wallet/wallet-api-9c46b9f74-9ldnj:33997 (ID:39352) <> kube-system/coredns-559f6c778d-7xp6v:53 (ID:49351) Policy denied DROPPED (UDP)
Nov 17 03:07:24.054: wallet/wallet-api-9c46b9f74-jv47c:59454 (ID:39352) <> kube-system/coredns-559f6c778d-5lpr2:53 (ID:49351) policy-verdict:none EGRESS DENIED (UDP)
```

The first drops are not the intruder: they are the wallet itself, asking CoreDNS for the name `postgres`. Default deny blocks egress too, so DNS goes first. Apply the DNS rule and the three path rules. Each file goes in its own `kubectl apply`.

```yaml
# 01-allow-dns.yaml: every Pod may ask kube-dns
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: allow-dns, namespace: wallet}
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector: {matchLabels: {kubernetes.io/metadata.name: kube-system}}
          podSelector: {matchLabels: {k8s-app: kube-dns}}     # same entry: AND
      ports:
        - {protocol: UDP, port: 53}
        - {protocol: TCP, port: 53}
---
# 02-api-from-edge.yaml: path 1, entry point to wallet-api
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: api-from-edge, namespace: wallet}
spec:
  podSelector: {matchLabels: {app: wallet-api}}
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector: {matchLabels: {kubernetes.io/metadata.name: edge}}
          podSelector: {matchLabels: {app: edge-client}}      # same entry: AND
      ports:
        - {protocol: TCP, port: 8080}
---
# 03-postgres-from-wallet.yaml: paths 2 and 3, the receiving side
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: postgres-from-wallet, namespace: wallet}
spec:
  podSelector: {matchLabels: {app: postgres}}
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchExpressions: [{key: app, operator: In, values: [wallet-api, wallet-worker]}]
      ports:
        - {protocol: TCP, port: 5432}
---
# 04-wallet-to-postgres.yaml: paths 2 and 3, the sending side
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: wallet-to-postgres, namespace: wallet}
spec:
  podSelector:
    matchExpressions: [{key: app, operator: In, values: [wallet-api, wallet-worker]}]
  policyTypes: [Egress]
  egress:
    - to:
        - podSelector: {matchLabels: {app: postgres}}
      ports:
        - {protocol: TCP, port: 5432}
```

Paths 2 and 3 need two policies each, because a connection needs the sender's egress rule and the receiver's ingress rule (part 4, rule 3). Check all six paths: three must be open and three blocked.

```bash
kubectl get netpol -n wallet
probe edge edge-client http://wallet-api.wallet/healthz
kubectl -n wallet exec deploy/wallet-api -- python3 -c "import os,psycopg; c=psycopg.connect(os.environ['DATABASE_URL'],connect_timeout=3); print('OPEN    wallet-api -> postgres:5432')"
kubectl -n wallet logs deploy/wallet-worker --tail=2
probe intruder intruder http://postgres.wallet:5432/
probe intruder intruder http://wallet-api.wallet/healthz
probe edge edge-client http://postgres.wallet:5432/
```

```text
NAME                   POD-SELECTOR                        AGE
allow-dns              <none>                              7s
api-from-edge          app=wallet-api                      7s
default-deny           <none>                              24s
postgres-from-wallet   app=postgres                        6s
wallet-to-postgres     app in (wallet-api,wallet-worker)   6s

OPEN    edge/edge-client -> http://wallet-api.wallet/healthz
OPEN    wallet-api -> postgres:5432
wallet-worker: transfer t-23963-38433 settled
wallet-worker: transfer t-23963-38433-big rejected
BLOCKED intruder/intruder -> http://postgres.wallet:5432/
BLOCKED intruder/intruder -> http://wallet-api.wallet/healthz
BLOCKED edge/edge-client -> http://postgres.wallet:5432/
```

The worker line proves path 3: a settled transfer needs the database. The `POD-SELECTOR` column shows `<none>` for `podSelector: {}`, which means every Pod. Open the Hubble UI again: the link into port 5432 of Postgres is drawn dashed where flows were dropped, and the table underneath lists the `dropped` verdicts of `intruder` next to the `forwarded` ones of the wallet. Keep the cluster for Lab 6.2.

![Hubble UI, namespace wallet: wallet-worker and wallet-api reach postgres, the intruder is dropped](images/lab-6-1-hubble-ui.png)

*Hubble UI for the `wallet` namespace after Part D, captured with Playwright on 2026-11-17 while a loop sent traffic. The dashed link into `postgres` carries the `dropped` rows from `intruder` in the flow table; the `forwarded` rows are the wallet's own traffic.*

## Checkpoint

| # | Command | Expected output |
| --- | --- | --- |
| 1 | `kubectl get nodes` | both nodes `Ready` |
| 2 | `kubectl -n kube-system exec ds/cilium -c cilium-agent -- cilium-dbg status --brief` | `OK` |
| 3 | `kubectl -n kube-system exec ds/cilium -c cilium-agent -- cilium-dbg status \| grep KubeProxyReplacement` | `True` |
| 4 | `docker exec cnlab-vol6-worker sh -c 'iptables-save \| grep -c -E "KUBE-SVC\|KUBE-SEP"'` | `0` |
| 5 | `kubectl -n kube-system get ds kube-proxy` | `NotFound` |
| 6 | `kubectl get netpol -n wallet` | five policies: `allow-dns`, `api-from-edge`, `default-deny`, `postgres-from-wallet`, `wallet-to-postgres` |
| 7 | the six `probe` calls of Part D | 3 times `OPEN`, 3 times `BLOCKED`, in the order shown |
| 8 | `hubble observe -n wallet --verdict DROPPED --last 3` | at least one `Policy denied DROPPED` line naming `intruder` |

## Break it

Two failures to cause and diagnose. Write your prediction before you run each one.

**1. Remove DNS.** Delete the DNS policy and connect by name.

```bash
kubectl delete netpol allow-dns -n wallet
kubectl -n wallet exec deploy/wallet-api -- python3 -c "import os,psycopg; psycopg.connect(os.environ['DATABASE_URL'],connect_timeout=3)"
kubectl -n kube-system exec $CIL -c cilium-agent -- hubble observe -n wallet --verdict DROPPED --last 3
```

```text
FAILED: [Errno -3] Temporary failure in name resolution
Nov 17 03:08:29.170: wallet/wallet-api-9c46b9f74-jv47c:56254 (ID:39352) <> kube-system/coredns-559f6c778d-5lpr2:53 (ID:49351) policy-verdict:none EGRESS DENIED (UDP)
```

The error message says nothing about policy. Only the Hubble line shows the cause: egress to port 53 was denied. Restore the policy with `kubectl apply -f 01-allow-dns.yaml` and connect again.

**2. Remove one half of a path.** Delete only the egress policy and connect.

```bash
kubectl delete netpol wallet-to-postgres -n wallet
kubectl -n wallet exec deploy/wallet-api -- python3 -c "import os,psycopg; psycopg.connect(os.environ['DATABASE_URL'],connect_timeout=3)"
kubectl -n kube-system exec $CIL -c cilium-agent -- hubble observe -n wallet --verdict DROPPED --last 2
```

```text
FAILED: connection timeout expired
Nov 17 03:08:53.562: wallet/wallet-api-9c46b9f74-jv47c:44424 (ID:39352) <> wallet/postgres-0:5432 (ID:39466) policy-verdict:none EGRESS DENIED (TCP Flags: SYN)
```

`postgres-from-wallet` still allows the connection, yet it fails, and the first drop is on the client side: `EGRESS DENIED` on `wallet-api`. This is the answer to Review 6.1 question 5. Restore it with `kubectl apply -f 04-wallet-to-postgres.yaml`.

**Clean up** only when you are completely done with Vol 6. Labs 6.2 and 6.3 continue on this cluster: `kind delete cluster --name cnlab-vol6`.
