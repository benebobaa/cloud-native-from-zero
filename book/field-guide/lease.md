# Lease

## What and why

A distributed system needs cheap answers to two questions: "is that node still alive?" and "which of these replicas is in charge?". A **Lease** (`coordination.k8s.io/v1`) answers both: a tiny object holding a `holderIdentity`, a `leaseDurationSeconds` and a `renewTime`. The holder keeps updating `renewTime`; if it stops for longer than the duration, anyone else may take over.

Two built-in uses. The kubelet renews one Lease per node in the `kube-node-lease` namespace as its heartbeat, and the node lifecycle controller watches it. The scheduler and controller manager (and many operators) use a Lease for leader election, so only one replica acts at a time. Leases are small on purpose: etcd stores the whole object on every write, so renewing a small Lease costs less than rewriting a large Node object ([KEP-589, efficient node heartbeats](https://github.com/kubernetes/enhancements/blob/master/keps/sig-node/589-efficient-node-heartbeats/README.md); [Leases](https://kubernetes.io/docs/concepts/architecture/leases/)).

## Diagram

{{diagram lease-01.jsx | Two uses of Lease · heartbeat and election}}
A Lease holds a holder name and a renew time; whoever stops renewing loses the claim, which is how a dead node or a dead leader is noticed.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). The cluster already holds Leases; read two, then create your own:

```
$ kubectl get leases -A
NAMESPACE         NAME                      HOLDER                                                          AGE
kube-node-lease   cnlab-control-plane       cnlab-control-plane                                             3m7s
kube-system       apiserver-vdxjkyletneg5...  apiserver-vdxjkyletneg5dfnjwdggpoly4_ba869552-...             3m14s
kube-system       kube-controller-manager   cnlab-control-plane_853be6a6-cca9-47f1-a1d3-3b03992f56d9    3m10s
kube-system       kube-scheduler            cnlab-control-plane_a915c4e9-f42e-4959-b4ee-50059ad8fe0b    3m9s
$ kubectl -n kube-system get lease kube-scheduler -o yaml | grep -E 'acquireTime|holder|leaseDuration|leaseTransitions|renewTime'
  acquireTime: "2026-11-16T08:15:00.985286Z"
  holderIdentity: cnlab-control-plane_a915c4e9-f42e-4959-b4ee-50059ad8fe0b
  leaseDurationSeconds: 15
  leaseTransitions: 0
  renewTime: "2026-11-16T08:18:10.167523Z"
$ kubectl -n kube-node-lease get lease -o jsonpath='{.items[0].spec.leaseDurationSeconds} {.items[0].metadata.ownerReferences[0].kind} {.items[0].spec.renewTime}'; sleep 12; kubectl -n kube-node-lease get lease -o jsonpath='{.items[0].spec.renewTime}'
40 Node 2026-11-16T08:18:07.292337Z
2026-11-16T08:18:17.454707Z
```

The node Lease is owned by its Node (deleting the Node deletes it) and renewed about every 10 seconds. The scheduler's Lease has a 15 second duration and `leaseTransitions: 0`, meaning leadership has never changed hands.

## Key fields

Field meanings are from the v1.37.0 OpenAPI spec (`LeaseSpec`).

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.holderIdentity` | Who holds the lease now | unset |
| `spec.leaseDurationSeconds` | How long candidates must wait, measured from the last observed `renewTime`, before they may take the lease; must be greater than 0 | unset |
| `spec.renewTime` | When the holder last renewed | unset |
| `spec.acquireTime` | When the current holder got it | unset |
| `spec.leaseTransitions` | How many times the lease changed holder | unset |
| `spec.strategy`, `spec.preferredHolder` | [Coordinated leader election](https://kubernetes.io/docs/concepts/cluster-administration/coordinated-leader-election/) (beta since v1.33, disabled by default; needs the `CoordinatedLeaderElection` feature gate) | off |
| Node Lease (`kube-node-lease`) | Duration 40 s here; the kubelet's `nodeLeaseDurationSeconds` | 40 |
| controller-manager and scheduler `--leader-elect-lease-duration` | Duration for their election Lease | 15s |

## kubectl

```
kubectl get leases -A                                   # every Lease and its holder
kubectl -n kube-system get lease kube-scheduler -o yaml
kubectl -n kube-node-lease get lease <node> -o jsonpath='{.spec.renewTime}'   # node heartbeat
kubectl -n kube-system get lease kube-controller-manager -o jsonpath='{.spec.holderIdentity}'
kubectl apply -f lease.yaml                             # create your own
kubectl explain lease.spec                              # field reference
kubectl delete lease my-leader
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Node `NotReady` with `Ready=Unknown NodeStatusUnknown: Kubelet stopped posting node status.`; the node Lease `renewTime` was `08:23:42` while the clock read `08:25:08` | The kubelet stopped, so it stopped renewing its Lease and the node lifecycle controller acted on the silence | Fix the kubelet (see the kubelet card); the Lease resumes when it runs |
| `The Lease "bad-lease" is invalid: spec.leaseDurationSeconds: Invalid value: -5: must be greater than 0` | An invalid duration | Use a positive number of seconds |
| A Lease created with `renewTime` hours in the past is still listed (`my-leader   worker-1`) | A Lease does not expire by itself; holders and candidates compare `renewTime` plus the duration with the current time and decide | Do not treat "object exists" as "holder alive"; delete stale Leases you created |

## Related

- **Cards:** kubelet; Node (group 7); kube-scheduler; kube-controller-manager and its controllers; Operators and custom controllers (group 10).
- **Chapter and lab:** Chapter 5.1 and Lab 5.1 (Vol 5); highly available control planes are in Chapters 3.2 and 5.5.
- **Exam domain:** KCNA Kubernetes Fundamentals.
