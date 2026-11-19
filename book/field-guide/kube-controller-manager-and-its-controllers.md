# kube-controller-manager and its controllers

## What and why

You declare what you want (3 replicas, a finished Job, a deleted namespace); something must keep making it true. A **controller** is a control loop that watches the shared state through the API server and makes changes that move the current state toward the desired state. The **kube-controller-manager** runs the built-in controllers as goroutines in one process ([components overview](https://kubernetes.io/docs/concepts/overview/components/)).

That one process contains the Deployment, ReplicaSet, StatefulSet, DaemonSet, Job and CronJob controllers, the node lifecycle controller (marks silent nodes NotReady), the EndpointSlice controller, the garbage collector, the namespace and ServiceAccount controllers and more. The workload cards in group 3 each name the controller here that acts on them. Only the instance holding the `kube-controller-manager` Lease runs its loops.

## Diagram

{{diagram kube-controller-manager-and-its-controllers-01.jsx | kube-controller-manager · 6 of many loops}}
The controller manager is one binary that hosts dozens of independent control loops; the six shown are examples, not the full list.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). Like the API server, it is a static Pod. Find who is the active instance and what it is started with:

```
$ kubectl -n kube-system get lease kube-controller-manager -o jsonpath='{.spec.holderIdentity}'
cnlab-control-plane_f9bc0c55-0326-447e-9afb-71c7ec1acf82
$ kubectl -n kube-system get pod kube-controller-manager-cnlab-control-plane -o jsonpath='{range .spec.containers[0].command[*]}{@}{"\n"}{end}' | grep -E 'controllers|leader|cluster-cidr|service-account'
--cluster-cidr=10.244.0.0/16
--controllers=*,bootstrapsigner,tokencleaner
--leader-elect=true
--use-service-account-credentials=true
```

The `holderIdentity` is the node name plus a per-process UUID. To see the controllers at work, stop the manager (see the failures table) and scale a Deployment.

## Key fields

Settings are command-line flags in the static Pod manifest. Defaults are from `kube-controller-manager --help` on 1.37.0 and the manifest of this cluster.

| Flag | Meaning | Default |
| --- | --- | --- |
| `--controllers` | Which controllers to run (`*` = all on by default, `-name` disables one) | `*`; kubeadm also enables `bootstrapsigner` and `tokencleaner` |
| `--leader-elect` | Take a Lease before running (needed when several replicas run) | true |
| `--leader-elect-lease-duration` | How long a non-leader waits before taking over a stale leader | 15s |
| `--leader-elect-renew-deadline` | Leader's window to renew before it stops leading | 10s |
| `--node-monitor-grace-period` | How long a silent node stays Ready before it is marked unhealthy | 50s |
| `--terminated-pod-gc-threshold` | Finished Pods kept before the Pod garbage collector deletes them | 12500 |
| `--concurrent-deployment-syncs`, `--concurrent-replicaset-syncs`, `--concurrent-job-syncs`, `--concurrent-statefulset-syncs` | Objects each controller syncs in parallel | 5 each |
| `--concurrent-gc-syncs` | Garbage collector workers | 20 |
| `--use-service-account-credentials` | Give each controller its own ServiceAccount identity | false; kubeadm sets true |

## kubectl

```
kubectl -n kube-system get pod -l component=kube-controller-manager
kubectl -n kube-system logs kube-controller-manager-<node>          # errors from any controller
kubectl -n kube-system get lease kube-controller-manager -o yaml     # who is leader, last renew
kubectl get events -A --field-selector reportingComponent=deployment-controller   # not run
kubectl events --for deployment/web                                  # events written by the Deployment controller
kubectl get events.events.k8s.io -o jsonpath='{.items[*].reportingController}'     # which controllers emit events
```

## How it fails

Row one was reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| With the manager's manifest moved away, `kubectl scale deploy cm-demo --replicas=4` succeeds but `kubectl get deploy cm-demo` stays at `UP-TO-DATE 2` and only 2 Pods exist; 40 seconds after the manifest was restored it showed `4/4` | The Deployment (and ReplicaSet) controllers live in this process; the API accepted the new `spec` but nothing acts on it | Restore the manager; check `kubectl -n kube-system get pod -l component=kube-controller-manager` and its logs |
| Nodes stay Ready after a node dies, Pods are not evicted (not reproduced) | The node lifecycle controller is not running or its Lease was lost | Check the manager's logs and the `kube-controller-manager` Lease |
| Two managers fight or none acts after an upgrade (not reproduced) | Leader election: `--leader-elect` mismatch or a stale Lease | Look at `holderIdentity` and `renewTime` of the Lease; the lease expires after 15s without renewal |

## Related

- **Cards:** kube-apiserver; cloud-controller-manager; Deployment, ReplicaSet, Job, StatefulSet, DaemonSet; Owner references and garbage collection; Lease; Operators and custom controllers (group 10).
- **Chapter and lab:** Chapters 5.1 and 5.5, Lab 5.1 (Vol 5).
- **Exam domain:** CKA Troubleshooting: cluster components.
