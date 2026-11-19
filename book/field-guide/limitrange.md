# LimitRange

## What and why

A LimitRange sets defaults and bounds inside one namespace. For each container or Pod it can give `default` limits, `defaultRequest` requests, a `min` and a `max`, and a limit-to-request ratio; for PVCs it bounds the storage size. It stops one badly written Pod from asking for a whole node, and it gives Pods without resources a sane default.

The **LimitRanger admission plug-in** in kube-apiserver fills in missing requests and limits when a Pod is created, then rejects values outside `min` or `max`. It does not touch running Pods and does not apply to objects that already exist.

## Diagram

{{diagram limitrange-01.jsx | LimitRange admission · 5 boxes}}

LimitRanger fills defaults for missing values and rejects Pods outside min or max.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). Defaults and bounds for every container in namespace `team-b`:

```yaml
apiVersion: v1
kind: LimitRange
metadata: {name: defaults, namespace: team-b}
spec:
  limits:
  - type: Container
    default: {cpu: 500m, memory: 128Mi}          # limit when none is set
    defaultRequest: {cpu: 100m, memory: 64Mi}    # request when none is set
    max: {cpu: "1", memory: 256Mi}
    min: {cpu: 50m}
```

A Pod with no `resources` gets the defaults at creation. A Pod above the maximum is refused:

```
$ kubectl -n team-b get pod plain -o jsonpath='{.spec.containers[0].resources}'
{"limits":{"cpu":"500m","memory":"128Mi"},"requests":{"cpu":"100m","memory":"64Mi"}}

$ kubectl -n team-b apply -f lr-pods.yaml      # second Pod asks for limits.cpu 2
Error from server (Forbidden): ... pods "toobig" is forbidden: maximum cpu usage per Container is 1, but limit is 2

$ kubectl -n team-b describe limitrange defaults
Type        Resource  Min  Max    Default Request  Default Limit  Max Limit/Request Ratio
Container   cpu       50m  1      100m             500m           -
Container   memory    -    256Mi  64Mi             128Mi          -
```

## Key fields

Checked with `kubectl explain limitrange` and the live object on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.limits[].type` | `Container`, `Pod` or `PersistentVolumeClaim` | required |
| `...default` | limit applied to a container that sets none | none |
| `...defaultRequest` | request applied to a container that sets none | `none` |
| `...min`, `...max` | smallest and largest allowed value per container (or Pod, or claim size) | none |
| `...maxLimitRequestRatio` | largest allowed limit divided by request | none |
| scope | one LimitRange applies to its namespace only, at creation of new objects | n/a |

## kubectl

```bash
kubectl -n team-b apply -f lr.yaml
kubectl -n team-b describe limitrange defaults     # a table of Min, Max, Default Request, Default Limit
kubectl -n team-b get pod plain -o jsonpath='{.spec.containers[0].resources}'   # what was injected
kubectl describe ns team-b                         # quotas and limit ranges of the namespace
kubectl -n team-b get limitrange
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `pods "toobig" is forbidden: maximum cpu usage per Container is 1, but limit is 2` | The container's limit is above the LimitRange `max` | Lower the limit, or raise `max` |
| A Pod you gave no resources is throttled at `500m` CPU and killed at `128Mi` memory | The LimitRange injected its `default` limits (`limits: {cpu: 500m, memory: 128Mi}` in the example) | Set explicit `resources`, or change the defaults |
| Editing the LimitRange changes nothing for running Pods (documented, not reproduced) | It is applied only when objects are created | Recreate the Pods (a rollout for a Deployment) |

## Related

- **Cards:** ResourceQuota, Requests, limits and QoS, Namespace
- **Chapter and lab:** Ch 5.4 and Lab 5.4
- **Exam:** CKAD, Application Environment, Configuration and Security (25%): requests, limits, quotas
- **Source:** [Limit Ranges](https://kubernetes.io/docs/concepts/policy/limit-range/)
