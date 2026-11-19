# Cluster Autoscaler and Karpenter (add-on)

## What and why

Cluster Autoscaler and Karpenter are add-ons that add and remove nodes: they scale up when Pods are Pending because nothing fits, and scale down when nodes sit under-used. The HPA and VPA change Pods; only a node autoscaler changes how much hardware exists.

**Acts on it:** the autoscaler watches Pods and Nodes through the API and calls your cloud provider's API. The kube-scheduler then binds the Pending Pods to the new node. Neither runs on kind, so this card has no tested example.

## Diagram

{{diagram cluster-autoscaler-and-karpenter-add-on-01.jsx | Node scale-up from a Pending Pod · 5 steps}}

The signal is a Pending Pod, not high CPU; nodes are added only when Pods cannot be placed.

## Minimal example

**Not run end to end: kind has no node groups to grow.** Cluster Autoscaler and Karpenter create machines through a cloud API, and a kind node is a local container. What was run on kind v0.33.0 (node image `kindest/node:v1.37.0`, 2026-11-17) is the signal both tools act on: a Pod the scheduler cannot place. The Karpenter and Cluster Autoscaler settings below are from the project documentation (Cluster Autoscaler [FAQ](https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/FAQ.md), Karpenter [NodePools](https://karpenter.sh/docs/concepts/nodepools/)) and are marked as targeted.

```text
$ kubectl -n tb run big --image=busybox:1.37 --overrides='{... "requests":{"cpu":"64","memory":"1Gi"} ...}' -- sleep 3600
$ kubectl -n tb get pod big
NAME   READY   STATUS    RESTARTS   AGE
big    0/1     Pending   0          6s
$ kubectl -n tb get events --field-selector reason=FailedScheduling -o jsonpath='{.items[0].message}'
0/2 nodes are available: 1 Insufficient cpu, 1 node(s) had untolerated taint(s). preemption: 0/2 nodes are available: 2 Preemption is not helpful for scheduling.
```

On a cloud cluster, Cluster Autoscaler sees that Pod (it scans every 10 s), finds a node group whose machine type would fit it, raises that group's size, and the Pod event changes to `TriggeredScaleUp`. Targeted configuration (not run):

```yaml
# Cluster Autoscaler: flags on its own Deployment (cloud-provider specific; AWS auto-discovery shown)
command:
- ./cluster-autoscaler
- --cloud-provider=aws
- --node-group-auto-discovery=asg:tag=k8s.io/cluster-autoscaler/enabled,k8s.io/cluster-autoscaler/my-cluster
- --expander=least-waste
- --scale-down-utilization-threshold=0.5
- --scale-down-unneeded-time=10m
---
# Karpenter: no node groups; one NodePool says what it may create
apiVersion: karpenter.sh/v1
kind: NodePool
metadata: {name: default}
spec:
  template:
    spec:
      nodeClassRef: {group: karpenter.k8s.aws, kind: EC2NodeClass, name: default}
      requirements:
      - {key: karpenter.k8s.aws/instance-category, operator: In, values: [c, m, r]}
  disruption: {consolidationPolicy: WhenEmptyOrUnderutilized, consolidateAfter: 1m}
  limits: {cpu: "1000", memory: 1000Gi}
```

The values `--expander=least-waste`, `0.5` and `10m` are the documented defaults of the three flags; the tag names in `--node-group-auto-discovery` depend on the cloud (the FAQ lists AWS, GCE and Azure discoverers).

## Key fields

Values are from the Cluster Autoscaler FAQ and the Karpenter NodePool page (opened 2026-11-17). Neither tool is part of Kubernetes: Cluster Autoscaler is configured by flags, Karpenter by custom resources.

| Setting | Meaning | Default |
| --- | --- | --- |
| `--scan-interval` (CA) | How often CA looks for unschedulable Pods | `10s` |
| `--nodes=<min>:<max>:<group>` or `--node-group-auto-discovery` (CA) | Which node groups it may resize, and their limits | `[]` (none) |
| `--expander` (CA) | Which group to grow when several fit: `random`, `most-pods`, `least-waste`, `least-nodes`, `price`, `priority` | `least-waste` |
| `--scale-down-utilization-threshold` (CA) | A node below this utilization is a candidate to remove | `0.5` |
| `--scale-down-unneeded-time` (CA) | How long a node must stay a candidate | `10m0s` |
| Annotation `cluster-autoscaler.kubernetes.io/safe-to-evict: "false"` (on a Pod) | Blocks scale-down of the node that runs it; `"true"` overrides other blockers | unset |
| `NodePool.spec.template.spec.requirements` (Karpenter) | Constraints on the nodes it may create (instance category, zone, capacity type) | none |
| `NodePool.spec.limits` (Karpenter) | Cap on total CPU and memory across the pool's nodes | none |
| `NodePool.spec.disruption.consolidationPolicy` / `consolidateAfter` (Karpenter) | When to remove or replace under-used nodes (`WhenEmptyOrUnderutilized`, `Balanced`, `WhenEmpty`) and the wait before it acts (`1m` or `Never`) | policy: not stated; `consolidateAfter`: `0s` |
| `NodeClaim` (Karpenter) | The record of one machine Karpenter asked the cloud for | created by Karpenter |

Karpenter's own description: it "manages each instance directly, without use of additional orchestration mechanisms like node groups" ([concepts](https://karpenter.sh/docs/concepts/)).

## kubectl

```bash
kubectl get pods -A --field-selector=status.phase=Pending      # the Pods that ask for more capacity
kubectl describe pod <pending-pod>                              # Events: FailedScheduling, then TriggeredScaleUp or NotTriggerScaleUp
kubectl get events -A --field-selector reason=FailedScheduling
kubectl get nodes -w                                            # new nodes appear; scale-down removes them
kubectl -n kube-system logs deploy/cluster-autoscaler           # why a group was or was not chosen (typical name)
kubectl -n kube-system get cm cluster-autoscaler-status -o yaml # status ConfigMap kept by CA (typical name)
kubectl annotate pod <pod> cluster-autoscaler.kubernetes.io/safe-to-evict=false   # protect a Pod from scale-down
kubectl get nodepools,nodeclaims                                # Karpenter, if installed
```

The Deployment and ConfigMap names in the last four lines depend on how the add-on was installed; they were not run here.

## How it fails

The first row was reproduced on kind; the other two are documented behaviour (CA FAQ), not reproduced, because there is no cloud to scale.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pod `Pending` for ever; `0/2 nodes are available: 1 Insufficient cpu, 1 node(s) had untolerated taint(s). preemption: 0/2 nodes are available: 2 Preemption is not helpful for scheduling.` and no node is added (reproduced) | No autoscaler is installed, or this one is not allowed to grow any group | Install and configure it; check `--nodes` or auto-discovery and that the group's max is above its current size |
| Pod `Pending`; event `NotTriggerScaleUp` ("CA couldn't find node group that can be scaled up to make this pod schedulable") | The Pod is too large for any machine type in the groups, its selectors or taints match no group, or every suitable group is at its maximum | Lower the Pod's requests, add a matching group or Karpenter requirement, raise the group maximum; a volume pinned to a full zone blocks scale-up for StatefulSets |
| Nodes stay although idle | Scale-down is blocked by a Pod with `safe-to-evict: "false"`, a restrictive PodDisruptionBudget, local storage (hostPath, or emptyDir not in memory), a kube-system Pod without a PDB, or a Pod with no controller | Remove the blocker or annotate the Pod `safe-to-evict: "true"`; the same reasons make `kubectl drain` stop (Node maintenance card); also wait the 10 minute `scale-down-unneeded-time` |

## Related

- **Cards:** Node, kube-scheduler, PriorityClass and preemption, PodDisruptionBudget, HorizontalPodAutoscaler.
- **Chapter and lab:** none; card only, add-on.
- **Exam:** not named in the CKA or CKAD v1.37 curriculum PDFs ([cncf/curriculum](https://github.com/cncf/curriculum), 2026-11-17); KCNA Cloud Native Architecture.
