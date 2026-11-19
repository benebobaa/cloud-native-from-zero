# Taints, tolerations and affinity

## What and why

Taints repel Pods, tolerations let a Pod ignore a taint, and affinity attracts Pods. Together they decide where a Pod may or must run. A taint on a Node (`key=value:effect`) keeps Pods away unless they tolerate it. Effects: `NoSchedule` (no new Pods), `PreferNoSchedule` (try to avoid) and `NoExecute` (also evicts running Pods). `nodeSelector` and node affinity pick Nodes by label; pod affinity and anti-affinity place a Pod near to, or away from, other Pods within a `topologyKey` such as the node or zone.

The **kube-scheduler** applies these as filters (hard rules) and scores (soft preferences). The **node lifecycle controller** adds taints such as `node.kubernetes.io/not-ready` to unhealthy Nodes, and Pods without a matching toleration are evicted.

## Diagram

{{diagram taints-tolerations-and-affinity-01.jsx | scheduler filters · 6 boxes}}

The scheduler drops nodes at each filter and scores the survivors.

## Minimal example

Tested on kind v0.33.0 (control-plane plus two workers) with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). Taint one worker, then start three Pods that want it:

```
$ kubectl taint node cnlab-worker2 dedicated=gpu:NoSchedule
$ kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints[*].key
NAME                      TAINTS
cnlab-control-plane       node-role.kubernetes.io/control-plane
cnlab-worker              <none>
cnlab-worker2             dedicated
```

```yaml
# no-tol: wants worker2, no toleration            -> Pending
# with-tol: wants worker2 and tolerates the taint -> Running
apiVersion: v1
kind: Pod
metadata: {name: with-tol}
spec:
  nodeSelector: {kubernetes.io/hostname: cnlab-worker2}
  tolerations: [{key: dedicated, operator: Equal, value: gpu, effect: NoSchedule}]
  containers: [{name: c, image: alpine:3.21, command: [sleep, "3600"]}]
---
# affinity-miss: required node affinity that no node satisfies
apiVersion: v1
kind: Pod
metadata: {name: affinity-miss}
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms: [{matchExpressions: [{key: disk, operator: In, values: [ssd]}]}]
  containers: [{name: c, image: alpine:3.21, command: [sleep, "3600"]}]
```

```
$ kubectl get pod no-tol with-tol affinity-miss -o wide
NAME            READY   STATUS    NODE
no-tol          0/1     Pending   <none>
with-tol        1/1     Running   cnlab-worker2
affinity-miss   0/1     Pending   <none>
```

A Deployment whose Pods repel each other (`podAntiAffinity` required, `topologyKey: kubernetes.io/hostname`, 3 replicas) put one Pod on each of the two schedulable workers and left the third `Pending`; the control-plane node was closed to it by its own taint.

## Key fields

Checked with `kubectl explain pod.spec` and the live objects on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| Node `spec.taints[]` | `key`, `value`, `effect`: `NoSchedule`, `PreferNoSchedule`, `NoExecute` | none on a worker |
| Pod `spec.tolerations[]` | `key`, `operator` (`Equal` or `Exists`), `value`, `effect`, `tolerationSeconds` (for `NoExecute`) | admission adds `not-ready` and `unreachable` tolerations with `tolerationSeconds: 300` (observed) |
| `spec.nodeSelector` | node labels that must all match | none |
| `affinity.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution` | hard rule: `nodeSelectorTerms` with `matchExpressions` (`In`, `NotIn`, `Exists`, `Gt`, `Lt`...) | none |
| `...preferredDuringSchedulingIgnoredDuringExecution` | soft rule with a `weight` | none |
| `affinity.podAffinity` / `podAntiAffinity` | place near, or away from, Pods matching a `labelSelector` within a `topologyKey` | none |
| `kubectl taint` effect suffix `-` | removes a taint, for example `dedicated=gpu:NoSchedule-` | n/a |

## kubectl

```bash
kubectl taint node cnlab-worker2 dedicated=gpu:NoSchedule     # add
kubectl taint node cnlab-worker2 dedicated=gpu:NoSchedule-    # remove (note the trailing -)
kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints[*].key
kubectl describe pod no-tol | sed -n '/^Events/,$p'              # the per-node reasons
kubectl get pod with-tol -o wide                                 # where it landed
kubectl label node cnlab-worker disk=ssd                      # satisfy a node affinity
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pod `Pending`; event `0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 node(s) didn't match Pod's node affinity/selector. preemption: 0/3 nodes are available: 3 Preemption is not helpful for scheduling.` (a Pod that selects the control-plane node, which carries its own taint) | The Pod has no toleration for the node's taint | Add a matching toleration, or remove the taint |
| Pod `Pending`; event `0/3 nodes are available: 1 node(s) didn't match Pod's node affinity/selector, 2 node(s) had untolerated taint(s).` (`affinity-miss`, while the control-plane had its taint and one worker was cordoned) | No node carries the label `disk=ssd` the required affinity asks for; the scheduler reports the first filter each node failed | Label a node, or relax the rule to `preferred...` |
| The third replica of a Deployment with required `podAntiAffinity` on the host name stays `Pending` | There are only two schedulable nodes, and the rule allows one Pod per node | Lower replicas, add nodes, or use a preferred rule or topology spread constraints |

## Related

- **Cards:** Topology spread constraints, Node, kube-scheduler, Labels, selectors and annotations, DaemonSet (tolerates node taints by default)
- **Chapter and lab:** Ch 5.4 and Lab 5.4
- **Exam:** CKA, Workloads and Scheduling (15%): Pod admission and scheduling
- **Source:** [Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/), [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)
