# DNS for Services and Pods

## What and why

Cluster DNS gives Services and Pods names, so clients never need an IP. A Service `web` in namespace `shop` is `web.shop.svc.cluster.local`; a Pod in `shop` reaches it as plain `web`.

**CoreDNS** runs as a Deployment in `kube-system` behind the `kube-dns` Service and watches Services and EndpointSlices through the API. The **kubelet** writes each Pod's `/etc/resolv.conf` (nameserver, a `search` list, `options ndots:5`) according to the Pod's `dnsPolicy`. A headless Service answers with Pod IPs, and named ports also get SRV records.

## Diagram

{{diagram dns-for-services-and-pods-01.jsx | Service DNS lookup · 4 boxes}}
The Pod queries the kube-dns Service, which forwards to CoreDNS Pods that watch Services and EndpointSlices in the API.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16), from an alpine client Pod in namespace `default`. DNS needs no YAML: the kubelet writes the Pod's resolver file and CoreDNS answers.

```
$ kubectl exec client -- cat /etc/resolv.conf
search default.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5

$ kubectl exec client -- nslookup web.np.svc.cluster.local     # a Service in another namespace
Name:	web.np.svc.cluster.local
Address: 10.96.41.10

$ kubectl exec client -- nslookup web-headless                 # headless: Pod IPs, no virtual IP
Name:	web-headless.default.svc.cluster.local
Address: 10.244.1.2
Name:	web-headless.default.svc.cluster.local
Address: 10.244.1.3

$ kubectl exec client -- nslookup -type=srv _http._tcp.web.default.svc.cluster.local
_http._tcp.web.default.svc.cluster.local	service = 0 100 80 web.default.svc.cluster.local
```

The alpine `nslookup` also prints `** server can't find web.cluster.local: NXDOMAIN` for the search-list names it tries first, and exits with 1; the real answer is the line with `Name:` and `Address:`. `kubectl -n kube-system get cm coredns -o jsonpath='{.data.Corefile}'` shows the `kubernetes cluster.local in-addr.arpa ip6.arpa` plug-in, `forward . /etc/resolv.conf` for outside names and `cache 30`.

## Key fields

Checked with `kubectl explain pod.spec` on 1.37; the observed lines come from the test cluster.

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.dnsPolicy` | `ClusterFirst`, `ClusterFirstWithHostNet`, `Default` (the node's resolver) or `None` | `ClusterFirst` |
| `spec.dnsConfig` | extra `nameservers`, `searches`, `options` merged into the generated file | none |
| `options ndots` (in `resolv.conf`) | a name with fewer dots than this is tried with each search suffix first | `5` (observed) |
| `spec.hostname`, `spec.subdomain` | Pod name becomes `<hostname>.<subdomain>.<namespace>.svc.<cluster domain>` when a headless Service named like the subdomain exists | system-defined hostname, no subdomain |
| `spec.setHostnameAsFQDN` | put the FQDN into the kernel hostname | `false` |
| Service record | `<service>.<namespace>.svc.cluster.local` gives the ClusterIP; for a headless Service, the Pod IPs; SRV `_<port>._<proto>.<service>...` for named ports | n/a |
| ConfigMap `coredns` in `kube-system` | the Corefile CoreDNS reads | created by the cluster installer |

## kubectl

```bash
kubectl exec client -- cat /etc/resolv.conf                 # nameserver, search, ndots
kubectl exec client -- nslookup web.np.svc.cluster.local    # full name works from any namespace
kubectl -n kube-system get deploy coredns                   # are the DNS Pods up?
kubectl -n kube-system get cm coredns -o jsonpath='{.data.Corefile}'
kubectl -n kube-system scale deploy coredns --replicas=2    # restore after a test
kubectl get svc -n kube-system kube-dns                     # the nameserver address
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `nslookup: write to '10.96.0.10': Connection refused`, `;; connection timed out; no servers could be reached`, and `wget: bad address 'web'` | CoreDNS has no ready Pod (this test scaled the Deployment to 0) | `kubectl -n kube-system get deploy coredns`; scale it back; read the Pod logs if it keeps failing |
| `** server can't find nosuch.default.svc.cluster.local: NXDOMAIN` | The name does not exist: wrong Service name, or the Service is in another namespace | Use `<service>.<namespace>` from another namespace; check `kubectl get svc -A` |
| In a Pod with `dnsPolicy: Default`, `nslookup web` ends with `;; connection timed out; no servers could be reached`; its `resolv.conf` shows the node's nameserver `192.168.65.254` and `options ndots:0` | `Default` means "inherit the node's DNS settings", not cluster DNS | Remove the field (the default is `ClusterFirst`) |

## Related

- **Cards:** CoreDNS and cluster add-ons (group 1), Service, NetworkPolicy, kubelet
- **Chapter and lab:** Ch 5.3 and Lab 5.3; Ch 6.1 and Lab 6.1
- **Exam:** CKA, Services and Networking (20%): CoreDNS; CKA Troubleshooting (30%): services and networking
- **Source:** [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/)
