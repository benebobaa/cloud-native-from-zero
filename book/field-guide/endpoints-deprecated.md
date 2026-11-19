# Endpoints (deprecated)

## What and why

Endpoints is the original list of Pod addresses behind a Service, one object named after the Service. It is deprecated since Kubernetes v1.33 in favour of EndpointSlice, but it is still served and still written for Services with selectors.

The **endpoints controller** keeps it current. One object cannot be split, so above 1000 backing endpoints the control plane truncates it and sets the annotation `endpoints.kubernetes.io/over-capacity: truncated`. You still meet Endpoints when a Service points outside the cluster: create a Service without a selector plus an Endpoints object with the same name, and the **EndpointSlice mirroring controller** copies it into a slice. The docs now say to write EndpointSlices directly instead.

## Diagram

{{diagram endpoints-deprecated-01.jsx | Endpoints and slices · 2 paths}}
The Endpoints controller writes the legacy object for selector Services; the mirroring controller copies hand-written Endpoints into slices.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). A Service without a selector and an Endpoints object with the same name:

```yaml
apiVersion: v1
kind: Service
metadata: {name: external-db}
spec:
  ports: [{name: db, port: 80}]
---
apiVersion: v1
kind: Endpoints
metadata: {name: external-db}
subsets:
- addresses: [{ip: 10.244.1.3}]     # a Pod IP in this test
  ports: [{name: db, port: 80}]
```

Every kubectl call that touches Endpoints prints a deprecation warning, and the control plane mirrors the object into a slice:

```
$ kubectl get endpoints web
Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice
NAME   ENDPOINTS                     AGE
web    10.244.1.2:80,10.244.1.3:80   25s

$ kubectl get endpointslice -l kubernetes.io/service-name=external-db \
    -o custom-columns=NAME:.metadata.name,MANAGED-BY:.metadata.labels.endpointslice\.kubernetes\.io/managed-by
NAME                MANAGED-BY
external-db-h4qbx   endpointslicemirroring-controller.k8s.io

$ kubectl exec client -- wget -qO- -T 3 http://external-db | grep -i '<title>'
<title>Welcome to nginx!</title>
```

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `metadata.name` | must equal the Service name | required |
| `subsets[].addresses[].ip` | ready backend addresses | none |
| `subsets[].notReadyAddresses[]` | backends that exist but are not ready | none |
| `subsets[].ports[]` | `name`, `port`, `protocol`; the port name must match the Service port name | none |
| label `endpoints.kubernetes.io/managed-by: endpoint-controller` | set on objects the endpoints controller writes | set by the controller |
| annotation `endpoints.kubernetes.io/over-capacity: truncated` | the control plane cut the list at 1000 backends | absent |
| label `endpointslice.kubernetes.io/skip-mirror: "true"` | stops mirroring into EndpointSlices | absent (mirrored) |

Mirroring is skipped when the Service does not exist or has a selector, per the Kubernetes docs.

## kubectl

```bash
kubectl get endpoints web                 # prints the deprecation warning
kubectl get ep web -o yaml                # subsets, targetRef, managed-by label
kubectl api-resources | grep -E 'endpoints|endpointslices'
kubectl get endpointslice -l kubernetes.io/service-name=external-db   # the mirrored slice
kubectl apply -f svc-and-endpoints.yaml  # a selectorless Service and its Endpoints
```

Prefer `kubectl get endpointslice` in new scripts.

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice` on every call; tooling that only reads Endpoints breaks later | The API is deprecated | Read EndpointSlices; write EndpointSlices for selectorless Services |
| `wget: can't connect to remote host (10.96.14.52): Connection refused` and `kubectl get endpointslice -l kubernetes.io/service-name=external-db` returns `No resources found` | The Endpoints object was named `external-dbb`, not `external-db`: only the same name is linked | Rename the object to match the Service |
| Traffic reaches at most 1000 backends (documented, not reproduced here) | The Endpoints object is truncated at 1000 and annotated `over-capacity: truncated` | Use EndpointSlice, which has no such limit |

## Related

- **Cards:** EndpointSlice (the replacement), Service
- **Chapter and lab:** Ch 5.3 and Lab 5.3 (the chapter teaches the deprecation)
- **Exam:** CKA, Services and Networking (20%): endpoints
- **Source:** [Service: Endpoints (deprecated)](https://kubernetes.io/docs/concepts/services-networking/service/), [EndpointSlices: mirroring](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)
