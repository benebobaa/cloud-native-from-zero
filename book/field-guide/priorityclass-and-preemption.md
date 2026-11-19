# PriorityClass and preemption

## What and why

A PriorityClass maps a name to an integer priority. A Pod that names it in `spec.priorityClassName` gets that number in `spec.priority`. Priority answers: when the cluster is full, whose work matters more?

The **kube-scheduler** orders its queue by priority. When a high-priority Pod cannot fit anywhere, it can **preempt**: pick a node, delete enough lower-priority Pods there, and place the new Pod. A class with `preemptionPolicy: Never` queues ahead of others but never evicts. User classes may use values up to 1,000,000,000; larger values are reserved for system classes such as `system-cluster-critical` (2,000,000,000 in v1.37). `globalDefault: true` sets the class for Pods that name none.

## Diagram

{{diagram priorityclass-and-preemption-01.jsx | preemption · 6 steps}}

Follow the numbers: preemption makes room for a Pending high-priority Pod by deleting lower-priority victims.

## Minimal example

Tested on kind v0.33.0 (three nodes; the worker has 12 CPUs) with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). Three classes, then a full node:

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata: {name: low}
value: 1000
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata: {name: high}
value: 100000
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata: {name: high-nopreempt}
value: 100000
preemptionPolicy: Never
```

```
$ kubectl get priorityclass
NAME                      VALUE        GLOBAL-DEFAULT   PREEMPTIONPOLICY
high                      100000       false            PreemptLowerPriority
high-nopreempt            100000       false            Never
low                       1000         false            PreemptLowerPriority
system-cluster-critical   2000000000   false            PreemptLowerPriority
system-node-critical      2000001000   false            PreemptLowerPriority
```

Two `low` Pods (`priorityClassName: low`) each request 4800m CPU of the worker's 12000m and run. A `high` Pod asking for 4800m does not fit, so the scheduler preempts one of them:

```
$ kubectl get pods -o wide | grep -E 'NAME|low|high'      # 12 s after creating high-1
NAME     READY   STATUS        NODE               NOMINATED NODE
high-1   0/1     Pending       <none>             cnlab-worker
low-1    1/1     Running       cnlab-worker       <none>
low-2    1/1     Terminating   cnlab-worker       <none>

$ kubectl get events --field-selector reason=Preempted -o custom-columns=REASON:.reason,OBJECT:.involvedObject.name,MESSAGE:.message
Preempted   low-2   Preempted by pod 6d1dd034-4d97-49ec-bdad-00e874940f23 on node cnlab-worker

$ kubectl get pod high-1 -o jsonpath='{.status.nominatedNodeName} {.spec.priority}'
cnlab-worker 100000
```

The victim terminates gracefully; the new Pod starts once the space is free.

## Key fields

Checked with `kubectl explain priorityclass` and the live objects on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| PriorityClass `value` | the priority; user classes up to 1,000,000,000 | required |
| `preemptionPolicy` | `PreemptLowerPriority` or `Never` (queue first, never evict) | `PreemptLowerPriority` |
| `globalDefault` | `true` makes it the class of Pods that name none; at most one class | `false` |
| `description` | free text for humans | none |
| Pod `spec.priorityClassName` | the class to use; admission copies the number to `spec.priority` | none: the global default class or priority 0 |
| Pod `status.nominatedNodeName` | the node the scheduler reserved for a preemptor | unset |
| built-in classes | `system-cluster-critical` (2000000000) and `system-node-critical` (2000001000) in v1.37 | present in every cluster |

## kubectl

```bash
kubectl get priorityclass                    # VALUE, GLOBAL-DEFAULT, PREEMPTIONPOLICY
kubectl get pod high-1 -o jsonpath='{.status.nominatedNodeName} {.spec.priority}{"\n"}'
kubectl get events --field-selector reason=Preempted     # who was evicted, and by which Pod
kubectl describe pod high-nopreempt           # why it stays Pending
kubectl get pods -o custom-columns=NAME:.metadata.name,PRIORITY:.spec.priority,NODE:.spec.nodeName
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `The PriorityClass "too-high" is invalid: value: Forbidden: maximum allowed value of a user defined priority is 1000000000` | Values above 1,000,000,000 are reserved for system classes | Use a value up to 1,000,000,000 |
| `pods "p-noclass" is forbidden: no PriorityClass with name nope was found` | The Pod names a class that does not exist | Create the class first, or fix the name |
| A `high-nopreempt` Pod stays `Pending` while `low-1` and `low-2` keep running | `preemptionPolicy: Never` queues the Pod ahead of lower ones but never evicts them; the FailedScheduling event ends with: preemption: not eligible due to preemptionPolicy=Never. | Free capacity yourself, or use a class that may preempt |

## Related

- **Cards:** kube-scheduler, Requests, limits and QoS, ResourceQuota, PodDisruptionBudget
- **Chapter and lab:** Ch 5.4 and Lab 5.4
- **Exam:** CKA, Workloads and Scheduling (15%): Pod admission and scheduling
- **Source:** [Pod Priority and Preemption](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/)
