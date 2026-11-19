# PodDisruptionBudget

## What and why

A PodDisruptionBudget (PDB) limits how many Pods of a replicated app may be down at once during voluntary disruptions: node drains, upgrades, autoscaler scale-down. You give a label selector and either `minAvailable` or `maxUnavailable`.

The disruption controller in kube-controller-manager computes `status.disruptionsAllowed`. The **Eviction API** (`pods/eviction`, used by `kubectl drain`) checks it and refuses with `429 Too Many Requests` when an eviction would break the budget. A PDB does not protect against involuntary loss (a node crash) or against a plain `kubectl delete pod`.

## Diagram

{{diagram poddisruptionbudget-01.jsx | eviction check · 5 boxes}}

The eviction call succeeds only while the PDB allows another disruption.

## Minimal example

Tested on kind v0.33.0 (three nodes) with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). Two replicas, a budget that allows no voluntary loss, and a drain of the node that runs both:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: {name: guarded}
spec:
  minAvailable: 2
  selector: {matchLabels: {app: guarded}}
```

```
$ kubectl get pdb
NAME      MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
guarded   2               N/A               0                     10s

$ kubectl drain cnlab-worker --ignore-daemonsets --delete-emptydir-data --timeout=25s
evicting pod default/guarded-5c4b6cfd89-x96mn
evicting pod default/guarded-5c4b6cfd89-4z4sd
error when evicting pods/"guarded-5c4b6cfd89-x96mn" -n "default" (will retry after 5s): Cannot evict pod as it would violate the pod's disruption budget.
... (the same two lines every 5 s)
error: unable to drain node "cnlab-worker" due to error: [error when evicting pods/"guarded-..." -n "default": global timeout reached: 25s, ...]
```

Relax the budget and the drain finishes. The replacements start on the other worker while the node is cordoned:

```
$ kubectl patch pdb guarded --type merge -p '{"spec":{"minAvailable":1}}'
$ kubectl get pdb
guarded   1   N/A   1   38s
$ kubectl drain cnlab-worker --ignore-daemonsets --delete-emptydir-data --timeout=120s
pod/guarded-5c4b6cfd89-x96mn evicted
pod/guarded-5c4b6cfd89-4z4sd evicted
node/cnlab-worker drained
$ kubectl get pods -l app=guarded -o wide     # both now on cnlab-worker2
```

## Key fields

Checked with `kubectl explain pdb.spec` on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.selector` | label selector of the Pods the budget protects | required in practice |
| `spec.minAvailable` | at least this many (number or percent) must stay available after an eviction; `"100%"` blocks all voluntary evictions | unset; exclusive with `maxUnavailable` |
| `spec.maxUnavailable` | at most this many may be unavailable after an eviction; `0` blocks all | unset; exclusive with `minAvailable` |
| `spec.unhealthyPodEvictionPolicy` | `IfHealthyBudget` or `AlwaysAllow`: whether not-ready Pods may be evicted when the budget is exhausted | `IfHealthyBudget` when unset |
| `status.disruptionsAllowed` | how many more Pods may be evicted now (the ALLOWED DISRUPTIONS column) | computed by the disruption controller |
| `status.currentHealthy`, `desiredHealthy`, `expectedPods` | the numbers behind it | computed |

## kubectl

```bash
kubectl get pdb                                   # MIN AVAILABLE, ALLOWED DISRUPTIONS
kubectl describe pdb guarded                      # selector, current and desired healthy
kubectl drain cnlab-worker --ignore-daemonsets --delete-emptydir-data --timeout=120s
kubectl uncordon cnlab-worker                     # drain leaves the node cordoned
kubectl patch pdb guarded --type merge -p '{"spec":{"minAvailable":1}}'
kubectl get pods -l app=guarded -o wide           # where the replacements started
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubectl drain` repeats `error when evicting pods/"guarded-..." -n "default" (will retry after 5s): Cannot evict pod as it would violate the pod's disruption budget.` and ends with `global timeout reached` | `ALLOWED DISRUPTIONS` is 0: `minAvailable: 2` with only 2 replicas leaves no room | Add replicas, relax the budget (`minAvailable: 1`), or accept the downtime |
| `error: unable to drain node ...: cannot delete Pods that declare no controller (use --force to override)` (seen in an earlier run with two bare Pods on the node) | A Pod without a controller would not come back, so drain refuses it | Delete it yourself, or add `--force` knowing it will not be recreated |
| The Pods were lost anyway when a node died (documented, not reproduced) | A PDB covers only voluntary evictions through the Eviction API | Run replicas across nodes and zones; see the Topology spread card |

## Related

- **Cards:** Node maintenance and eviction, Deployment, Node, Upgrades and version skew
- **Chapter and lab:** Ch 5.5 and Lab 5.5
- **Exam:** CKA, Workloads and Scheduling (15%) and Cluster Architecture (25%), cluster lifecycle; no separate row in the coverage matrix
- **Source:** [Specifying a Disruption Budget](https://kubernetes.io/docs/tasks/run-application/configure-pdb/), [Disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)
