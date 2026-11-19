# EndpointSlice

## What and why

An EndpointSlice is the list of network endpoints (address, port, readiness) that stand behind a Service. That list changes whenever a Pod starts, stops or fails its readiness check, so it must be small and cheap to update.

The **EndpointSlice controller** creates slices for every Service with a selector and labels each one `kubernetes.io/service-name`. A slice holds up to 100 endpoints by default (kube-controller-manager flag `--max-endpoints-per-slice`, maximum 1000), so a big Service gets several slices. **kube-proxy** and other data planes watch slices to learn where to send traffic. For a Service without a selector you write the slices yourself.

## Diagram

{{diagram endpointslice-01.jsx | endpoint conditions · 3 states}}
A Pod joins the slice not ready, turns ready when its probe passes, and is marked terminating when it is deleted.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). For a Service with a selector the controller writes the slice. This is the real slice for the `web` Service from the Service card, trimmed:

```yaml
$ kubectl get endpointslice -l kubernetes.io/service-name=web -o yaml
- addressType: IPv4
  endpoints:
  - addresses: [10.244.1.2]
    conditions: {ready: true, serving: true, terminating: false}
    nodeName: cnlab-worker
    targetRef: {kind: Pod, name: web-6544f9f66-w9pdr, namespace: default}
  metadata:
    labels:
      endpointslice.kubernetes.io/managed-by: endpointslice-controller.k8s.io
      kubernetes.io/service-name: web
    name: web-wdxbd
  ports:
  - {name: http, port: 80, protocol: TCP}
```

For a Service without a selector you write the slice yourself. The label ties it to the Service:

```yaml
apiVersion: v1
kind: Service
metadata: {name: manual}
spec:
  ports: [{name: http, port: 80}]
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: manual-1
  labels: {kubernetes.io/service-name: manual}
addressType: IPv4
ports: [{name: http, port: 80, protocol: TCP}]
endpoints:
- addresses: [10.244.1.3]        # a Pod IP in this test
  conditions: {ready: true}
```

```
$ kubectl exec client -- wget -qO- -T 3 http://manual | grep -i '<title>'
<title>Welcome to nginx!</title>
```

## Key fields

Checked with `kubectl explain endpointslice` on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| label `kubernetes.io/service-name` | links the slice to its Service | required for a slice you write |
| `addressType` | `IPv4`, `IPv6` or `FQDN` (deprecated); every address in the slice has this type; immutable | required |
| `endpoints[].addresses` | addresses of one endpoint, 1 to 100 (the controller writes exactly 1) | required |
| `endpoints[].conditions.ready` | ready for traffic; unset counts as `true` | unset |
| `endpoints[].conditions.serving` / `terminating` | able to serve (even while shutting down) / being deleted | unset |
| `endpoints[].targetRef` | the object behind the endpoint, normally a Pod | unset |
| `endpoints[].hints` | `forZones` or `forNodes` (up to 8 each) for topology-aware routing | unset |
| `ports[]` | `name`, `port`, `protocol`, `appProtocol`; unique names, up to 100 per slice | none |
| endpoints per slice | API allows up to 1000; the controller fills 100 by default (`--max-endpoints-per-slice`) | 100 |

## kubectl

```bash
kubectl get endpointslice -l kubernetes.io/service-name=web      # all slices of one Service
kubectl get endpointslice web-wdxbd -o yaml                      # conditions and targetRef
kubectl get endpointslice -l kubernetes.io/service-name=slow \
  -o jsonpath='{range .items[0].endpoints[*]}{.addresses[0]}{" ready="}{.conditions.ready}{"\n"}{end}'
kubectl describe svc web | grep Endpoints                         # quick check from the Service
kubectl apply -f manual-slice.yaml                               # a slice you write
kubectl get pods -l app=web -o wide                              # compare Pod IPs
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `wget: can't connect to remote host (10.96.227.105): Connection refused`. The Pod shows `0/1 Running`; its slice entry reads `10.244.1.5 ready=false serving=false terminating=false` | The readiness probe fails (here `GET /ready` returns 404), so the endpoint is not ready and kube-proxy skips it | Fix the probe or the app; `kubectl describe pod` shows the probe failures |
| `wget: can't connect to remote host (10.96.180.35): Connection refused` and `Endpoints: <none>` on the Service, although a slice with the right IP exists | The hand-written slice has no `kubernetes.io/service-name: manual2` label, so the Service does not use it | Add the label |
| A script that reads only the first slice misses Pods (documented, not reproduced here) | A Service with more than 100 ready Pods has several slices (default 100 endpoints each) | Always select by label and read every item |

## Related

- **Cards:** Service, Endpoints (deprecated), kube-proxy, Pod lifecycle and probes (readiness decides ready)
- **Chapter and lab:** Ch 5.3 and Lab 5.3
- **Exam:** CKA, Services and Networking (20%): ClusterIP, NodePort, LoadBalancer, endpoints
- **Source:** [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)
