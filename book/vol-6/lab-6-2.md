# Lab 6.2 · Gateway API and Linkerd mTLS

**Goal.** Let traffic into the wallet through one Gateway and encrypt the traffic between its Pods with Linkerd, while the default-deny policies of Lab 6.1 stay in force. You will meet the two places where a mesh and a policy collide, and read both in Hubble. Time: about 3 hours.

**Versions tested** (run on 2026-11-17): continues on the cluster of Lab 6.1 (Kubernetes 1.37.0, Cilium 1.20.4 upgraded in place with Helm). Gateway API CRDs v1.6.3, standard channel. Linkerd edge-26.11.2 (Helm charts `linkerd-crds`, `linkerd-control-plane` and `linkerd2-cni`, all 2026.11.2; CNI plugin image v1.7.1). OpenSSL 3.5.5 for the certificates. Not run here: Istio (project card only), a Gateway with TLS, a cloud LoadBalancer. Why the CNI-plugin install of Linkerd: Lab 6.3 enforces the `restricted` Pod Security level, and the sidecar's usual init container needs privileges that level forbids.

### What you will build

{{diagram lab-6-2-01.jsx | Lab 6.2 · what you will build}}

## Part A · A Gateway in front of the wallet

Gateway API is a set of CRDs, so install them first and in the version Cilium documents (v1.6.3 for Cilium 1.20.4). The standard channel is enough.

```bash
for c in gatewayclasses gateways httproutes referencegrants grpcroutes backendtlspolicies tlsroutes; do
  kubectl apply --server-side -f https://raw.githubusercontent.com/kubernetes-sigs/gateway-api/v1.6.3/config/crd/standard/gateway.networking.k8s.io_$c.yaml
done
kubectl get crd | grep gateway.networking
```

```text
backendtlspolicies.gateway.networking.k8s.io   Namespaced   v1(storage)
gatewayclasses.gateway.networking.k8s.io       Cluster      v1(storage),v1beta1
gateways.gateway.networking.k8s.io             Namespaced   v1(storage),v1beta1
grpcroutes.gateway.networking.k8s.io           Namespaced   v1(storage)
httproutes.gateway.networking.k8s.io           Namespaced   v1(storage),v1beta1
referencegrants.gateway.networking.k8s.io      Namespaced   v1,v1beta1(storage)
tlsroutes.gateway.networking.k8s.io            Namespaced   v1(storage)
```

Now tell Cilium to serve Gateways. Three settings go into a second values file, and each has a reason in its comment. The second and third are for Linkerd in Part B; setting them now means Cilium restarts once.

```yaml
# cilium-values-62.yaml
gatewayAPI:
  enabled: true
  hostNetwork: {enabled: true}     # Envoy listens on port 80 of every node (no LoadBalancer on kind)
socketLB:
  hostNamespaceOnly: true          # Linkerd needs to see the Service IP (Linkerd docs, cluster configuration)
cni:
  exclusive: false                 # let the Linkerd CNI plugin chain after Cilium
```

```bash
helm upgrade cilium cilium/cilium --version 1.20.4 -n kube-system --reuse-values -f cilium-values-62.yaml
kubectl -n kube-system rollout restart deploy/cilium-operator ds/cilium
kubectl -n kube-system rollout status ds/cilium --timeout=300s
kubectl get gatewayclass
```

```text
NAME     CONTROLLER                     ACCEPTED   AGE
cilium   io.cilium/gateway-controller   True       53s
```

The `GatewayClass` named `cilium` appeared by itself: the installer of a provider owns that object (the infrastructure role of the chapter). Now play the cluster operator and the developer. Save this as `gateway.yaml`. The Gateway listens on port 80; the route sends every path to the `wallet-api` Service.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata: {name: wallet, namespace: wallet}
spec:
  gatewayClassName: cilium          # the class that Cilium installed
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      allowedRoutes: {namespaces: {from: Same}}   # only routes from this namespace may attach
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: {name: wallet-api, namespace: wallet}
spec:
  parentRefs: [{name: wallet}]      # attach to the Gateway above
  rules:
    - matches: [{path: {type: PathPrefix, value: /}}]
      backendRefs: [{name: wallet-api, port: 80}]
```

```bash
kubectl apply -f gateway.yaml
kubectl get gatewayclass,gateway,httproute -A
kubectl -n wallet describe gateway wallet | grep -E 'Type:|Status:|Reason:|Message:' | head -12
kubectl -n wallet get httproute wallet-api -o jsonpath='{range .status.parents[0].conditions[*]}{.type}={.status} {.message}{"\n"}{end}'
```

Read the status, not only the existence. `Accepted` says a controller took the Gateway, `Programmed` says its proxy is configured and has an address, and the route's own `Accepted` and `ResolvedRefs` say it attached and that the Service exists. On the test machine the route reported `Accepted=True Accepted HTTPRoute` and `ResolvedRefs=True Service reference is valid`.

Now send a request. Your `kind.yaml` maps port 80 of the worker node to port 8088 on your laptop, and Cilium's Envoy listens on port 80 of every node.

```bash
curl -s -m 3 -o /dev/null -w '%{http_code}\n' http://localhost:8088/healthz
kubectl -n kube-system exec $CIL -c cilium-agent -- hubble observe -n wallet --verdict DROPPED --last 4 --to-port 8080
```

The first answer is `000`: the request timed out. The Gateway exists and is programmed, yet the default-deny policy of Lab 6.1 blocks the last hop from the Gateway's Envoy to the `wallet-api` Pod. On the test cluster, with the Gateway in Service mode, Hubble printed:

```text
10.244.1.203:51320 (ingress) <> wallet/wallet-api-9c46b9f74-9ldnj:8080 (ID:39352) policy-verdict:none INGRESS DENIED (TCP Flags: SYN)
10.244.1.203:51320 (ingress) <> wallet/wallet-api-9c46b9f74-9ldnj:8080 (ID:39352) Policy denied DROPPED (TCP Flags: SYN)
```

The source is not a Pod. Cilium gives the traffic of its own Envoy the reserved identity `ingress`, and a standard NetworkPolicy cannot name a reserved identity. Cilium's own policy kind can: a `CiliumNetworkPolicy` with `fromEntities`. Apply it and repeat the request.

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata: {name: api-from-gateway, namespace: wallet}
spec:
  endpointSelector: {matchLabels: {app: wallet-api}}
  ingress:
    - fromEntities: [ingress]          # Cilium's reserved identity for its Gateway/Ingress Envoy
      toPorts:
        - ports: [{port: "8080", protocol: TCP}]
```

```bash
kubectl apply -f api-from-gateway.yaml
curl -s http://localhost:8088/healthz
curl -s http://localhost:8088/accounts/alice
./test_e2e.sh http://localhost:8088
```

```text
{"status": "ok"}
{"name": "alice", "balance": 70}
```

The `test_e2e.sh` of the wallet must now print `PASS` through the Gateway: that is the entry point of Milestone 6. Measured on the test machine: in Service mode the same `healthz` and `accounts/alice` calls returned HTTP 200 through the Gateway address; after switching to host networking, a `curl` run inside the worker node against the node's port 80 returned `{"status": "ok"}` with this policy in place. The published port `localhost:8088` was not re-run on the final cluster, so if it hangs on your machine, run the same `curl` inside the node (`docker exec cnlab-vol6-worker curl -s localhost/healthz`) and report which of the two works.

Notice that the api is still reachable from `edge-client` through its Service, because `api-from-edge` from Lab 6.1 is still in force: the Gateway added a door, it did not close the old one. Milestone 6 asks you to decide which doors stay and to write the reason in `THREATS.md`.

## Part B · Linkerd: mTLS between the wallet Pods

Linkerd needs two certificates before it starts: a trust anchor (the root every proxy trusts) and an issuer (the intermediate its identity service signs proxy certificates with). The Helm charts take them as values, so make them with OpenSSL. Both are ECDSA P-256; the anchor must be a CA, and the issuer a CA with path length 0.

```bash
mkdir -p ~/cn-lab/vol6/mesh/pki && cd ~/cn-lab/vol6/mesh/pki
openssl ecparam -name prime256v1 -genkey -noout -out ca.key
openssl req -x509 -new -key ca.key -sha256 -days 365 -subj "/CN=root.linkerd.cluster.local" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out ca.crt
openssl ecparam -name prime256v1 -genkey -noout -out issuer.key
openssl req -new -key issuer.key -subj "/CN=identity.linkerd.cluster.local" -out issuer.csr
printf 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n' > ext.cnf
openssl x509 -req -in issuer.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 365 -sha256 -extfile ext.cnf -out issuer.crt
openssl verify -CAfile ca.crt issuer.crt
```

```text
issuer.crt: OK
```

These keys are lab material with a 365-day life; the In production table of the chapter explains why the dates matter. Keep them out of Git (Milestone 6 greps your history for `BEGIN`). Now install three charts: the CNI plugin, the CRDs and the control plane. Linkerd's open-source project publishes edge releases only, so pin the exact chart version.

```bash
helm repo add linkerd-edge https://helm.linkerd.io/edge
helm install linkerd-cni linkerd-edge/linkerd2-cni --version 2026.11.2 -n linkerd-cni --create-namespace
# wait until the plug-in has chained itself into every node's CNI config
kubectl -n linkerd-cni rollout status ds/linkerd-cni --timeout=180s
for n in $(kind get nodes --name cnlab-vol6); do
  until docker exec "$n" grep -rqs linkerd-cni /etc/cni/net.d/; do sleep 2; done; done
helm install linkerd-crds linkerd-edge/linkerd-crds --version 2026.11.2 -n linkerd --create-namespace --set cniEnabled=true
helm install linkerd-control-plane linkerd-edge/linkerd-control-plane --version 2026.11.2 -n linkerd --set cniEnabled=true \
  --set-file identityTrustAnchorsPEM=ca.crt --set-file identity.issuer.tls.crtPEM=issuer.crt --set-file identity.issuer.tls.keyPEM=issuer.key
kubectl -n linkerd rollout status deploy --timeout=300s
kubectl -n linkerd-cni get pods; kubectl -n linkerd get pods
docker exec cnlab-vol6-worker ls /etc/cni/net.d
docker exec cnlab-vol6-worker sed -n '1,22p' /etc/cni/net.d/05-cilium.conflist
```

**Why the wait matters.** The CNI configuration is read once, when a Pod's network is set up. A Linkerd Pod that starts before `linkerd-cni` has chained itself after Cilium gets no traffic redirection, and its `linkerd-network-validator` init container fails with `Failed to validate networking configuration` and crash-loops (seen on the test machine on 2026-11-17). If that happens, the fix is `kubectl -n linkerd delete pod --all`: the new Pods start with the chained configuration.

```text
linkerd-cni-6t76g   1/1   Running   0   58s
linkerd-cni-s8hnz   1/1   Running   0   59s
linkerd-destination-7cc6dd9968-6zxhk      4/4   Running   0   48s
linkerd-identity-5c9ffc445f-8n8cj         2/2   Running   0   48s
linkerd-proxy-injector-66477d9974-vff9m   2/2   Running   0   48s
05-cilium.conflist
ZZZ-linkerd-cni-kubeconfig
{ "cniVersion": "1.0.0", "name": "cilium", "plugins": [
    { "type": "cilium-cni", ... },
    { "type": "linkerd-cni", "incoming-proxy-port": 4143, "inbound-ports-to-ignore": ["4191","4190"], "iptables-mode": "nft", ... } ] }
```

Look at the last lines: the CNI file of Part B in Lab 6.1 had one plugin, and now it has two. This is CNI chaining, the plugin list of the contract in Ch 6.1 part 1: the runtime runs `cilium-cni` first, then `linkerd-cni`, which writes the iptables rules that send a Pod's traffic through its proxy. That is why no privileged init container is needed.

Now mesh the wallet. The proxy is injected when a Pod is created, so annotate the namespace and restart everything in it.

```bash
kubectl annotate ns wallet linkerd.io/inject=enabled
kubectl rollout restart deploy -n wallet; kubectl rollout restart sts postgres -n wallet
kubectl get pods -n wallet
```

```text
NAME                           READY   STATUS     RESTARTS   AGE
postgres-0                     0/2     Init:1/2   0          45s
wallet-api-656467d8c5-ggvsm    0/2     Init:1/2   0          47s
wallet-worker-6998777d78-2cv4f 0/2     Init:1/2   0          47s
```

The new Pods are stuck. The default-deny policy is the reason: a proxy must reach Linkerd's identity service to get its certificate before it reports ready, and egress from the `wallet` namespace is denied. Ask Hubble, which names the destination.

```bash
kubectl -n kube-system exec $CIL -c cilium-agent -- hubble observe -n wallet --verdict DROPPED --last 6
```

```text
wallet/postgres-0:43924 (ID:50541) <> linkerd/linkerd-identity-5c9ffc445f-8n8cj:8080 (ID:3873) Policy denied DROPPED (TCP Flags: SYN)
wallet/wallet-worker-6998777d78-2cv4f:51034 (ID:49566) <> linkerd/linkerd-identity-5c9ffc445f-8n8cj:8080 (ID:3873) Policy denied DROPPED (TCP Flags: SYN)
```

Allow the proxies to reach the three control-plane ports (identity 8080, destination 8086, policy controller 8090). This is the first of the two collisions between a mesh and a policy.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: allow-linkerd, namespace: wallet}
spec:
  podSelector: {}                 # every proxy in the namespace needs the control plane
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector: {matchLabels: {kubernetes.io/metadata.name: linkerd}}
      ports:
        - {protocol: TCP, port: 8080}   # identity: signs the proxy's certificate
        - {protocol: TCP, port: 8086}   # destination: service discovery
        - {protocol: TCP, port: 8090}   # policy controller
```

```bash
kubectl apply -f allow-linkerd.yaml
kubectl -n wallet rollout status deploy/wallet-api deploy/wallet-worker sts/postgres --timeout=300s
kubectl get pods -n wallet
kubectl -n kube-system exec $CIL -c cilium-agent -- hubble observe -n wallet --verdict DROPPED --last 30 | grep -v policy-verdict | awk '{ $1=""; $2=""; print }' | sort | uniq -c | sort -rn | head -3
```

```text
NAME                           READY   STATUS    RESTARTS   AGE
postgres-0                     2/2     Running   0          3m59s
wallet-api-656467d8c5-ggvsm    1/2     Running   3          4m1s
wallet-worker-6998777d78-2cv4f 2/2     Running   2          4m1s

1 wallet/wallet-api-656467d8c5-ggvsm:40126 (ID:45778) <> wallet/postgres-0:4143 (ID:50541) Policy denied DROPPED (TCP Flags: SYN)
1 wallet/wallet-worker-6998777d78-2cv4f:54280 (ID:49566) <> wallet/postgres-0:4143 (ID:50541) Policy denied DROPPED (TCP Flags: SYN)
```

Postgres and the worker are up, but the api container keeps restarting. Hubble names a new victim: a connection from `wallet-api` to `postgres-0` on **port 4143**, not 5432. This is the second collision, and the one most teams meet: a meshed client does not connect to the server's port 5432. Its proxy connects to the server's proxy on port 4143 (the `incoming-proxy-port` in the CNI file), and your NetworkPolicy allows only 5432. A policy that selects ports must now allow the proxy port too.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: allow-mesh-port, namespace: wallet}
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
  ingress:
    - from: [{podSelector: {}}]          # a meshed client talks to the server's proxy port
      ports: [{protocol: TCP, port: 4143}]
  egress:
    - to: [{podSelector: {}}]
      ports: [{protocol: TCP, port: 4143}]
```

```bash
kubectl apply -f allow-mesh-port.yaml
kubectl get pods -n wallet
```

```text
NAME                           READY   STATUS    RESTARTS   AGE
postgres-0                     2/2     Running   0          6m8s
wallet-api-656467d8c5-7fhfq    2/2     Running   0          48s
wallet-api-656467d8c5-ggvsm    2/2     Running   4          6m10s
wallet-worker-6998777d78-2cv4f 2/2     Running   3          6m10s
```

All wallet Pods are `2/2`. Now prove that the connection to Postgres is encrypted, with the proxy's own counters. The proxy exposes metrics on port 4191; forward it and read the counter of opened TCP connections, which carries a `tls` label.

```bash
P=$(kubectl -n wallet get pod -l app=wallet-api -o name | head -1)
kubectl -n wallet port-forward $P 4191:4191 &
curl -s localhost:4191/metrics | grep '^tcp_open_total' | grep 'tls="true"' | sed -E 's/.*(direction="[a-z]+").*(target_port="[0-9]+").*(tls="true").*(dst_pod="[^"]+").*\} ([0-9]+)$/\1 \2 \3 \4 count=\5/'
kill %1
```

```text
direction="outbound" target_port="5432" tls="true" dst_pod="postgres-0" count=33
```

Thirty-three outbound connections to `postgres-0:5432`, all `tls="true"`, with the server identity `default.wallet.serviceaccount.identity.linkerd.cluster.local` (the ServiceAccount `default` in namespace `wallet`) in the same line. The inbound lines in the same output show `tls="no_identity"` with `no_tls_reason="no_tls_from_remote"`: clients that are not meshed, such as the Gateway's Envoy and the kubelet's probes, reach the api in plain text. A mesh encrypts only between meshed Pods, as the chapter said.

## Checkpoint

| # | Command | Expected output |
| --- | --- | --- |
| 1 | `kubectl get gatewayclass` | `cilium` with `ACCEPTED True` |
| 2 | `kubectl get gateway -n wallet` | `wallet` with `PROGRAMMED True` and the node addresses |
| 3 | `curl -s http://localhost:8088/healthz` | `{"status": "ok"}` (the block with `docker exec` of Part A if the published port does not answer) |
| 4 | `kubectl get pods -n wallet` | every Pod `2/2` |
| 5 | the metrics command of Part B | a line with `target_port="5432"`, `tls="true"` and `dst_pod="postgres-0"` |
| 6 | `kubectl -n kube-system exec $CIL -c cilium-agent -- hubble observe -n wallet --since 1m --verdict DROPPED --to-port 4143` | no output when the Pods have been settled for a minute: nothing is dropped on the proxy port |
| 7 | `kubectl get netpol,ciliumnetworkpolicy -n wallet` | seven NetworkPolicies and `api-from-gateway` |

## Break it

The mesh and the policy meet at port 4143. Predict what happens when you remove the rule for it, then do it.

```bash
kubectl -n wallet delete netpol allow-mesh-port
P=$(kubectl -n wallet get pod -l app=wallet-api -o name | head -1)
kubectl -n wallet exec $P -c api -- python3 -c "import os,psycopg; psycopg.connect(os.environ['DATABASE_URL'],connect_timeout=3)"
kubectl -n kube-system exec $CIL -c cilium-agent -- hubble observe -n wallet --verdict DROPPED --last 6 | grep -v policy-verdict | tail -2
```

```text
FAILED: connection failed: connection to server at "10.244.1.66", port 5432 failed: server closed the connection unexpectedly
wallet/wallet-api-6b9d4c8b56-jm52v:34236 (ID:1005) <> wallet/postgres-0:4143 (ID:27363) Policy denied DROPPED (TCP Flags: ACK, FIN, PSH)
wallet/wallet-worker-85c56946ff-6c2f5:33438 (ID:25259) <> wallet/postgres-0:4143 (ID:27363) Policy denied DROPPED (TCP Flags: ACK)
```

The application error talks about port 5432 and a closed connection, but the drop is on 4143. This is the lesson: with a mesh, the port in the NetworkPolicy is no longer the port in your code. Restore it with `kubectl apply -f allow-mesh-port.yaml`.

A second thing to try, because the chapter calls it out: scale the wallet-api Deployment up by one and look at its `READY` column. Pods created after the namespace annotation are injected at once; Pods that existed before it were not, and only a restart gave them a proxy.
