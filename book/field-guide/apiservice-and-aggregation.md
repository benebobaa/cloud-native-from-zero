# APIService and aggregation

## What and why

An APIService registers an API group and version that another server answers. It is the heavier way to extend Kubernetes: you run your own API server, and the kube-apiserver proxies requests for that group to it. metrics-server is the common example.

**Acts on it:** the aggregator inside the kube-apiserver routes requests and records availability in the APIService status.

## Diagram

{{diagram apiservice-and-aggregation-01.jsx | API aggregation · 4 hops}}

To the client it looks like one API server; behind one path it is another program.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1, metrics-server v0.9.1 (2026-11-17). The one aggregated API every cluster has is `metrics.k8s.io`: the metrics-server install (Metrics API card) creates this APIService. Writing a new aggregated API server is a Go project (see `sample-apiserver` in the Kubernetes repository) and was not done here.

```yaml
apiVersion: apiregistration.k8s.io/v1
kind: APIService
metadata: {name: v1beta1.metrics.k8s.io}
spec:
  group: metrics.k8s.io
  version: v1beta1
  groupPriorityMinimum: 100
  versionPriority: 100
  insecureSkipTLSVerify: true      # the manifest's choice; production should set caBundle
  service: {name: metrics-server, namespace: kube-system}   # port defaults to 443
```

```text
$ kubectl get apiservice | head -4
NAME                              SERVICE                      AVAILABLE   AGE
v1.                               Local                        True        10m
v1.admissionregistration.k8s.io   Local                        True        10m
v1.apiextensions.k8s.io           Local                        True        10m
$ kubectl get apiservice v1beta1.metrics.k8s.io -o jsonpath='{.status.conditions}'
[{"lastTransitionTime":"2026-11-17T04:47:40Z","message":"all checks passed","reason":"Passed","status":"True","type":"Available"}]
```

`Local` in the SERVICE column marks groups the API server serves itself; a row with `namespace/name` is forwarded to that Service. A client sends `GET /apis/metrics.k8s.io/v1beta1/nodes` to the normal API endpoint; kube-apiserver authenticates and authorizes the request, then proxies it to the Service.

## Key fields

Fields, required markers and defaults are from `kubectl explain apiservice.spec` on the test cluster.

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.group`, `spec.version` | The API group and version this server hosts | required for aggregated APIs |
| `spec.service.name`, `spec.service.namespace` | The Service that fronts the extension server; if `service` is nil the group is served locally | none |
| `spec.service.port` | Port on that Service; the explain text says the call must use 443 | `443` |
| `spec.caBundle` | PEM CA that validates the extension server's certificate | unset: the API server's system trust roots |
| `spec.insecureSkipTLSVerify` | Skip certificate checks; "strongly discouraged" | false |
| `spec.groupPriorityMinimum` | How strongly clients prefer this group; higher first | required |
| `spec.versionPriority` | Order of versions inside the group; must be above zero | required |
| `status.conditions[]` (type `Available`) | `True`, or `False` with a reason such as `ServiceNotFound`, `MissingEndpoints`, `FailedDiscoveryCheck` | set by the aggregator |

The aggregation layer is described in [Extend the Kubernetes API with the aggregation layer](https://kubernetes.io/docs/tasks/extend-kubernetes/configure-aggregation-layer/). An extension API server must accept the requests the aggregator forwards, so it needs the delegated-authentication permissions that the metrics-server RBAC objects grant (`system:auth-delegator`, `extension-apiserver-authentication-reader`).

## kubectl

```bash
kubectl get apiservice                                       # AVAILABLE column
kubectl get apiservice v1beta1.metrics.k8s.io -o yaml        # spec and status.conditions
kubectl get apiservice -o custom-columns=NAME:.metadata.name,SERVICE:.spec.service.name,AVAILABLE:.status.conditions[0].status | grep -v Local
kubectl get --raw /apis/metrics.k8s.io/v1beta1               # straight through the aggregator
kubectl api-resources --api-group=metrics.k8s.io
kubectl -n kube-system get svc,endpointslices -l k8s-app=metrics-server
kubectl -n kube-system logs deploy/metrics-server
kubectl explain apiservice.spec
```

## How it fails

Rows 1 and 2 were reproduced with an APIService for group `ghost.example.com`; row 3 was reproduced with metrics-server (see the Metrics API card).

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubectl get apiservice` shows `default/ghost-api   False (ServiceNotFound)`; condition message `service/ghost-api in "default" is not present`; `kubectl get --raw /apis/ghost.example.com/v1alpha1` gives `Error from server (ServiceUnavailable): the server is currently unable to handle the request` | The APIService points to a Service that does not exist | Create the Service, or delete the APIService; one that stays unavailable keeps showing up as a failure |
| After creating the Service: `False (MissingEndpoints)`, message `endpointslices for service/ghost-api in "default" have no addresses with port name ""` | The Service exists but no ready Pod backs it | Check the extension server's Deployment, readiness probe and selector |
| `v1beta1.metrics.k8s.io ... False (MissingEndpoints)` while the metrics-server Pod is not ready; `kubectl top nodes` says `error: Metrics API not available` and the HPA cannot read metrics | Same mechanism: the extension server is down or failing its probes | Fix the Pod first (logs, probes, kubelet TLS flag), then check the APIService turns `True` |

## Related

- **Cards:** CustomResourceDefinition, Metrics API and metrics-server, kube-apiserver (group 1), Service (group 4).
- **Chapter and lab:** 7.3.
- **Exam:** no curriculum line names it (checked in the CKA and CKAD v1.37 curriculum PDFs, [cncf/curriculum](https://github.com/cncf/curriculum), 2026-11-17); metrics-server is the example you meet.
