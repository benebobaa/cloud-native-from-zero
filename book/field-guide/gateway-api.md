# Gateway API

## What and why

Gateway API is the role-oriented successor to Ingress for routing traffic into a cluster. It splits the work into objects owned by different people: an infrastructure provider defines a `GatewayClass`, a cluster operator creates a `Gateway` (listeners such as HTTP on port 80), and application teams attach routes such as `HTTPRoute` or `GRPCRoute` that point at Services.

It is not built into the API server. You install its CRDs (the standard channel, release v1.7.0 when this card was written) and a **Gateway controller** from an implementation of your choice; the controller reconciles Gateways and writes their status. Without a controller the objects are accepted but stay unprogrammed.

GatewayClass, Gateway and HTTPRoute are GA (`apiVersion: gateway.networking.k8s.io/v1`); GRPCRoute joined the standard channel in v1.1.0. See the [API overview](https://gateway-api.sigs.k8s.io/docs/concepts/api-overview/) and [Versioning](https://gateway-api.sigs.k8s.io/docs/concepts/versioning/).

## Diagram

{{diagram gateway-api-01.jsx | Gateway API roles · 5 objects}}
Provider, operator and app team each own one object, and a controller you install turns them into a working data plane.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). Gateway API is not built in, so first install its CRDs. This test applied the standard-channel CRD files of release v1.7.0 from `raw.githubusercontent.com/kubernetes-sigs/gateway-api/v1.7.0/config/crd/standard/` (GatewayClass, Gateway, HTTPRoute, GRPCRoute, ReferenceGrant) with server-side apply, because the HTTPRoute CRD is too large for client-side apply. The one-file release manifest on GitHub Releases was not reachable from the test machine.

```
$ kubectl api-resources --api-group=gateway.networking.k8s.io
NAME   SHORTNAMES   APIVERSION   NAMESPACED   KIND            # empty before the CRDs
$ kubectl apply --server-side -f gateway.networking.k8s.io_gatewayclasses.yaml -f ..._gateways.yaml -f ..._httproutes.yaml ...
$ kubectl api-resources --api-group=gateway.networking.k8s.io
NAME              SHORTNAMES   APIVERSION                     NAMESPACED   KIND
gatewayclasses    gc           gateway.networking.k8s.io/v1   false        GatewayClass
gateways          gtw          gateway.networking.k8s.io/v1   true         Gateway
grpcroutes                     gateway.networking.k8s.io/v1   true         GRPCRoute
httproutes                     gateway.networking.k8s.io/v1   true         HTTPRoute
referencegrants   refgrant     gateway.networking.k8s.io/v1   true         ReferenceGrant
```

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata: {name: example}
spec:
  controllerName: example.com/gateway-controller
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata: {name: web-gw}
spec:
  gatewayClassName: example
  listeners:
  - {name: http, port: 80, protocol: HTTP}
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: {name: web}
spec:
  parentRefs: [{name: web-gw}]
  hostnames: [web.example.test]
  rules:
  - matches: [{path: {type: PathPrefix, value: /}}]
    backendRefs: [{name: web, port: 80}]
```

The API accepts all three. No Gateway controller runs in this cluster, so traffic was **not** routed; the status shows the objects waiting for one:

```
$ kubectl get gatewayclass,gateway,httproute
NAME                                             CONTROLLER                       ACCEPTED   AGE
gatewayclass.gateway.networking.k8s.io/example   example.com/gateway-controller   Unknown    4s

NAME                                       CLASS     ADDRESS   PROGRAMMED   AGE
gateway.gateway.networking.k8s.io/web-gw   example             Unknown      4s

NAME                                      HOSTNAMES              AGE
httproute.gateway.networking.k8s.io/web   ["web.example.test"]   4s
```

## Key fields

Checked with `kubectl explain` and the v1.7.0 CRD schemas on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| GatewayClass `spec.controllerName` | domain-prefixed name of the controller that manages this class, such as `example.net/gateway-controller` | required |
| Gateway `spec.gatewayClassName` | the GatewayClass this Gateway uses (exactly one) | required |
| Gateway `spec.listeners[]` | `name`, `port`, `protocol` (all required), plus optional `hostname` and `tls` | none |
| `listeners[].allowedRoutes.namespaces.from` | which namespaces may attach routes: `Same`, `All` or `Selector` | `Same` |
| HTTPRoute `spec.parentRefs[]` | the Gateway (and optional `sectionName` listener, `port`) the route attaches to | none |
| HTTPRoute `spec.hostnames` | host names the route serves | unset: all hosts |
| `rules[].matches[].path` | `type` is `Exact`, `PathPrefix` or `RegularExpression` (implementation-specific); `value` | `PathPrefix` and `/` |
| `rules[].backendRefs[]` | target Service `name` and `port`, optional `weight` | `weight` 1 |

## kubectl

```bash
kubectl api-resources --api-group=gateway.networking.k8s.io   # are the CRDs installed?
kubectl apply --server-side -f <crd-file>.yaml                 # install a CRD file (large ones need server-side)
kubectl get gatewayclass,gateway,httproute -A                  # ACCEPTED, PROGRAMMED, ADDRESS
kubectl describe gateway web-gw                                # Conditions and Events
kubectl get gatewayclass example -o jsonpath='{.status.conditions}'
kubectl get httproute web -o jsonpath='{.status}'              # parent conditions: Accepted, ResolvedRefs
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `no matches for kind "GatewayClass" in version "gateway.networking.k8s.io/v1"` and `ensure CRDs are installed first` | The Gateway API CRDs are not in the cluster | Install the standard-channel CRDs (server-side apply), then re-apply |
| `ACCEPTED Unknown`, Gateway `PROGRAMMED Unknown`, condition message `Waiting for controller`, reason `Pending`; the HTTPRoute `status` is empty | No controller implements the class's `controllerName`, or the name has a typo | Install a Gateway controller and use its exact `controllerName` |
| `The HTTPRoute "bad" is invalid: spec.rules[0].matches[0].path: Invalid value: value must be an absolute path and start with '/' when type one of ['Exact', 'PathPrefix']` | The path value was `api`, not `/api` | Start the path with `/` |

## Related

- **Cards:** Ingress and IngressClass, Service, CustomResourceDefinition (Gateway API ships as CRDs)
- **Chapter and lab:** Ch 6.2 and Lab 6.2
- **Exam:** CKA, Services and Networking (20%): Gateway API
- **Source:** [Gateway API concept page](https://kubernetes.io/docs/concepts/services-networking/gateway/), [gateway-api.sigs.k8s.io](https://gateway-api.sigs.k8s.io/)
