# Node

## What and why

A Node is a machine (VM or physical) that runs Pods; the API object records its identity, capacity and health. The **kubelet** registers the Node and keeps its `status` current: conditions (`Ready`, `MemoryPressure`, `DiskPressure`, `PIDPressure`), `capacity` and `allocatable` for CPU, memory and Pods, addresses and system info. It also renews a small Lease in the `kube-node-lease` namespace as a heartbeat.

The **node lifecycle controller** watches those heartbeats. When they stop for the grace period (default 50 s, `--node-monitor-grace-period`) it sets `Ready` to `Unknown` and adds the taint `node.kubernetes.io/unreachable`. The **scheduler** places Pods only on Nodes that are schedulable; `kubectl cordon` sets `spec.unschedulable` to stop new placements without touching running Pods.

## Diagram

{{diagram node-01.jsx | node health path · 6 boxes}}

The kubelet renews its Lease; when it stops, the lifecycle controller marks the Node Unknown, taints it, and evicts Pods.

## Minimal example

Tested on kind v0.33.0 (three nodes) with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). A Node object is created by the kubelet, not by you; you read it:

```
$ kubectl describe node cnlab-worker          # trimmed
Taints:             <none>
Unschedulable:      false
Conditions:
  Type             Status  Reason                       Message
  MemoryPressure   False   KubeletHasSufficientMemory   kubelet has sufficient memory available
  DiskPressure     False   KubeletHasNoDiskPressure     kubelet has no disk pressure
  PIDPressure      False   KubeletHasSufficientPID      kubelet has sufficient PID available
  Ready            True    KubeletReady                 kubelet is posting ready status
Capacity:    cpu: 12   memory: 7992076Ki   pods: 110   ephemeral-storage: 1081101176832
Allocatable: cpu: 12   memory: 7992076Ki   pods: 110   ephemeral-storage: 1081101176832

$ kubectl get lease cnlab-worker -n kube-node-lease -o jsonpath='{.spec}'
{"holderIdentity":"cnlab-worker","leaseDurationSeconds":40,"renewTime":"2026-11-16T08:48:51.522543Z"}
```

Cordon stops new Pods without touching running ones:

```
$ kubectl cordon cnlab-worker2; kubectl get nodes
NAME                STATUS                     ROLES    AGE
cnlab-worker2       Ready,SchedulingDisabled   <none>   5m6s
$ kubectl get node cnlab-worker2 -o jsonpath='{.spec.taints}'
[{"effect":"NoSchedule","key":"node.kubernetes.io/unschedulable","timeAdded":"2026-11-16T08:48:52Z"}]
```

Capacity and allocatable are equal here because kind nodes are containers that see the whole host; on a real node, reserved system resources make allocatable smaller.

## Key fields

Checked with `kubectl explain node` on 1.37 and the live objects above.

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.unschedulable` | `true` after `kubectl cordon`: no new Pods are scheduled | `false` |
| `spec.taints[]` | `key`, `value`, `effect` (`NoSchedule`, `PreferNoSchedule`, `NoExecute`); controllers and admins add them | none on a healthy worker |
| `spec.podCIDR`, `spec.providerID` | the Pod address range given to the node; the cloud's ID for the machine | set at registration |
| `status.capacity` | total CPU, memory, Pods, ephemeral storage | reported by the kubelet |
| `status.allocatable` | what Pods can use after system reservations | reported by the kubelet |
| `status.conditions[]` | `Ready`, `MemoryPressure`, `DiskPressure`, `PIDPressure`, each `True`, `False` or `Unknown` | reported by the kubelet |
| `status.addresses`, `status.nodeInfo` | IPs and host name; kernel, OS, runtime and kubelet versions | reported by the kubelet |
| Lease in `kube-node-lease` | `holderIdentity`, `leaseDurationSeconds`, `renewTime`: a lightweight heartbeat, renewed about every 10 s, much cheaper than rewriting the Node status, which the kubelet posts on change or every 5 min ([Node status: Heartbeats](https://kubernetes.io/docs/reference/node/node-status/#heartbeats)) | 40 s duration (observed) |

## kubectl

```bash
kubectl get nodes -o wide                         # STATUS, VERSION, INTERNAL-IP, RUNTIME
kubectl describe node cnlab-worker                # Conditions, Capacity, Allocatable, Taints, Pods
kubectl get lease -n kube-node-lease              # one heartbeat object per node
kubectl cordon cnlab-worker2                      # stop new Pods
kubectl uncordon cnlab-worker2
kubectl get node cnlab-worker2 -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.reason}: {.message}{"\n"}{end}'
kubectl taint nodes cnlab-worker dedicated=gpu:NoSchedule   # add a taint
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `NotReady`; every condition reads `Unknown NodeStatusUnknown: Kubelet stopped posting node status.`; taints `node.kubernetes.io/unreachable` (`NoSchedule` and `NoExecute`) appear. Reproduced with `systemctl stop kubelet` inside the node container: it flipped after about 60 s | The kubelet stopped heartbeating, so after the grace period (default 50 s) the node lifecycle controller marked the node Unknown | On the node: `systemctl status kubelet`, `journalctl -u kubelet`; start it (here `systemctl start kubelet`) |
| `Ready,SchedulingDisabled`; new Pods do not land there | Someone ran `kubectl cordon` or `kubectl drain`; the taint `node.kubernetes.io/unschedulable:NoSchedule` was added | `kubectl uncordon <node>` |
| `MemoryPressure`, `DiskPressure` or `PIDPressure` is `True` (documented, not reproduced) | The kubelet saw a resource running out and evicts Pods to recover | Free or add resources; check requests and limits (Requests, limits and QoS card) |

## Related

- **Cards:** kubelet, Lease, Taints, tolerations and affinity, Node maintenance and eviction, Troubleshooting playbook
- **Chapter and lab:** Ch 5.1 and Lab 5.1
- **Exam:** CKA, Troubleshooting (30%): clusters and nodes
- **Source:** [Nodes](https://kubernetes.io/docs/concepts/architecture/nodes/), [kube-controller-manager flags](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/)
