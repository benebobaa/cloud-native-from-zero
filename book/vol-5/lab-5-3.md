# Lab 5.3 · Tracing a Packet through a Service

## Goal

You will build a Service for three web Pods and follow one request from its name to a Pod's IP, through DNS, the EndpointSlice and the kernel's iptables rules. Then you will make a Pod leave the rotation, change a ConfigMap, and read a Secret straight from etcd.

**Versions tested** (2026-11-16, replayed 2026-11-17 and 2026-11-18, Ubuntu 26.04 on WSL2, Docker Desktop): kind v0.33.0 with `kindest/node:v1.37.0` (Kubernetes 1.37.0, kube-proxy in iptables mode, CoreDNS 1.14.6), kubectl v1.37.1, `busybox:1.37`, and `wallet:v1` used only as a Python web server. Every output below was captured in those runs. Pod IPs and chain names differ on your cluster; the shapes do not. The replay on 2026-11-17 ran the commands of Parts A to E and Break it as typed, except that its `sed` pipe for the CoreDNS `log` line matched nothing (see Part D). Not reproduced in that replay: the `conntrack` lines of Part B, which come from the 2026-11-16 run. The Part D lookups, with the fixed `sed` pipe, and their query-log lines were run again on 2026-11-18.

**Before you start:** you need the three-node cluster from Lab 5.1 (re-create it with the same `kind create cluster --name cnlab-vol5 --image kindest/node:v1.37.0 --config kind-3nodes.yaml` if you deleted it). Load the two images into every node with the method from Lab 5.2. On plain Docker Engine, `kind load docker-image` works for `wallet:v1` but not for `postgres:17` (Lab 5.1 explains why the labs use the pipe).

```bash
docker pull busybox:1.37
for n in control-plane worker worker2; do
  for i in wallet:v1 busybox:1.37; do
    docker save $i | docker exec -i cnlab-vol5-$n ctr -n k8s.io images import -
  done
done
```

In the commands below, `cnlab-vol5-worker` is the Docker container that is the node, so `docker exec cnlab-vol5-worker ...` runs a command on that node. Keep two terminals open for Part C.

### What you will build

{{diagram lab-5-3-01.jsx | what you will build in Lab 5.3 · request path on top, settings path below}}

Read the top half as a request travels: the client asks DNS for `web` (1), sends to the virtual IP (2), and a rule rewrites it to one ready Pod (3). The EndpointSlice feeds the rules, and a NodePort is a second entrance to the same rules. The bottom half is Part E: one object, two ways into a Pod.

## Part A · A Service and its EndpointSlice (30 min)

You will create three web Pods and one Service in front of them, then read the EndpointSlice that a controller wrote for you. Each Pod answers a request with its own name, so you can tell them apart. Save this as `web-svc.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
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
          # each Pod answers with its own hostname
          command: ["sh", "-c", "mkdir -p /tmp/w && echo $HOSTNAME > /tmp/w/index.html && exec python3 -m http.server 8080 --directory /tmp/w"]
          ports:
            - containerPort: 8080
              name: http
          readinessProbe:
            httpGet: {path: /index.html, port: http}
            periodSeconds: 2
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
  ports:
    - name: http
      port: 80
      targetPort: http
```

```bash
kubectl apply -f web-svc.yaml
kubectl rollout status deploy/web
kubectl get svc web
kubectl get endpointslices -l kubernetes.io/service-name=web
```

The Service has a virtual IP and the slice lists three Pod IPs on port 8080. Your addresses and the slice's random suffix differ:

```text
NAME   TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)   AGE
web    ClusterIP   10.96.206.56   <none>        80/TCP    2s
NAME        ADDRESSTYPE   PORTS   ENDPOINTS                             AGE
web-k4j29   IPv4          8080    10.244.2.40,10.244.1.31,10.244.2.41   3s
```

Now open the slice itself and look at who owns it and what each endpoint says about its health:

```bash
kubectl get endpointslices -l kubernetes.io/service-name=web -o yaml
```

Trimmed to the fields that matter:

```text
  endpoints:
  - addresses:
    - 10.244.2.40
    conditions:
      ready: true
      serving: true
      terminating: false
    nodeName: cnlab-vol5-worker2
    targetRef:
      kind: Pod
      name: web-749fb7cfc9-r4qrd
  metadata:
    labels:
      endpointslice.kubernetes.io/managed-by: endpointslice-controller.k8s.io
      kubernetes.io/service-name: web
    ownerReferences:
    - kind: Service
      name: web
  ports:
  - name: http
    port: 8080
```

The older Endpoints object still exists and shows the same three addresses. kubectl warns that it is deprecated:

```bash
kubectl get endpoints web
```

```text
Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice
NAME   ENDPOINTS                                            AGE
web    10.244.1.31:8080,10.244.2.40:8080,10.244.2.41:8080   9s
```

1. Which field of the Service selects Pods, and which field of the Deployment's Pod template supplies the matching label?
2. The Service says port 80 and the Pods listen on 8080. Which field connects them, and why can it use the name `http`?
3. Who created the EndpointSlice, you or a controller? Find two fields in the YAML that prove it.
4. Make a prediction for Part B: the Service IP `10.96.206.56` is on no network card. How will a packet addressed to it reach a Pod?

## Part B · Trace one packet through the iptables rules (45 min)

You will send requests from a client Pod, then read the rules on the node that carried them. Start the client and make one request:

```bash
kubectl run client --image=busybox:1.37 --restart=Never -- sleep 3600
kubectl wait --for=condition=Ready pod/client --timeout=60s
kubectl exec client -- wget -q -O - http://web
```

The answer is the name of one web Pod, for example `web-749fb7cfc9-r4qrd`. Now look at the node. Every Pod packet enters the `nat` table through `PREROUTING`, and the first rule jumps to `KUBE-SERVICES`:

```bash
docker exec cnlab-vol5-worker iptables -t nat -S PREROUTING
docker exec cnlab-vol5-worker iptables -t nat -S KUBE-SERVICES | grep default/web
```

```text
-P PREROUTING ACCEPT
-A PREROUTING -m comment --comment "kubernetes service portals" -j KUBE-SERVICES
-A PREROUTING -d 192.168.65.254/32 -j DOCKER_OUTPUT
-A KUBE-SERVICES -d 10.96.206.56/32 -p tcp -m comment --comment "default/web:http cluster IP" -m tcp --dport 80 -j KUBE-SVC-CDGGSHYLG3RE2FKL
```

The `DOCKER_OUTPUT` line belongs to Docker, not to Kubernetes. The last line is the match: destination `10.96.206.56`, TCP, port 80, then a jump to the Service's own chain. Read that chain, and then the chain of one endpoint. Copy the chain name from your own output:

```bash
SVC=$(docker exec cnlab-vol5-worker iptables -t nat -S KUBE-SERVICES | grep 'default/web:http cluster IP' | grep -o 'KUBE-SVC-[A-Z0-9]*')
docker exec cnlab-vol5-worker iptables -t nat -S $SVC
docker exec cnlab-vol5-worker iptables -t nat -S KUBE-SEP-36V5QKA2DLDNNYIH   # use a KUBE-SEP name from your own output
```

```text
-N KUBE-SVC-CDGGSHYLG3RE2FKL
-A KUBE-SVC-CDGGSHYLG3RE2FKL ! -s 10.244.0.0/16 -d 10.96.206.56/32 -p tcp -m comment --comment "default/web:http cluster IP" -m tcp --dport 80 -j KUBE-MARK-MASQ
-A KUBE-SVC-CDGGSHYLG3RE2FKL -m comment --comment "default/web:http -> 10.244.1.31:8080" -m statistic --mode random --probability 0.33333333349 -j KUBE-SEP-36V5QKA2DLDNNYIH
-A KUBE-SVC-CDGGSHYLG3RE2FKL -m comment --comment "default/web:http -> 10.244.2.40:8080" -m statistic --mode random --probability 0.50000000000 -j KUBE-SEP-3EOAO7T7KM6VD4LE
-A KUBE-SVC-CDGGSHYLG3RE2FKL -m comment --comment "default/web:http -> 10.244.2.41:8080" -j KUBE-SEP-A66XKCMH4O57UK7H
-N KUBE-SEP-36V5QKA2DLDNNYIH
-A KUBE-SEP-36V5QKA2DLDNNYIH -s 10.244.1.31/32 -m comment --comment "default/web:http" -j KUBE-MARK-MASQ
-A KUBE-SEP-36V5QKA2DLDNNYIH -p tcp -m comment --comment "default/web:http" -m tcp -j DNAT --to-destination 10.244.1.31:8080
```

The three `KUBE-SEP` chains differ only in the Pod IP. The packet matched one rule, got a new destination, and left for a Pod. The kernel remembered the rewrite, so the reply can find its way back. Prove it: send three requests, then ask the node that hosts the client for its tracked connections to the Service IP. Run it within two minutes, because finished entries expire:

```bash
kubectl exec client -- sh -c 'for i in 1 2 3; do wget -q -O /dev/null http://web; done'
NODE=$(kubectl get pod client -o jsonpath='{.spec.nodeName}')
docker exec $NODE conntrack -L -d 10.96.206.56
```

```text
tcp  6 117 TIME_WAIT src=10.244.1.32 dst=10.96.206.56 sport=38588 dport=80 src=10.244.2.40 dst=10.244.1.32 sport=8080 dport=38588 [ASSURED] mark=0 use=1
tcp  6 117 TIME_WAIT src=10.244.1.32 dst=10.96.206.56 sport=38794 dport=80 src=10.244.2.41 dst=10.244.1.32 sport=8080 dport=38794 [ASSURED] mark=0 use=1
tcp  6 114 TIME_WAIT src=10.244.1.32 dst=10.96.206.56 sport=36368 dport=80 src=10.244.1.31 dst=10.244.1.32 sport=8080 dport=36368 [ASSURED] mark=0 use=1
```

Each line is one connection: the original tuple first (client to `10.96.206.56:80`), the reply tuple second (a Pod back to the client). Three connections went to three different Pods.

Finally, measure the spread. Send 300 requests, each on its own connection, and count which Pod answered:

```bash
kubectl exec client -- sh -c 'for i in $(seq 300); do wget -q -O - http://web; done' | sort | uniq -c
```

```text
     92 web-749fb7cfc9-dchq8
    109 web-749fb7cfc9-r4qrd
     99 web-749fb7cfc9-sr69q
```

The split is 92, 109 and 99, the same run that the chart in Ch 5.3 "How the rules follow the Pods" draws against a perfect 100 each. Your three numbers will differ, and that is the point.

1. In the `KUBE-SVC` chain the second probability is 0.5 and the third rule has no condition at all. Why does that give each Pod one third?
2. In a `conntrack` line, which tuple is the packet the client sent and which is the reply? What would happen to the reply if the node forgot the entry?
3. The standard deviation of a count is about 8. Are your three counts within two of them (16) of 100?
4. Why does the test open 300 connections instead of sending 300 requests down one connection?

## Part C · A Pod that is not ready leaves the rotation (40 min)

You will break one Pod's readiness probe and time how long the rule that sends traffic to it survives. The probe fetches `/index.html` every 2 seconds, so deleting that file inside one Pod makes the probe fail while the container keeps running. List the Pods and choose one that runs on `cnlab-vol5-worker2`; replace the Pod name below with yours:

```bash
kubectl get pods -l app=web -o wide
POD=web-749fb7cfc9-dchq8
IP=$(kubectl get pod $POD -o jsonpath='{.status.podIP}')
docker exec cnlab-vol5-worker2 sh -c "iptables-save -t nat | grep -c 'to-destination $IP:8080'"
```

The last command counts the DNAT rules for that Pod's IP on the node. It prints `1`. Now break the Pod and start a stopwatch. The loop asks the node every 0.25 s whether the rule is still there:

```bash
kubectl exec $POD -- rm /tmp/w/index.html
START=$(date +%s.%N)
until [ "$(docker exec cnlab-vol5-worker2 sh -c "iptables-save -t nat | grep -c 'to-destination $IP:8080'")" = 0 ]; do sleep 0.25; done
echo "rule gone after $(echo "$(date +%s.%N) - $START" | bc -l) s"
```

Then look at what the API says about the Pod and its endpoint:

```bash
kubectl get endpointslices -l kubernetes.io/service-name=web -o jsonpath='{range .items[0].endpoints[*]}{.addresses[0]} ready={.conditions.ready}{"\n"}{end}'
kubectl get pods -l app=web
```

In the first measured run (2026-11-16) the rule disappeared 7.8 seconds after the file was deleted; a replay on 2026-11-17 measured 5.7 seconds. The output below is the first run:

```text
rule gone after 7.755143865 s
10.244.2.40 ready=true
10.244.1.31 ready=true
10.244.2.41 ready=false
NAME                   READY   STATUS    RESTARTS   AGE
web-749fb7cfc9-dchq8   0/1     Running   0          2m15s
web-749fb7cfc9-r4qrd   1/1     Running   0          2m15s
web-749fb7cfc9-sr69q   1/1     Running   0          2m15s
```

The Pod is `Running`, has no restarts, and is `0/1` ready. The theory chapter plots this run as a timeline. Treat your own number as one sample: the first failed probe can come up to 2 seconds after the delete. Put the file back and the Pod rejoins within a few seconds. Then delete a whole Pod, as a rollout would:

```bash
kubectl exec $POD -- sh -c 'echo $HOSTNAME > /tmp/w/index.html'
kubectl get pods -l app=web
kubectl delete pod $POD
kubectl get pods -l app=web -o wide
kubectl get endpoints web
```

After the second `get` the replacement has a new name and a new IP, and the `Endpoints` list shows the new address. The Service IP did not change.

1. The Pod was `Running` and never restarted. Why did it stop receiving traffic, and which field of the EndpointSlice changed?
2. Name the three components that acted between the failed probe and the missing rule, in order.
3. The probe period is 2 s and `failureThreshold` is 3, which is up to 6 s of failures. Where could the rest of your time go?
4. What does a client see during those seconds? Name two things a client or a Pod can do so that users do not notice.
5. After `kubectl delete pod`, which objects changed and which stayed the same: the Service, its IP, the EndpointSlice, the `KUBE-SVC` chain, the `KUBE-SEP` chains?

## Part D · DNS: the Corefile, the search path and the query log (40 min)

You will read the settings every Pod gets, read the cluster's DNS configuration, then turn on CoreDNS's query log and watch the search path work. Start with what the kubelet wrote into the client Pod:

```bash
kubectl exec client -- cat /etc/resolv.conf
kubectl exec client -- nslookup web
```

The nameserver is the `kube-dns` Service IP, the search list ends in `cluster.local`, and `ndots:5` is the rule that decides when the list is used. The short name `web` resolves to the Service IP from Part A:

```text
search default.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5
Server:		10.96.0.10
Address:	10.96.0.10:53

** server can't find web.cluster.local: NXDOMAIN

Name:	web.default.svc.cluster.local
Address: 10.96.206.56

** server can't find web.svc.cluster.local: NXDOMAIN
...
command terminated with exit code 1
```

The `busybox` `nslookup` tries the search suffixes itself and prints an NXDOMAIN line for each wrong name, in any order. The answer is the `Name:` and `Address:` pair. It also exits with code 1 here, so `kubectl exec` ends with `command terminated with exit code 1` although the name resolved.

Now read the Corefile. It lives in a ConfigMap, not in the image:

```bash
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}'
```

```text
.:53 {
    errors
    health {
       lameduck 5s
    }
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
       pods insecure
       fallthrough in-addr.arpa ip6.arpa
       ttl 30
    }
    prometheus :9153
    forward . /etc/resolv.conf {
       max_concurrent 1000
    }
    cache 30 {
       disable success cluster.local
       disable denial cluster.local
    }
    loop
    reload
    loadbalance
}
```

Turn on the query log by adding one line, `log`, after `errors`. The pipe below reads the ConfigMap, inserts the line and applies the result; the `reload` plugin picks it up without a restart, which can take up to a minute:

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed 's/^\( *\)errors$/\1errors\n\1log/' | kubectl apply -f -
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | head -4
```

```text
Warning: resource configmaps/coredns is missing the kubectl.kubernetes.io/last-applied-configuration annotation ...
configmap/coredns configured
.:53 {
    errors
    log
    health {
```

The warning is expected: kind created this ConfigMap without `kubectl apply`, and the annotation is patched in automatically. The pattern `^\( *\)errors$` keeps whatever indentation the line has. Inside the YAML the Corefile is indented by four more spaces, so a pattern with exactly four spaces matches nothing. `kubectl` would still print `configmap/coredns configured`, because it adds the annotation, and no `log` line would appear. The first version of this lab had that mistake, and the log stayed empty. Now wait about a minute for the `reload` plugin (we waited 70 s) before you look at the log.

Now look up three names and read the log after each. `wget` uses the Pod's own resolver, which applies the search list, so it shows the suffixes being tried. A name that ends in a dot is complete, so `nslookup example.com.` tries no suffix. Every lookup sends an A and an AAAA query, so each name appears twice. The lines come from two CoreDNS replicas, and `logs -l` prints one replica after the other, so the order inside a block is not time order. Wait 20 s between the pairs, so that the `--since=15s` window holds one lookup:

```bash
kubectl exec client -- wget -q -O /dev/null http://example.com
kubectl -n kube-system logs -l k8s-app=kube-dns --since=15s | grep example.com
kubectl exec client -- wget -q -O /dev/null http://web.default
kubectl -n kube-system logs -l k8s-app=kube-dns --since=15s | grep web.default
kubectl exec client -- nslookup example.com.
kubectl -n kube-system logs -l k8s-app=kube-dns --since=15s | grep example.com
```

Real output of the replay on 2026-11-18, one block per pair, shortened to the query name and the answer:

```text
"AAAA IN example.com.cluster.local. udp 43 false 512" NXDOMAIN qr,aa,rd 136 0.000351755s
"A IN example.com.cluster.local. udp 43 false 512" NXDOMAIN qr,aa,rd 136 0.000523549s
"AAAA IN example.com.default.svc.cluster.local. udp 55 false 512" NXDOMAIN qr,aa,rd 148 0.000302446s
"A IN example.com.default.svc.cluster.local. udp 55 false 512" NXDOMAIN qr,aa,rd 148 0.000398205s
"AAAA IN example.com.svc.cluster.local. udp 47 false 512" NXDOMAIN qr,aa,rd 140 0.000178445s
"A IN example.com.svc.cluster.local. udp 47 false 512" NXDOMAIN qr,aa,rd 140 0.000314813s
"AAAA IN example.com. udp 29 false 512" NOERROR qr,rd,ra 29 0.004711351s
"A IN example.com. udp 29 false 512" NOERROR qr,rd,ra 83 0.005451201s

"AAAA IN web.default.default.svc.cluster.local. udp 55 false 512" NXDOMAIN qr,aa,rd 148 0.000315848s
"A IN web.default.default.svc.cluster.local. udp 55 false 512" NXDOMAIN qr,aa,rd 148 0.000400133s
"AAAA IN web.default.svc.cluster.local. udp 47 false 512" NOERROR qr,aa,rd 140 0.000191688s
"A IN web.default.svc.cluster.local. udp 47 false 512" NOERROR qr,aa,rd 92 0.000250818s

"AAAA IN example.com. udp 29 false 512" NOERROR qr,rd,ra 29 0.002849496s
"A IN example.com. udp 29 false 512" NOERROR qr,rd,ra 83 0.028525464s
```

Read the blocks. For `example.com`, the Pod's resolver tried three wrong names first, `example.com.cluster.local.`, `example.com.default.svc.cluster.local.` and `example.com.svc.cluster.local.`. The cluster plugin answered each with `NXDOMAIN` in well under a millisecond. Only the fourth name, `example.com.`, went out of the cluster. For `web.default` it needed one wrong guess, `web.default.default.svc.cluster.local.`, before `web.default.svc.cluster.local.` answered `NOERROR`. In the last block the trailing dot made `nslookup` send one query and no suffix. Notice the times at the end of each line: in-cluster answers took about 0.2 to 0.6 ms, while the external `example.com.` answers took 3 to 30 ms in most of our runs (once 170 ms), because they left the cluster. The theory chapter draws the same lines as a diagram.

**Why not `nslookup web.default`?** busybox `nslookup` does not use the search list for a name that contains a dot. In the replays, `kubectl exec client -- nslookup web.default` printed `** server can't find web.default: NXDOMAIN` and exited with code 1, and so did `nslookup kubernetes.default`. The CoreDNS log shows why. The only queries were `web.default.` and `kubernetes.default.`, sent as written, forwarded to the upstream resolver and answered `NXDOMAIN` after 50 to 250 ms. The Service exists. `wget http://web.default` finds it because `wget` uses the libc resolver, which applies the search list. With `nslookup`, use the full name `web.default.svc.cluster.local`, or a name without a dot such as `web`.

1. `example.com` (looked up with wget) has one dot and `ndots` is 5. Which name did CoreDNS see first, and why was it not `example.com.`?
2. `web.default` (looked up with wget) has one dot. Which suffix finally made it resolve? How many wrong names were tried first?
3. Where would you put a lower `ndots` for one workload only: in the Corefile, in the Pod's `resolv.conf`, or in the Pod spec? Which field?
4. Which plugin answered `web.default.svc.cluster.local.` and which one answered `example.com.`?

## Part E · ConfigMaps, Secrets and the NodePort (50 min)

You will give one Pod the same ConfigMap key twice, as an environment variable and as a file, change the ConfigMap, and see which copy follows. Then you will read a Secret the way an attacker with access to etcd would. Save this as `config-demo.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: demo-config
data:
  LOG_LEVEL: info
  app.properties: |
    poll_seconds=1
    region=eu
---
apiVersion: v1
kind: Secret
metadata:
  name: demo-secret
type: Opaque
stringData:
  DB_PASSWORD: s3cr3t-value
---
apiVersion: v1
kind: Pod
metadata:
  name: config-demo
spec:
  terminationGracePeriodSeconds: 1
  containers:
    - name: c
      image: wallet:v1
      command: ["sleep", "3600"]
      env:
        - name: LOG_LEVEL            # copied once, when the container starts
          valueFrom:
            configMapKeyRef:
              name: demo-config
              key: LOG_LEVEL
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: demo-secret
              key: DB_PASSWORD
      volumeMounts:
        - name: cfg                  # files; the kubelet refreshes them
          mountPath: /etc/demo
        - name: sec
          mountPath: /etc/secret
          readOnly: true
  volumes:
    - name: cfg
      configMap:
        name: demo-config
    - name: sec
      secret:
        secretName: demo-secret
```

```bash
kubectl apply -f config-demo.yaml
kubectl wait --for=condition=Ready pod/config-demo --timeout=60s
kubectl exec config-demo -- sh -c 'env | grep LOG_LEVEL; cat /etc/demo/app.properties'
kubectl exec config-demo -- ls -la /etc/secret
```

The environment variable and the file agree. The mounted directory is a set of symlinks into a timestamped directory:

```text
LOG_LEVEL=info
poll_seconds=1
region=eu
total 4
drwxrwxrwt 3 root root  100 Nov 16 07:43 .
drwxr-xr-x 1 root root 4096 Nov 16 07:43 ..
drwxr-xr-x 2 root root   60 Nov 16 07:43 ..2026_11_16_07_43_50.3455029277
lrwxrwxrwx 1 root root   32 Nov 16 07:43 ..data -> ..2026_11_16_07_43_50.3455029277
lrwxrwxrwx 1 root root   18 Nov 16 07:43 DB_PASSWORD -> ..data/DB_PASSWORD
```

**Base64 is not encryption.** Read the Secret from the API, decode it, then read the stored bytes from etcd. The etcd command runs inside the etcd Pod with the three certificate flags from Lab 5.1; `grep -a -o` pulls out the plain text from the binary:

```bash
kubectl get secret demo-secret -o jsonpath='{.data.DB_PASSWORD}'
kubectl get secret demo-secret -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
kubectl -n kube-system exec etcd-cnlab-vol5-control-plane -- etcdctl \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/default/demo-secret | grep -a -o s3cr3t-value | sort | uniq -c
```

```text
czNjcjN0LXZhbHVl
s3cr3t-value
      2 s3cr3t-value
```

The value is in etcd twice: once as data and once inside the `last-applied-configuration` annotation that `kubectl apply` added. Now change the ConfigMap and time how long the file takes to follow:

```bash
kubectl patch configmap demo-config --type merge -p '{"data":{"LOG_LEVEL":"debug"}}'
S=$(date +%s); until kubectl exec config-demo -- grep -q debug /etc/demo/LOG_LEVEL; do sleep 2; done; echo "file changed after $(( $(date +%s) - S )) s"
kubectl exec config-demo -- sh -c 'cat /etc/demo/LOG_LEVEL; echo; env | grep LOG_LEVEL'
```

In the measured run the file changed after 68 seconds (71 seconds in the 2026-11-17 replay). The environment variable did not change at all:

```text
file changed after 68 s
debug
LOG_LEVEL=info
```

Finally, open the second entrance. Turn the Service into a `NodePort` and call it from one node to another:

```bash
kubectl patch svc web -p '{"spec":{"type":"NodePort"}}'
NP=$(kubectl get svc web -o jsonpath='{.spec.ports[0].nodePort}')
W2=$(kubectl get node cnlab-vol5-worker2 -o jsonpath='{.status.addresses[?(@.type=="InternalIP")].address}')
docker exec cnlab-vol5-control-plane curl -s http://$W2:$NP/
docker exec cnlab-vol5-worker2 iptables -t nat -S KUBE-NODEPORTS
docker exec cnlab-vol5-worker2 iptables -t nat -S | grep KUBE-EXT
```

The request returns a Pod name (`web-749fb7cfc9-r4qrd` in the measured run, with node port 30385). The chains show where the second entrance joins the first:

```text
-N KUBE-NODEPORTS
-A KUBE-NODEPORTS -d 127.0.0.0/8 -p tcp -m comment --comment "default/web:http" -m tcp --dport 30385 -m nfacct --nfacct-name  localhost_nps_accepted_pkts -j KUBE-EXT-CDGGSHYLG3RE2FKL
-A KUBE-NODEPORTS -p tcp -m comment --comment "default/web:http" -m tcp --dport 30385 -j KUBE-EXT-CDGGSHYLG3RE2FKL
-N KUBE-EXT-CDGGSHYLG3RE2FKL
-A KUBE-EXT-CDGGSHYLG3RE2FKL -m comment --comment "masquerade traffic for default/web:http external destinations" -j KUBE-MARK-MASQ
-A KUBE-EXT-CDGGSHYLG3RE2FKL -j KUBE-SVC-CDGGSHYLG3RE2FKL
```

1. The file changed and the variable did not. Which one would you use for a setting that must change without a restart, and what must your program then do?
2. Which of the two copies of the password in etcd would still exist if you created the Secret with `kubectl create secret` instead of `kubectl apply`? Why?
3. The `KUBE-EXT` chain ends by jumping to the same `KUBE-SVC` chain as in Part B. What does that say about how many load-balancing algorithms there are?
4. Why does the first `KUBE-EXT` rule mark the packet for masquerade? What does the backend Pod then see as the source address?

## Checkpoint

You are done when all of these hold. Save your commands and outputs, and your answers to the questions in Parts A to E, in `lab-5.3.md`.

| Check | Expected |
| --- | --- |
| `kubectl get endpointslices -l kubernetes.io/service-name=web` | one slice, `IPv4`, port `8080`, three comma-separated Pod IPs |
| `docker exec cnlab-vol5-worker iptables -t nat -S \| grep -c 'default/web:http ->'` | `3`, one rule per endpoint |
| the 300-request command from Part B, ending in `sort \| uniq -c` | three lines, one per Pod, whose counts add up to 300 |
| the stopwatch loop from Part C | `rule gone after ... s`, and the Pod shows `0/1` while `Running` |
| `kubectl exec client -- nslookup web.default.svc.cluster.local` | an `Address` equal to the `CLUSTER-IP` of `kubectl get svc web` |
| the CoreDNS log after `kubectl exec client -- wget -q -O /dev/null http://example.com` | three `NXDOMAIN` lines for `example.com.cluster.local.`, `example.com.default.svc.cluster.local.` and `example.com.svc.cluster.local.`, then a `NOERROR` line for `example.com.` |
| `kubectl exec config-demo -- sh -c 'cat /etc/demo/LOG_LEVEL; echo; env \| grep LOG_LEVEL'` after the patch | `debug`, then `LOG_LEVEL=info` |
| `kubectl get secret demo-secret -o jsonpath='{.data.DB_PASSWORD}' \| base64 -d` | `s3cr3t-value` |
| the `etcdctl ... \| grep -a -o s3cr3t-value \| sort \| uniq -c` command | `2 s3cr3t-value` |
| `docker exec cnlab-vol5-control-plane curl -s http://<worker2 IP>:<node port>/` | the name of one web Pod |
| Notebook | Answers to the questions in Parts A to E and Break it, with your own timings from Parts C and E |

## Break it: the Service that selects nothing

One wrong letter in a selector is the most common Service bug. Make it:

```bash
kubectl patch svc web -p '{"spec":{"selector":{"app":"wbe"}}}'
kubectl get endpointslices -l kubernetes.io/service-name=web
kubectl exec client -- wget -q -T 3 -O - http://web; echo exit=$?
docker exec cnlab-vol5-worker iptables-save | grep 'has no endpoints'
```

The three web Pods are still running and ready, but the slice is empty, the client is refused at once, and the node holds rejecting rules (one for the ClusterIP and, because Part E made the Service a NodePort, one for the node port):

```text
NAME        ADDRESSTYPE   PORTS     ENDPOINTS   AGE
web-k4j29   IPv4          <unset>   <unset>     5m
wget: can't connect to remote host (10.96.206.56): Connection refused
command terminated with exit code 1
exit=1
-A KUBE-EXTERNAL-SERVICES -p tcp -m comment --comment "default/web:http has no endpoints" -m addrtype --dst-type LOCAL -m tcp --dport 30385 -j REJECT --reject-with icmp-port-unreachable
-A KUBE-SERVICES -d 10.96.206.56/32 -p tcp -m comment --comment "default/web:http has no endpoints" -m tcp --dport 80 -j REJECT --reject-with icmp-port-unreachable
```

1. The client failed at once instead of waiting for a timeout. Which line above explains that?
2. All three Pods are Ready. Why is the slice empty? Name the object that wrote the slice and the field it compared.
3. Write the three commands, in order, that you would run to find this fault on a Service you have never seen. Use `kubectl get endpointslices`, `kubectl describe svc web` and `kubectl get pods --show-labels`.
4. Repair the Service with another `kubectl patch` and show that the client gets a Pod name again. How long did the rules take to follow the repair?
