# kube-scheduler

## What and why

A new Pod has no node, and the cluster has many nodes with different free capacity, labels and taints. The **kube-scheduler** looks for Pods not yet bound to a node and assigns each to a suitable one ([components overview](https://kubernetes.io/docs/concepts/overview/components/)). It first **filters** out nodes that cannot run the Pod (not enough requested CPU or memory, a `nodeSelector` that does not match, a taint the Pod does not tolerate), then **scores** the rest, then **binds**.

Binding means creating a **Binding** object that sets the Pod's `spec.nodeName`. That is the whole job: the scheduler never starts a container, the kubelet on the chosen node does. Several scheduler replicas can run, but only the one holding the `kube-scheduler` Lease is active.

## Diagram

{{diagram kube-scheduler-01.jsx | Scheduling cycle · 5 steps, 2 exits}}
The scheduler watches for Pods without a node, picks one with filter and score steps, and records the choice by creating a Binding; it never starts containers itself.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). The scheduler is a static Pod; watch it place a Pod and refuse another:

```
$ kubectl -n kube-system get lease kube-scheduler -o jsonpath='{.spec.holderIdentity}'
cnlab-control-plane_a915c4e9-f42e-4959-b4ee-50059ad8fe0b
$ kubectl run sched --image=alpine:3.21 --command -- sleep 3600; sleep 6
$ kubectl get pod sched -o jsonpath='{.spec.nodeName} {.spec.schedulerName}'; kubectl events --for pod/sched
cnlab-control-plane default-scheduler
7s   Normal   Scheduled   Pod/sched   Successfully assigned x5/sched to cnlab-control-plane
6s   Normal   Started     Pod/sched   Container started
$ kubectl apply -f pend.yaml      # nodeSelector: {disk: ssd}
$ kubectl describe pod pending | sed -n '/^Events/,$p'
  Warning  FailedScheduling  7s  default-scheduler  0/1 nodes are available: 1 node(s) didn't match Pod's node affinity/selector. preemption: 0/1 nodes are available: 1 Preemption is not helpful for scheduling.
```

The **Binding** object is what the scheduler writes. You can write one yourself for a Pod that no scheduler has claimed (here `schedulerName: no-such-scheduler`):

```
$ kubectl create -f binding.yaml     # apiVersion: v1, kind: Binding, metadata.name: ghost, target: {kind: Node, name: cnlab-control-plane}
$ kubectl get pod ghost -o wide      # NODE is now cnlab-control-plane
$ kubectl create -f binding.yaml
Error from server (Conflict): ... Operation cannot be fulfilled on pods/binding "ghost": pod ghost is already assigned to node "cnlab-control-plane"
```

## Key fields

Scheduler settings are flags or a `--config` file in its static Pod manifest (`kube-scheduler --help`, 1.37.0); the Pod-side fields are the ones you set.

| Field or flag | Meaning | Default |
| --- | --- | --- |
| `Pod.spec.schedulerName` | Which scheduler handles the Pod | `default-scheduler` |
| `Pod.spec.nodeName` | Set by the scheduler; setting it yourself skips the scheduler (no `Scheduled` Event appeared in the test) | empty |
| `Pod.spec.nodeSelector` | Node labels required | none |
| `Pod.status.conditions[PodScheduled]` | `False`, reason `Unschedulable`, with the message | set by the scheduler |
| `Binding.target` | The node a Pod is bound to; creating it sets `spec.nodeName` | required |
| `--leader-elect` | Run leader election (Lease `kube-scheduler` in `kube-system`) | true |
| `--leader-elect-lease-duration` | Time before a stale leader is replaced | 15s |
| `--leader-elect-renew-deadline`, `--leader-elect-retry-period` | Renew window and retry interval | 10s, 2s |
| `--config` | Path to a KubeSchedulerConfiguration (profiles, plug-ins) | none; built-in defaults |

## kubectl

```
kubectl get pod <pod> -o wide                                   # NODE column: <none> while Pending
kubectl describe pod <pod>                                      # FailedScheduling message at the bottom
kubectl events --for pod/<pod>                                  # Scheduled / FailedScheduling
kubectl get pod <pod> -o jsonpath='{.status.conditions[?(@.type=="PodScheduled")]}'
kubectl -n kube-system logs kube-scheduler-<node>               # not run: scheduler's own log
kubectl -n kube-system get lease kube-scheduler                 # who is the active instance
kubectl cordon <node>     kubectl uncordon <node>               # make a node unschedulable / schedulable
kubectl create -f binding.yaml                                  # manual bind of an unscheduled Pod
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Pending`, `NODE <none>`, `FailedScheduling: 0/1 nodes are available: 1 node(s) didn't match Pod's node affinity/selector. ...`; condition `PodScheduled=False`, reason `Unschedulable` | The Pod's `nodeSelector` (`disk: ssd`) matches no node | Label a node or fix the selector; the scheduler retries on its own |
| After `kubectl cordon`: `FailedScheduling: 0/1 nodes are available: 1 node(s) were unschedulable. ...`; after `kubectl uncordon` the same Pod ran within about 10 s | A cordoned node is marked unschedulable | `kubectl uncordon <node>` |
| `Error from server (Conflict): ... pod ghost is already assigned to node "cnlab-control-plane"` | A second Binding for a Pod that already has a node | A Pod is bound once; delete and re-create the Pod to move it |

## Related

- **Cards:** Pod; kubelet; Requests, limits and QoS, Taints, tolerations and affinity, Topology spread constraints, PriorityClass and preemption (group 7); Lease (group 2); Event (group 2).
- **Chapter and lab:** Chapter 5.4 and Lab 5.4 (Vol 5).
- **Exam domain:** CKA Troubleshooting: cluster components; CKA Workloads and Scheduling: Pod admission and scheduling (through the group 7 cards).
