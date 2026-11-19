# Node maintenance and eviction

## What and why

Node maintenance takes a node out of service safely. Cordon marks it unschedulable, drain evicts its Pods so controllers recreate them elsewhere, and uncordon puts it back. It exists so a reboot or upgrade does not kill workloads abruptly.

**Acts on it:** kubectl calls the Eviction API on the kube-apiserver, which checks PodDisruptionBudgets; the workload controllers recreate the Pods.

## Diagram

{{diagram node-maintenance-and-eviction-01.jsx | Node maintenance cycle · 5 steps}}

Draining moves work: each evicted Pod is deleted and its controller creates a replacement on another node.

## Minimal example

Tested on kind v0.33.0 (control plane plus 1 worker), node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-17). The worker runs two replicas of `api` (guarded by a PodDisruptionBudget with `minAvailable: 2`), a `cache` Deployment with an `emptyDir`, and a bare Pod. Both Deployments tolerate the control-plane taint, so they can move there.

```text
$ kubectl cordon cnlab-worker
node/cnlab-worker cordoned
$ kubectl get nodes
NAME                       STATUS                     ROLES           AGE   VERSION
cnlab-control-plane        Ready                      control-plane   36m   v1.37.0
cnlab-worker               Ready,SchedulingDisabled   <none>          35m   v1.37.0
$ kubectl get node cnlab-worker -o jsonpath='{.spec.unschedulable} {.spec.taints}'
true [{"effect":"NoSchedule","key":"node.kubernetes.io/unschedulable","timeAdded":"2026-11-17T05:20:34Z"}]
$ kubectl -n maint get pods -l app=cache -o wide       # after: kubectl scale deploy cache --replicas=2
NAME                     READY   STATUS              NODE
cache-6bfcbf9f88-tjp97   1/1     Running             cnlab-worker
cache-6bfcbf9f88-tpsp5   0/1     ContainerCreating   cnlab-control-plane
$ kubectl drain cnlab-worker --ignore-daemonsets --delete-emptydir-data --timeout=120s   # bare Pod deleted by hand, PDB relaxed to 1
...
pod/api-7f74d4bcb9-xnwwq evicted
node/cnlab-worker drained
$ kubectl -n maint get pods -o wide
NAME                     READY   STATUS    RESTARTS   AGE     NODE
api-7f74d4bcb9-8dbfx     1/1     Running   0          3s      cnlab-control-plane
api-7f74d4bcb9-r2hwx     1/1     Running   0          29s     cnlab-control-plane
cache-6bfcbf9f88-tpsp5   1/1     Running   0          3m43s   cnlab-control-plane
$ kubectl uncordon cnlab-worker
node/cnlab-worker uncordoned
```

`cordon` only marks the node unschedulable (the `unschedulable` taint is added automatically); running Pods stay. `drain` cordons, then evicts each Pod through the Eviction API, so Deployments create replacements elsewhere. Evicted Pods are not moved: they are deleted and recreated, and a bare Pod is simply gone.

## Key fields

The flags are from `kubectl drain --help` (v1.37.1); the node fields were observed in the test above.

| Field or flag | Meaning | Default |
| --- | --- | --- |
| `node.spec.unschedulable` | `true` after `cordon`: the scheduler places no new Pods | false |
| taint `node.kubernetes.io/unschedulable:NoSchedule` | Added with `unschedulable`; a Pod with a matching toleration (DaemonSets have one) can still run | none |
| `--ignore-daemonsets` | Skip DaemonSet-managed Pods instead of failing | false |
| `--delete-emptydir-data` | Allow deleting Pods that use `emptyDir` (the data is lost) | false |
| `--force` | Also delete Pods that no controller will recreate | false |
| `--timeout` | How long drain keeps waiting (`0s` = for ever) | `0s` |
| `--grace-period` | Seconds for Pods to stop; `-1` uses each Pod's own value | `-1` |
| `--pod-selector` | Only evict Pods that match the label selector | all |
| `--disable-eviction` | Delete Pods directly and ignore PodDisruptionBudgets (dangerous) | false |
| `--dry-run` | `none`, `client` or `server` | `none` |
| PodDisruptionBudget `spec.minAvailable` / `maxUnavailable` | Limit how many Pods of a set an eviction may remove | none |

See [Safely drain a node](https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/) for the procedure and the eviction behaviour.

## kubectl

```bash
kubectl cordon <node>                                   # stop new Pods (running Pods stay)
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data --timeout=300s
kubectl drain <node> --ignore-daemonsets --dry-run=server     # see what would be evicted
kubectl uncordon <node>                                 # allow scheduling again
kubectl get nodes                                       # STATUS ...SchedulingDisabled
kubectl get pods -A -o wide --field-selector spec.nodeName=<node>
kubectl get pdb -A                                      # ALLOWED DISRUPTIONS = 0 blocks a drain
kubectl describe node <node> | sed -n '/Taints/,/Unschedulable/p'
```

## How it fails

All rows were reproduced on the test cluster; the drain errors are the first three commands in order.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `error: unable to drain node "cnlab-worker" due to error: [cannot delete Pods that declare no controller (use --force to override): maint/bare, cannot delete DaemonSet-managed Pods (use --ignore-daemonsets to ignore): kube-system/kindnet-4pq57, kube-system/kube-proxy-fdvw4, cannot delete Pods with local storage (use --delete-emptydir-data to override): kube-system/metrics-server-76558b4bb9-9crkr, maint/cache], continuing command...` | A plain `drain` refuses three kinds of Pod: ones with no controller, DaemonSet Pods, and Pods with `emptyDir` | Add `--ignore-daemonsets` and `--delete-emptydir-data` (each message disappeared as its flag was added); for the bare Pod decide: delete it by hand or use `--force` and accept that it will not come back |
| `error when evicting pods/"api-7f74d4bcb9-dz9nh" -n "maint" (will retry after 5s): Cannot evict pod as it would violate the pod's disruption budget.` repeated; `kubectl get pdb` shows `ALLOWED DISRUPTIONS 0` | The PodDisruptionBudget (`minAvailable: 2`, two replicas) allows no voluntary disruption, so the drain waits for ever | Raise `replicas` or lower `minAvailable`; after the PDB was set to 1 the drain finished (`node/... drained`) one Pod at a time |
| `kubectl -n maint run newpod ...` pinned to the cordoned node stays `Pending`; event `0/2 nodes are available: 1 node(s) had untolerated taint(s), 1 node(s) were unschedulable. preemption: 0/2 nodes are available: 2 Preemption is not helpful for scheduling.` | The node is cordoned (and the other node is tainted), so a Pod that can run only there cannot be placed | Uncordon when maintenance ends; do not pin Pods to one node with `nodeSelector` |

A node is not uncordoned by itself: forgetting `kubectl uncordon` leaves it `Ready,SchedulingDisabled`.

## Related

- **Cards:** PodDisruptionBudget (group 7), Node (group 7), Taints, tolerations and affinity (group 7), DaemonSet (group 3), Upgrades and version skew.
- **Chapter and lab:** 5.5.
- **Exam:** CKA Troubleshooting (30%): troubleshoot clusters and nodes; CKA Cluster Architecture (25%): cluster lifecycle.
