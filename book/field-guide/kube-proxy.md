# kube-proxy

## What and why

Pods come and go and change IP addresses, so clients need a stable address that always reaches a healthy Pod. A Service gives a stable virtual IP (ClusterIP); **kube-proxy** makes it work. It maintains network rules on nodes to implement Services ([components overview](https://kubernetes.io/docs/concepts/overview/components/)): it runs on every node, watches Services and EndpointSlices, and programs the node's kernel (iptables or nftables rules) to rewrite traffic sent to the ClusterIP so it goes to one of the ready Pods.

Packets never pass through the kube-proxy process; the kernel applies the rules. A Service with no ready Pods gets a rule that rejects connections. Some CNI plug-ins replace kube-proxy entirely, which is why the component is optional.

## Diagram

{{diagram kube-proxy-01.jsx | kube-proxy data path and control path}}
kube-proxy watches Services and EndpointSlices and writes kernel rules on its node; packets then flow client to backend without touching kube-proxy.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0` (kube-proxy v1.37.0), kubectl v1.37.1 (2026-11-16). kube-proxy is a DaemonSet in `kube-system` configured by the `kube-proxy` ConfigMap. Create a Deployment and a Service, then look at the rules kube-proxy wrote on the node:

```
$ kubectl create deploy pxy --image=nginx:1.31.8; kubectl expose deploy pxy --port=80
$ kubectl get svc pxy -o jsonpath='{.spec.clusterIP}'; kubectl get endpointslice -l kubernetes.io/service-name=pxy
10.96.103.11
NAME        ADDRESSTYPE   PORTS   ENDPOINTS     AGE
pxy-n6d5f   IPv4          80      10.244.0.79   4s
$ nx iptables-save -t nat | grep -E 'pxy|KUBE-SERVICES' | head -4          # nx = docker exec <node>
-A PREROUTING -m comment --comment "kubernetes service portals" -j KUBE-SERVICES
-A KUBE-SEP-IBKTUJ7GJTFXTDLN -s 10.244.0.79/32 -m comment --comment "t1/pxy" -j KUBE-MARK-MASQ
-A KUBE-SEP-IBKTUJ7GJTFXTDLN -p tcp -m comment --comment "t1/pxy" -m tcp -j DNAT --to-destination 10.244.0.79:80
$ kubectl exec client -- wget -qO- -T 3 http://pxy | head -3
<!DOCTYPE html>
<html>
<head>
```

The Service name `pxy` resolves to the ClusterIP; the `KUBE-SEP-...` rule rewrites it (DNAT) to the Pod IP `10.244.0.79:80`. This kind cluster runs kube-proxy in `iptables` mode.

## Key fields

Settings are in the KubeProxyConfiguration inside the `kube-proxy` ConfigMap (`config.conf`). Values are from this cluster.

| Field | Meaning | Value in kind |
| --- | --- | --- |
| `mode` | How Services are implemented: `iptables`, `ipvs` or `nftables` | `iptables` |
| `clusterCIDR` | The Pod network range, used to tell cluster traffic from external | `10.244.0.0/16` |
| `bindAddress` | Address the proxy binds to | `0.0.0.0` |
| `iptables.masqueradeAll` | Source-NAT all traffic through Service IPs | false |
| `nftables.masqueradeAll` | The same for nftables mode | false |
| `metricsBindAddress` | Where metrics are served | empty (default) |

The valid `mode` names are `iptables`, `ipvs` and `nftables` on Linux and `kernelspace` on Windows ([Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/), checked 2026-11-17). The `ipvs` mode is deprecated since v1.35, is disabled by default from v1.40 and is removed in v1.43. Kubernetes 1.37 defaults to `iptables`; a future version will default to `nftables`. The `iptables` value is what the running ConfigMap says.

## kubectl

```
kubectl -n kube-system get ds kube-proxy
kubectl -n kube-system get cm kube-proxy -o jsonpath='{.data.config\.conf}'      # the active configuration, incl. mode
kubectl -n kube-system logs ds/kube-proxy | head                              # start-up messages and warnings
kubectl get svc,endpointslice -l kubernetes.io/service-name=pxy             # what it should be programming
kubectl exec client -- wget -qO- -T 3 http://pxy                              # test from inside the cluster
# on the node:
iptables-save -t nat | grep <service-name>      # the rules (iptables mode)
```

## How it fails

Rows one and two were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `wget: can't connect to remote host (10.96.204.234): Connection refused`; the Service's EndpointSlice shows `ENDPOINTS <unset>` | The Service selector (`app=wrong`) matches no ready Pod, so there is no backend and kube-proxy refuses the connection | Fix the selector or the Pod labels or readiness (see the Service and EndpointSlice cards) |
| After `kubectl delete ds kube-proxy`: the existing Service still works, but a Service created afterwards fails with `wget: download timed out` | The old rules stay in the kernel; with no kube-proxy, new Services and endpoint changes are never programmed | Re-create the DaemonSet (`kubectl apply -f` of its saved YAML); the new Service answered about 20 seconds later |
| Service reachable from Pods but not by its NodePort from outside (not reproduced) | `nodePortAddresses` unset or a firewall; kube-proxy logged `nodePortAddresses is unset; NodePort connections will be accepted on all local IPs` | Set `--nodeport-addresses`, open the node port |

## Related

- **Cards:** Service, EndpointSlice and DNS for Services and Pods (group 4); CNI and CSI plug-ins; kubelet; NetworkPolicy (group 4).
- **Chapter and lab:** Chapters 5.1 and 5.5 (Vol 5); Services in Chapter 5.3 and Lab 5.3.
- **Exam domain:** CKA Troubleshooting: cluster components; CKA Services and Networking: ClusterIP, NodePort, LoadBalancer, endpoints.
