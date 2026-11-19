# CoreDNS and cluster add-ons

## What and why

Pod IPs change, so apps find each other by name. **CoreDNS** is the cluster's DNS server: a Deployment of ordinary Pods, behind a Service named `kube-dns`, that answers cluster names from the Services and Pods in the API and forwards everything else to an upstream resolver. The kubelet writes every Pod's `/etc/resolv.conf` with the `kube-dns` Service IP and a search path, so a Pod can look up `db` and reach `db.<namespace>.svc.cluster.local`.

CoreDNS is one of the **add-ons**: components the cluster needs that run as Pods rather than as part of the control plane binaries. kube-proxy, the CNI plug-in and metrics-server are others. Its behaviour is set in the `coredns` ConfigMap (the Corefile).

## Diagram

{{diagram coredns-and-cluster-add-ons-01.jsx | In-cluster DNS lookup · 4 hops}}
Every Pod's resolver points at the kube-dns Service; CoreDNS answers cluster names from Services and forwards the rest.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). CoreDNS comes with the cluster; look at it and use it from a Pod:

```
$ kubectl -n kube-system get deploy,svc -l k8s-app=kube-dns
NAME                      READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/coredns   2/2     2            2           12m
NAME               TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)                  AGE
service/kube-dns   ClusterIP   10.96.0.10   <none>        53/UDP,53/TCP,9153/TCP   12m
$ kubectl -n kube-system get cm coredns -o jsonpath='{.data.Corefile}'
.:53 {
    errors
    health { lameduck 5s }
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
       pods insecure
       fallthrough in-addr.arpa ip6.arpa
       ttl 30
    }
    prometheus :9153
    forward . /etc/resolv.conf { max_concurrent 1000 }
    cache 30 { disable success cluster.local
               disable denial cluster.local }
    loop
    reload
    loadbalance
}
$ kubectl exec dns -- cat /etc/resolv.conf
search x5.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5
$ kubectl exec dns -- getent hosts dnsweb dnsweb.x5 dnsweb.x5.svc.cluster.local
10.96.71.91   dnsweb.x5.svc.cluster.local ...      (all three names give the Service ClusterIP)
```

The `nameserver` is the `kube-dns` Service IP; the search path (`x5.svc.cluster.local` first) lets a short name reach a Service in the Pod's own namespace.

## Key fields

CoreDNS is configured by the Corefile in the `coredns` ConfigMap (the `kubeadm` default shown above). Meanings of the plug-ins are from the CoreDNS documentation and were not re-checked in this session.

| Setting | Meaning | Value in kind |
| --- | --- | --- |
| `kubernetes cluster.local ...` | Answer cluster names from Services (and Pods) in the API | zone `cluster.local`, `ttl 30` |
| `forward . /etc/resolv.conf` | Send other names to the node's upstream resolver | `max_concurrent 1000` |
| `cache 30` | A frontend cache: keeps answers for up to 30 s (the number only caps each record's own TTL, and it covers every zone in the server block, `cluster.local` included) | 30 |
| `health`, `ready`, `prometheus :9153` | Liveness, readiness and metrics endpoints | on |
| `loop`, `reload`, `loadbalance` | `loop` halts CoreDNS when it detects a forwarding loop; `reload` re-reads a changed Corefile (checked every 30 s by default, plus jitter); `loadbalance` randomizes the order of A, AAAA and MX records in an answer | on |
| kubelet `clusterDNS` / `clusterDomain` | What goes into every Pod's resolv.conf | `10.96.0.10`, `cluster.local` |
| Pod `spec.dnsPolicy` | Which resolver config a Pod gets | `ClusterFirst` |
| resolv.conf `options ndots:5` | Names with fewer than 5 dots are tried with the search path first | 5 |

Plugin meanings were checked on 2026-11-17 against [Customizing DNS Service](https://kubernetes.io/docs/tasks/administer-cluster/dns-custom-nameservers/) and the CoreDNS plugin pages for [cache](https://coredns.io/plugins/cache/), [loop](https://coredns.io/plugins/loop/), [reload](https://coredns.io/plugins/reload/) and [loadbalance](https://coredns.io/plugins/loadbalance/). The `kubernetes` plugin answers with a default TTL of 5 s unless `ttl` is set; kubeadm sets 30.

## kubectl

```
kubectl -n kube-system get deploy,pods,svc -l k8s-app=kube-dns
kubectl -n kube-system get cm coredns -o jsonpath='{.data.Corefile}'
kubectl -n kube-system logs -l k8s-app=kube-dns             # not run: errors and queries if the log plug-in is on
kubectl exec <pod> -- cat /etc/resolv.conf
kubectl exec <pod> -- nslookup kubernetes.default.svc.cluster.local      # use the full name with busybox nslookup
kubectl exec <pod> -- getent hosts <name>                   # resolves like an application does (uses the search path)
kubectl -n kube-system get endpointslice -l kubernetes.io/service-name=kube-dns   # are there backends?
kubectl -n kube-system rollout restart deploy/coredns       # not run: reload after a Corefile edit
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| With CoreDNS scaled to 0: `;; connection timed out; no servers could be reached`, `nslookup: write to '10.96.0.10': Connection refused`, `wget: bad address 'dnsweb'` while `wget` to the Service's ClusterIP still returned the page; `kube-dns` EndpointSlice shows `ENDPOINTS <unset>` | No CoreDNS Pod is ready, so names cannot be resolved; IP traffic is unaffected | `kubectl -n kube-system scale deploy coredns --replicas=2`; check the Pods and the `kube-dns` endpoints |
| `** server can't find nope.x5.svc.cluster.local: NXDOMAIN` | The name does not exist: no such Service in that namespace (or a typo) | `kubectl get svc -A`; use `<service>.<namespace>` for another namespace |
| `** server can't find kubernetes.default: NXDOMAIN` from busybox `nslookup`, while `nslookup kubernetes.default.svc.cluster.local` and `getent hosts kubernetes.default` both resolve | The tool, not the cluster: busybox `nslookup` does not apply the search path the way applications do | Test with the full name or with `getent hosts`; do not conclude DNS is broken from a short-name `nslookup` |

## Related

- **Cards:** DNS for Services and Pods, Service and EndpointSlice (group 4); kube-proxy; ConfigMap (group 5); Metrics API and metrics-server (group 8).
- **Chapter and lab:** Chapter 5.3 and Lab 5.3 (Vol 5).
- **Exam domain:** CKA Services and Networking: CoreDNS.
