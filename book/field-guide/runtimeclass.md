# RuntimeClass

## What and why

RuntimeClass selects which container runtime configuration runs a Pod's sandbox, for example a runtime with stronger isolation, and it states the cost. `handler` names a runtime handler configured in the node's CRI runtime (containerd or CRI-O). `overhead.podFixed` adds fixed CPU and memory per Pod to scheduling and quota. `scheduling` (`nodeSelector`, `tolerations`) limits Pods to nodes that have the handler.

The RuntimeClass **admission controller** copies overhead and scheduling into the Pod. The **kubelet** passes the handler to the CRI. A Pod that names a RuntimeClass the API does not know is rejected; one whose handler the node lacks fails to start.

## Diagram

{{diagram runtimeclass-01.jsx | RuntimeClass flow · 6 boxes}}

The Pod names a RuntimeClass; admission copies overhead, the scheduler counts it, and the kubelet picks the handler.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` (containerd 2.3.4, handler `runc`) and kubectl v1.37.1 (2026-11-16). kind defines no RuntimeClass (`kubectl get runtimeclass` prints `No resources found`). One class that maps to the real `runc` handler and declares overhead, and a Pod that uses it:

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata: {name: with-overhead}
handler: runc
overhead: {podFixed: {cpu: 100m, memory: 64Mi}}
---
apiVersion: v1
kind: Pod
metadata: {name: rc-overhead}
spec:
  runtimeClassName: with-overhead
  containers:
  - {name: c, image: alpine:3.21, command: [sleep, "3600"], resources: {requests: {cpu: 100m, memory: 64Mi}}}
```

The RuntimeClass admission controller copied the overhead into the Pod, which is what the scheduler counts in addition to the container requests:

```
$ kubectl get pod rc-overhead -o jsonpath='{.spec.overhead}'
{"cpu":"100m","memory":"64Mi"}
```

## Key fields

Checked with `kubectl explain runtimeclass` on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| `handler` | name of the runtime configuration in the node's CRI (for example `runc`); lowercase DNS label; immutable | required |
| `overhead.podFixed` | CPU and memory the runtime adds for every Pod | none |
| `scheduling.nodeSelector` | node labels needed to run this class; merged with the Pod's own selector (a conflict is rejected) | nil: all nodes support it |
| `scheduling.tolerations` | tolerations added to Pods of this class | none |
| Pod `spec.runtimeClassName` | the class to use | unset: the CRI's default handler |
| Pod `spec.overhead` | filled in by admission from the class; never set it yourself | unset |

## kubectl

```bash
kubectl get runtimeclass                       # NAME, HANDLER, AGE
kubectl describe runtimeclass with-overhead
kubectl get pod rc-overhead -o jsonpath='{.spec.overhead}'
kubectl describe pod rc-ghost | sed -n '/^Events/,$p'     # sandbox errors show here
kubectl explain runtimeclass.overhead
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pod `ContainerCreating`; event `Warning FailedCreatePodSandBox kubelet Failed to create pod sandbox: rpc error: code = Unknown desc = unable to get OCI runtime for sandbox "931b...": no runtime for "no-such-handler" is configured` | The class's `handler` is not configured in this node's container runtime | Add the handler to the CRI config on the nodes, or fix the class |
| `Error from server (Forbidden): pods "rc-missing" is forbidden: pod rejected: RuntimeClass "not-defined" not found` | The Pod names a RuntimeClass that does not exist | Create the class (RuntimeClass is cluster-scoped) or fix the name |
| Pods of the class land only on some nodes, or stay Pending (documented, not reproduced) | `scheduling.nodeSelector` limits Pods to nodes that carry the label | Label the nodes that have the handler, and keep it in sync |

## Related

- **Cards:** Container runtime (CRI) (group 1), kubelet, Requests, limits and QoS, Pod
- **Chapter and lab:** Ch 4.2 and Ch 5.4 (Lab 4.2, Lab 5.4)
- **Exam:** not named in the [CKA or CKAD v1.37 curriculum](https://github.com/cncf/curriculum) (checked 2026-11-17); KCNA, Container Orchestration (28%)
- **Source:** [Runtime Class](https://kubernetes.io/docs/concepts/containers/runtime-class/)
