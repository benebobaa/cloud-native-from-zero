# Service

## What and why

A Service gives a changing set of Pods one stable name and one virtual IP. Pods are replaced all the time and get new addresses; clients should not have to follow them.

The Service picks its Pods with a label selector. The **EndpointSlice controller** (in kube-controller-manager) records the ready Pod addresses, **kube-proxy** on every node rewrites traffic for the Service IP to one of them, and **CoreDNS** answers the Service name. Types: `ClusterIP` (default, reachable inside the cluster), `NodePort` (adds a port on every node), `LoadBalancer` (asks the environment for an external address), `ExternalName` (a DNS alias, no proxying) and headless (`clusterIP: None`, DNS returns Pod IPs).

## Diagram

{{diagram service-01.jsx | Service data path · 6 boxes}}
Clients use the Service name and ClusterIP; kube-proxy on each node rewrites that address to a ready Pod from the EndpointSlice.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). Two nginx Pods and a Service in front of them:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: {name: web}
spec:
  replicas: 2
  selector: {matchLabels: {app: web}}
  template:
    metadata: {labels: {app: web}}
    spec:
      containers:
      - name: nginx
        image: nginx:1.31.8
        ports: [{name: http, containerPort: 80}]
---
apiVersion: v1
kind: Service
metadata: {name: web}
spec:
  selector: {app: web}
  ports:
  - {name: http, port: 80, targetPort: http}
```

A client Pod reaches the Pods through the Service name. The slice lists the two ready Pod IPs:

```
$ kubectl exec client -- wget -qO- -T 3 http://web | grep -i '<title>'
<title>Welcome to nginx!</title>
$ kubectl get endpointslice -l kubernetes.io/service-name=web
NAME        ADDRESSTYPE   PORTS   ENDPOINTS               AGE
web-wdxbd   IPv4          80      10.244.1.2,10.244.1.3   2s
```

The other types, from the same selector (`type: NodePort`, `type: LoadBalancer`, `clusterIP: None`):

```
$ kubectl get svc
NAME           TYPE           CLUSTER-IP      EXTERNAL-IP   PORT(S)        SELECTOR
web            ClusterIP      10.96.19.215    <none>        80/TCP         app=web
web-headless   ClusterIP      None            <none>        80/TCP         app=web
web-lb         LoadBalancer   10.96.59.241    <pending>     80:32456/TCP   app=web
web-np         NodePort       10.96.79.152    <none>        80:32026/TCP   app=web
$ kubectl exec client -- wget -qO- -T 3 http://172.21.0.2:32026 | grep -i '<title>'
<title>Welcome to nginx!</title>
```

The NodePort answers on the worker node's address (172.21.0.2 here). The headless Service has no virtual IP: DNS returns the Pod IPs (see the DNS card).

## Key fields

Checked with `kubectl explain svc.spec` on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.type` | `ClusterIP`, `NodePort`, `LoadBalancer` or `ExternalName` | `ClusterIP` |
| `spec.selector` | label map choosing backend Pods; empty means you manage the endpoints yourself | none |
| `spec.ports[].port` / `targetPort` | port on the Service / port number or name on the Pod | `targetPort` equals `port` |
| `spec.ports[].protocol` | `TCP`, `UDP` or `SCTP` | `TCP` |
| `spec.clusterIP` | the virtual IP; `None` makes the Service headless | assigned from a ServiceCIDR |
| `spec.sessionAffinity` | `ClientIP` keeps one client on one Pod | `None` |
| `spec.externalTrafficPolicy` | `Local` sends NodePort and LoadBalancer traffic only to endpoints on the receiving node and keeps the client IP | `Cluster` |
| `spec.internalTrafficPolicy` | `Local` sends ClusterIP traffic only to endpoints on the caller's node | `Cluster` |
| `spec.trafficDistribution` | routing preference: `PreferSameZone`, `PreferSameNode` (`PreferClose` is a deprecated alias) | unset: implementation default |
| `spec.ipFamilyPolicy` | `SingleStack`, `PreferDualStack` or `RequireDualStack` | `SingleStack` |
| `spec.publishNotReadyAddresses` | treat not-ready Pods as ready (StatefulSet peer discovery) | `false` |
| `spec.allocateLoadBalancerNodePorts` | allocate NodePorts for `type: LoadBalancer` | `true` |

## kubectl

```bash
kubectl apply -f svc.yaml                            # create
kubectl expose deployment web --port=80 --target-port=80   # imperative create (tested)
kubectl get svc -o wide                              # type, CLUSTER-IP, EXTERNAL-IP, selector
kubectl describe svc web                             # Selector, Endpoints, Events
kubectl get endpointslice -l kubernetes.io/service-name=web   # the ready Pod IPs
kubectl get pods --show-labels                       # do the labels match the selector?
kubectl run client --image=alpine:3.21 -- sleep 3600 # a client Pod to test from
kubectl exec client -- wget -qO- -T 3 http://web     # call the Service by name
```

## How it fails

Reproduced on the same cluster as the example.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `wget: can't connect to remote host (10.96.254.216): Connection refused`; `kubectl describe svc` shows an empty `Endpoints:` line | The selector `app=wbe` matches no Pod (typo) | Compare `kubectl get pods --show-labels` with the selector and correct it |
| `wget: can't connect to remote host (10.96.120.234): Connection refused` although the slice lists Pod IPs | `targetPort: 8080`, but the container listens on 80 | Set `targetPort` to the port or port name the container really uses |
| `EXTERNAL-IP` stays `<pending>` for `type: LoadBalancer` (`80:32456/TCP` is allocated) | Nothing in a kind cluster provides external load balancers | Use `NodePort` or `kubectl port-forward` locally; in a cloud the cloud-controller-manager fills the address |

## Related

- **Cards:** EndpointSlice, Endpoints (deprecated), ServiceCIDR and IPAddress, Ingress and IngressClass, Gateway API, NetworkPolicy, DNS for Services and Pods, kube-proxy
- **Chapter and lab:** Ch 5.3 and Lab 5.3; Ch 6.1 for policy and DNS
- **Exam:** CKA and CKAD, Services and Networking (20%); CKA Troubleshooting (30%), services and networking
- **Source:** [Service](https://kubernetes.io/docs/concepts/services-networking/service/), [Virtual IPs and service proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/)
