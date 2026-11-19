# Topology spread constraints

## What and why

Topology spread constraints tell the scheduler to spread matching Pods evenly across failure domains such as zones or nodes, so losing one zone does not take out every replica. Pod anti-affinity can only say "not together"; spread constraints say "keep the counts close".

Each constraint has a `topologyKey` (the node label that defines a domain), a `labelSelector` (which Pods are counted), `maxSkew` (the largest allowed gap between the fullest and the emptiest domain) and `whenUnsatisfiable` (`DoNotSchedule` leaves the Pod Pending, `ScheduleAnyway` only prefers the balanced node). The **kube-scheduler** checks them when it places a Pod; it does not move Pods that are already running.

## Diagram

{{diagram topology-spread-constraints-01.jsx | topology spread · 6 boxes}}

The skew of a candidate domain decides whether the Pod may go there, is blocked, or is only discouraged.

## Minimal example

Tested on kind v0.33.0 (control-plane plus two workers) with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). Label the workers as two zones, then ask for four replicas spread across zones:

```bash
kubectl label node cnlab-worker topology.kubernetes.io/zone=zone-a
kubectl label node cnlab-worker2 topology.kubernetes.io/zone=zone-b
```

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: {name: zoned}
spec:
  replicas: 4
  selector: {matchLabels: {app: zoned}}
  template:
    metadata: {labels: {app: zoned}}
    spec:
      topologySpreadConstraints:
      - maxSkew: 1
        topologyKey: topology.kubernetes.io/zone
        whenUnsatisfiable: DoNotSchedule
        labelSelector: {matchLabels: {app: zoned}}
      containers: [{name: c, image: alpine:3.21, command: [sleep, "3600"]}]
```

With both zones open the scheduler placed two Pods in each. To see the constraint bite, `worker2` (zone-b) was cordoned before the Deployment was created. Zone-b still counts as a domain with zero Pods, so zone-a may hold only one Pod:

```
$ kubectl get pods -l app=zoned -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeName,PHASE:.status.phase
zoned-679f9844df-47wbx   cnlab-worker       Running
zoned-679f9844df-l96mw   <none>             Pending
zoned-679f9844df-qcxzm   <none>             Pending
zoned-679f9844df-wttz5   <none>             Pending

$ kubectl uncordon cnlab-worker2         # 20 s later
zoned-679f9844df-47wbx   cnlab-worker        Running
zoned-679f9844df-l96mw   cnlab-worker2       Running
zoned-679f9844df-qcxzm   cnlab-worker        Running
zoned-679f9844df-wttz5   cnlab-worker2       Running
```

## Key fields

Checked with `kubectl explain pod.spec.topologySpreadConstraints` on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| `maxSkew` | largest allowed gap in matching Pods between a domain and the emptiest one | required |
| `topologyKey` | the node label that defines a domain, such as `topology.kubernetes.io/zone` or `kubernetes.io/hostname` | required |
| `whenUnsatisfiable` | `DoNotSchedule` leaves the Pod Pending; `ScheduleAnyway` schedules and prefers the balanced node | `DoNotSchedule` |
| `labelSelector` | which Pods are counted | none |
| `matchLabelKeys` | pod label keys added to the selector, for example `pod-template-hash` (beta, on by default) | none |
| `minDomains` | treat the global minimum as 0 while fewer eligible domains exist; needs `DoNotSchedule` | unset (as 1) |
| `nodeAffinityPolicy` | `Honor` counts only nodes matching the Pod's node affinity or selector; `Ignore` counts all | nil means `Honor` |
| `nodeTaintsPolicy` | `Honor` skips tainted nodes the Pod cannot tolerate; `Ignore` counts all | nil means `Ignore` |
| skew | Pods in a domain minus the fewest in any eligible domain | n/a |

## kubectl

```bash
kubectl get nodes -L topology.kubernetes.io/zone          # zone label per node
kubectl get pods -l app=zoned -o wide                     # Pods per node
kubectl get pods -l app=zoned -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeName,PHASE:.status.phase
kubectl describe pod <pending-pod> | sed -n '/^Events/,$p' # which constraint failed
kubectl get events --field-selector reason=FailedScheduling
kubectl label node cnlab-worker topology.kubernetes.io/zone=zone-a --overwrite
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pods `Pending`; event `0/3 nodes are available: 1 node(s) didn't match pod topology spread constraints, 1 node(s) had untolerated taint(s), 1 node(s) were unschedulable. preemption: 0/3 nodes are available: 1 No preemption victims found for incoming pod, 2 Preemption is not helpful for scheduling.` | The only usable zone already holds `maxSkew` more Pods than the unusable zone (zone-b was cordoned) | Restore capacity in the other zone, raise `maxSkew`, or use `ScheduleAnyway` |
| Replicas end up lopsided after a node dies or a Deployment scales down (documented, not reproduced) | Constraints are checked only when a Pod is scheduled, never for Pods that already run | Roll the Deployment (`kubectl rollout restart`) or use a descheduler |
| A Pod stays `Pending` when `minDomains` is larger than the number of zones (documented, not reproduced) | With fewer eligible domains than `minDomains`, the global minimum is treated as 0 | Add zones, lower `minDomains`, or remove it |

## Related

- **Cards:** Taints, tolerations and affinity, Deployment, kube-scheduler, Node (zone labels live here)
- **Chapter and lab:** not a separate row in the coverage matrix; the scheduling chapter is Ch 5.4
- **Exam:** CKA, Workloads and Scheduling (15%)
- **Source:** [Pod Topology Spread Constraints](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/)
