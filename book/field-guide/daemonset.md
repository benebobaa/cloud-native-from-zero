# DaemonSet

## What and why

Some software must run on every node: a log collector, a node monitoring agent, a network plug-in. A **DaemonSet** states that rule once. The DaemonSet controller (in `kube-controller-manager`) creates one Pod for each node that matches the Pod's `nodeSelector`, affinity and tolerations, adds a Pod when a node joins and removes it when the node leaves.

Because the Pod must reach every node, a DaemonSet often needs tolerations for node taints, for example the control-plane taint. Template changes are rolled out node by node and recorded as ControllerRevisions.

## Diagram

{{diagram daemonset-01.jsx | DaemonSet placement · 1 Pod per node}}
The controller keeps the Pod count equal to the number of eligible nodes: it adds a Pod when a node joins and removes it when the node leaves.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). The cluster has one node, so one Pod appears.

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata: {name: node-agent}
spec:
  selector: {matchLabels: {app: node-agent}}
  updateStrategy: {type: RollingUpdate, rollingUpdate: {maxUnavailable: 1}}
  template:
    metadata: {labels: {app: node-agent}}
    spec:
      tolerations:
      - {key: node-role.kubernetes.io/control-plane, operator: Exists, effect: NoSchedule}
      containers:
      - {name: agent, image: "alpine:3.21", command: ["sleep","3600"]}
```

```
$ kubectl apply -f ds.yaml; sleep 8; kubectl get ds node-agent; kubectl get pods -l app=node-agent -o wide
NAME         DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE
node-agent   1         1         1       1            1           <none>          9s
node-agent-4l5xb   1/1   Running   0   9s   10.244.0.64   cnlab-control-plane
$ kubectl get pod -l app=node-agent -o jsonpath='{.items[0].metadata.ownerReferences[0].kind} {.items[0].spec.affinity}'
DaemonSet {"nodeAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":{"nodeSelectorTerms":[{"matchFields":[{"key":"metadata.name","operator":"In","values":["cnlab-control-plane"]}]}]}}}
$ kubectl get controllerrevisions
NAME                   CONTROLLER                  REVISION   AGE
node-agent-6f56f67c6   daemonset.apps/node-agent   1          10s
```

The controller pins each Pod to its node with a `nodeAffinity` on `metadata.name`; the scheduler then binds it. The toleration lets the Pod run on a tainted control-plane node in multi-node clusters.

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.selector` | Label query for the Pods it owns; must match template labels | required |
| `spec.template` | Pod template; its `nodeSelector`, affinity and tolerations decide which nodes get a Pod | required |
| `spec.updateStrategy.type` | `RollingUpdate` or `OnDelete` | `RollingUpdate` |
| `spec.updateStrategy.rollingUpdate.maxUnavailable` | Nodes whose Pod may be down during an update (number or %) | 1 |
| `spec.updateStrategy.rollingUpdate.maxSurge` | Nodes that may run an extra new Pod during an update | 0 |
| `spec.minReadySeconds` | Seconds a new Pod must be ready to count as available | 0 |
| `spec.revisionHistoryLimit` | Old revisions kept for rollback | 10 |

Defaults are from `kubectl explain` and the v1.37.0 OpenAPI spec.

## kubectl

```
kubectl apply -f ds.yaml
kubectl get ds node-agent                         # DESIRED = nodes that should run it
kubectl get pods -l app=node-agent -o wide        # which Pod is on which node
kubectl rollout status ds/node-agent
kubectl rollout history ds/node-agent
kubectl rollout undo ds/node-agent [--to-revision=2]
kubectl set image ds/node-agent agent=alpine:3.21
kubectl get controllerrevisions
kubectl describe ds node-agent                    # Events and node counts
kubectl delete ds node-agent --now
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `DESIRED 0 CURRENT 0`, `NODE SELECTOR disk=ssd`; the existing Pod went `Terminating` | The template's `nodeSelector` (`disk=ssd`) matches no node, so no node is eligible | Label a node (`kubectl label node ... disk=ssd`) or fix the selector; `kubectl rollout undo ds/node-agent` restored the Pod (`DESIRED 1`) |
| `DESIRED 1 CURRENT 1 READY 0`; the Pod is `ImagePullBackOff` (image `alpine:no-such-tag`) | The image cannot be pulled on that node | `kubectl set image ds/badds c=alpine:3.21`: the rollout then finished (`successfully rolled out`) |
| `error: unable to find specified revision 99 in history` (from `kubectl rollout undo ds/node-agent --to-revision=99`) | That revision is not stored | Check `kubectl rollout history ds/node-agent` first |

## Related

- **Cards:** Pod; Taints, tolerations and affinity (group 7); ControllerRevision and PodTemplate; Node (group 7); CNI and CSI plug-ins and kube-proxy (group 1, usually run as DaemonSets).
- **Chapter and lab:** Chapter 5.2 and Lab 5.2 (Vol 5).
- **Exam domain:** KCNA Kubernetes Fundamentals; CKAD Application Design and Build, choose a workload resource.
