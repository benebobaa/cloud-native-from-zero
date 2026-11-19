# Requests, limits and QoS

## What and why

Requests and limits tell Kubernetes how much CPU and memory a container needs and may use. A **request** is what the scheduler reserves when it picks a node; a **limit** is the ceiling the **kubelet** enforces through cgroups. CPU above the limit is throttled. Memory above the limit gets the container OOM-killed.

From the two, Kubernetes sets a QoS class on every Pod: `Guaranteed` (every container has CPU and memory requests equal to limits), `Burstable` (at least one request or limit) or `BestEffort` (none). When a node runs short of memory the kubelet evicts first the Pods whose usage exceeds their requests, ranked by Priority and then by how far over they are. The QoS class does not set that order but predicts it: BestEffort Pods have no request, so they are always over ([Node-pressure eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/)). Requests are also what ResourceQuota, LimitRange and the HorizontalPodAutoscaler count.

## Diagram

{{diagram requests-limits-and-qos-01.jsx | requests, limits and QoS · 6 boxes}}

Requests and limits together set the QoS class, which predicts who is evicted first under memory pressure.

## Minimal example

Tested on kind v0.33.0 (three nodes, the worker has 12 CPUs) with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). Three Pods that differ only in `resources`:

```yaml
# qos-guaranteed: requests equal limits for cpu and memory
resources: {requests: {cpu: 100m, memory: 64Mi}, limits: {cpu: 100m, memory: 64Mi}}
# qos-burstable: a request, no limit
resources: {requests: {cpu: 100m, memory: 64Mi}}
# qos-besteffort: no resources block at all
```

```
$ kubectl get pod -o custom-columns=NAME:.metadata.name,QOS:.status.qosClass,STATUS:.status.phase qos-guaranteed qos-burstable qos-besteffort
NAME             QOS          STATUS
qos-guaranteed   Guaranteed   Running
qos-burstable    Burstable    Running
qos-besteffort   BestEffort   Running
```

A memory limit is enforced by the kernel. A container that keeps allocating (`tail /dev/zero`) under a 32Mi limit is killed at once:

```
$ kubectl get pod oom -o jsonpath='{.status.containerStatuses[0].state.terminated}'
{"exitCode":137,"reason":"OOMKilled","startedAt":"2026-11-16T08:50:13Z","finishedAt":"2026-11-16T08:50:14Z"}
```

In 1.37 a running container's requests and limits can change in place through the `resize` subresource, as long as the QoS class stays the same:

```
$ kubectl patch pod qos-burstable --subresource resize --patch '{"spec":{"containers":[{"name":"c","resources":{"requests":{"cpu":"200m"}}}]}}'
pod/qos-burstable patched
$ kubectl get pod qos-burstable -o jsonpath='{.status.containerStatuses[0].resources}'
{"requests":{"cpu":"200m","memory":"64Mi"}}
```

## Key fields

Checked with `kubectl explain pod.spec.containers.resources` and related fields on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| `containers[].resources.requests` | CPU, memory, ephemeral-storage the scheduler reserves | none (BestEffort if nothing is set) |
| `containers[].resources.limits` | ceiling enforced by the kubelet: CPU throttled, memory OOM-killed | none |
| `containers[].resizePolicy[]` | per resource (`cpu`, `memory`): restart the container on resize or not | restartPolicy: NotRequired (resize without restarting the container) |
| `spec.overhead` | extra resources of the Pod's RuntimeClass; filled in by admission, never set by you | unset |
| `spec.resources` | Pod-level requests and limits; alpha per the explain text, behind the PodLevelResources feature gate | unset |
| `status.qosClass` | `Guaranteed`, `Burstable` or `BestEffort`; derived at creation and fixed | set by the API server |
| CPU units | `1` is one core, `100m` is a tenth of a core | n/a |
| memory units | `64Mi` is 64 mebibytes; `64M` is 64 megabytes | n/a |

## kubectl

```bash
kubectl get pod -o custom-columns=NAME:.metadata.name,QOS:.status.qosClass,STATUS:.status.phase
kubectl describe pod too-big                  # FailedScheduling event with the reason per node
kubectl get pod oom -o jsonpath='{.status.containerStatuses[0].state.terminated}'
kubectl describe node cnlab-worker | sed -n '/^Allocatable/,/^System/p;/^Allocated resources/,/^Events/p'
kubectl patch pod qos-burstable --subresource resize --patch '{"spec":{"containers":[{"name":"c","resources":{"requests":{"cpu":"200m"}}}]}}'
kubectl top pod                               # needs metrics-server (see the Metrics API card)
```

On this cluster `kubectl top pod` ends with `error: Metrics API not available`: kind does not ship metrics-server.

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pod `Failed`; `terminated` shows `exitCode: 137`, `reason: OOMKilled` | The process used more memory than `limits.memory` (32Mi here) | Raise the limit, or fix the leak; compare real use with the limit |
| Pod `Pending`; event `0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 Insufficient cpu. preemption: 0/3 nodes are available: 3 Preemption is not helpful for scheduling.` | The request (`cpu: "100"`) is larger than any node's allocatable CPU (12) | Lower the request or add bigger nodes |
| `The Pod "qos-besteffort" is invalid: spec: Invalid value: "BestEffort": Pod QOS Class may not change as a result of resizing` | An in-place resize cannot give a BestEffort Pod requests, because that would change its QoS class | Recreate the Pod with resources set |

## Related

- **Cards:** ResourceQuota, LimitRange, kube-scheduler, HorizontalPodAutoscaler, Pod
- **Chapter and lab:** Ch 5.4 and Lab 5.4
- **Exam:** CKA, Workloads and Scheduling (15%): Pod admission and scheduling; CKAD, Application Environment, Configuration and Security (25%): requests, limits, quotas
- **Source:** [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/), [Pod Quality of Service Classes](https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/)
