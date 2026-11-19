# ResourceQuota

## What and why

A ResourceQuota caps what one namespace may consume: object counts (pods, services, secrets, PVCs) and sums of requested or limited compute and storage (`requests.cpu`, `limits.memory`, `requests.storage`). It lets teams share a cluster without one starving the others.

The **ResourceQuota admission plug-in** in kube-apiserver compares each create request with `status.hard` and `status.used` and answers `403 Forbidden` if the request would pass the limit; the quota controller in kube-controller-manager recomputes usage. If a quota tracks CPU or memory, every new Pod must state that request or limit, or be rejected, unless a LimitRange supplies defaults.

## Diagram

{{diagram resourcequota-01.jsx | ResourceQuota admission · 5 boxes}}

The quota plug-in adds the new Pod to the namespace total and rejects it if the total would pass hard.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). A namespace that may hold 2 Pods and request 500m CPU and 256Mi memory in total:

```yaml
apiVersion: v1
kind: Namespace
metadata: {name: team-a}
---
apiVersion: v1
kind: ResourceQuota
metadata: {name: compute, namespace: team-a}
spec:
  hard: {pods: "2", requests.cpu: 500m, requests.memory: 256Mi}
```

Two Pods that each request 200m CPU and 64Mi fit. A third does not:

```
$ kubectl -n team-a describe quota compute
Resource         Used   Hard
--------         ----   ----
pods             2      2
requests.cpu     400m   500m
requests.memory  128Mi  256Mi

$ kubectl -n team-a apply -f quota-p3.yaml
Error from server (Forbidden): ... pods "p3" is forbidden: exceeded quota: compute, requested: pods=1,requests.cpu=200m, used: pods=2,requests.cpu=400m, limited: pods=2,requests.cpu=500m
```

## Key fields

Checked with `kubectl explain resourcequota` on 1.37 and the Resource Quotas docs.

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.hard` | map of limits: object counts (`pods`, `services`, `secrets`, `persistentvolumeclaims`, `count/<resource>`) and compute or storage totals (`requests.cpu`, `requests.memory`, `limits.cpu`, `limits.memory`, `requests.storage`) | none |
| `spec.scopes` | filters so the quota counts only some objects: `Terminating`, `NotTerminating`, `BestEffort`, `NotBestEffort`, `PriorityClass`, `CrossNamespacePodAffinity`, `VolumeAttributesClass` | unset: counts all objects |
| `spec.scopeSelector.matchExpressions[]` | the same filters with an operator and values, such as `PriorityClass In [high]` | none |
| `status.hard`, `status.used` | what is enforced and what is used now; written by the controller | set by the controller |

## kubectl

```bash
kubectl create quota compute --hard=pods=2,requests.cpu=500m,requests.memory=256Mi -n team-a   # imperative form
kubectl -n team-a describe quota compute      # Used against Hard
kubectl -n team-a get quota compute -o jsonpath='{.status}'
kubectl -n team-a get pods                    # what is counted
kubectl describe ns team-a                    # shows quotas and limit ranges of the namespace
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `pods "p3" is forbidden: exceeded quota: compute, requested: pods=1,requests.cpu=200m, used: pods=2,requests.cpu=400m, limited: pods=2,requests.cpu=500m` | The new Pod would push `pods` over its hard limit | Delete unused Pods, or raise `hard` |
| `pods "big" is forbidden: exceeded quota: compute, requested: requests.cpu=400m, used: requests.cpu=200m, limited: requests.cpu=500m` | One Pod asks for more CPU than is left (200m used, 400m wanted, 500m allowed) | Lower the request, or raise the quota |
| `pods "noreq" is forbidden: failed quota: compute: must specify requests.cpu for: c; requests.memory for: c` | The quota tracks CPU and memory requests, so a Pod without them is rejected | Set requests in every container, or add a LimitRange with defaults |

## Related

- **Cards:** LimitRange, Requests, limits and QoS, Namespace, PriorityClass and preemption (quota by priority class)
- **Chapter and lab:** Ch 5.4 and Lab 5.4
- **Exam:** CKAD, Application Environment, Configuration and Security (25%): requests, limits, quotas
- **Source:** [Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/)
