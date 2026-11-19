# Pod lifecycle and probes

## What and why

A running process is not always a working one, so the kubelet runs three kinds of check against each container. **Startup** asks whether the app has finished booting, **liveness** asks whether it is stuck, and **readiness** asks whether it can take traffic right now. The kubelet reacts: a failing liveness (or startup) probe restarts the container, while a failing readiness probe only marks the Pod `Ready=False`, and the EndpointSlice controller then stops sending Service traffic to it.

The Pod also carries a coarse `status.phase` (`Pending`, `Running`, `Succeeded`, `Failed`, `Unknown`). The phase is a summary; use conditions and `containerStatuses` for the cause.

## Diagram

{{diagram pod-lifecycle-and-probes-01.jsx | Probe outcomes · 3 probes, 2 paths}}
Startup gates the other two probes; a failing liveness probe restarts the container, a failing readiness probe only removes the Pod from Service endpoints.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). The container removes its own marker files on a timer, so you can watch each probe react:

```yaml
apiVersion: v1
kind: Pod
metadata: {name: live}
spec:
  containers:
  - name: app
    image: alpine:3.21
    command: ["sh","-c","touch /tmp/ready /tmp/alive; sleep 8; rm /tmp/ready; sleep 6; rm /tmp/alive; sleep 3600"]
    readinessProbe: {exec: {command: ["cat","/tmp/ready"]}, periodSeconds: 2}
    livenessProbe:  {exec: {command: ["cat","/tmp/alive"]}, periodSeconds: 2, failureThreshold: 2}
```

```
$ kubectl apply -f pr.yaml; for i in 1 2 3 4 5 6 7; do sleep 6; kubectl get pod live --no-headers; done
live   1/1   Running   0   6s
live   1/1   Running   0   12s
live   0/1   Running   0   19s      <- readiness failed: Ready=False, nothing restarted
live   0/1   Running   0   25s
$ kubectl describe pod live | sed -n '/^Events/,$p' | tail -4
  Warning  Unhealthy  29s (x2 over 32s)  kubelet  Liveness probe failed: cat: can't open '/tmp/alive': No such file or directory
  Normal   Killing    29s                kubelet  Container app failed liveness probe, will be restarted
  Warning  Unhealthy  1s (x21 over 39s)  kubelet  Readiness probe failed: cat: can't open '/tmp/ready': No such file or directory
```

The readiness probe took the Pod out of service first (`0/1`), then the liveness probe made the kubelet kill the container. At 46 s `restartCount` was still 0: the shell ignores SIGTERM, so the kill waits for the 30 s grace period before the restart is counted.

## Key fields

These fields sit on each probe (`startupProbe`, `livenessProbe`, `readinessProbe`). Defaults are from the v1.37.0 OpenAPI spec; probe behaviour is described in [Liveness, readiness and startup probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/).

| Field | Meaning | Default |
| --- | --- | --- |
| `exec`, `httpGet`, `tcpSocket`, `grpc` | How to check: run a command, GET a path, open a port, or call gRPC health | one is required |
| `initialDelaySeconds` | Wait after the container starts before probing | no delay |
| `periodSeconds` | Seconds between probes | 10 |
| `timeoutSeconds` | Seconds before a probe counts as failed | 1 |
| `successThreshold` | Consecutive successes to count as passing again (must be 1 for liveness and startup) | 1 |
| `failureThreshold` | Consecutive failures to count as failed | 3 |
| `terminationGracePeriodSeconds` | Grace period when this probe triggers a kill | the Pod's value (30) |
| `spec.restartPolicy` (Pod) | Whether the kubelet restarts containers that exit | `Always` |

## kubectl

```
kubectl get pod live                        # READY shows readiness; RESTARTS shows liveness kills
kubectl describe pod live                   # probe settings and Unhealthy / Killing events
kubectl get pod live -o jsonpath='{.status.containerStatuses[0].restartCount}'
kubectl get pod live -o jsonpath='{.status.conditions}'     # Ready, ContainersReady
kubectl logs live --previous                # logs of the killed container (see the note below)
kubectl get pod live -o jsonpath='{.status.containerStatuses[0].lastState}'
kubectl explain pod.spec.containers.livenessProbe
```

In the crash test `kubectl logs crash --previous` printed `unable to retrieve container logs for containerd://...` for a container that had exited at once, so do not count on `--previous` for very short-lived containers.

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `READY 0/1` but `STATUS Running` and `RESTARTS 0`; event `Readiness probe failed: cat: can't open '/tmp/ready': No such file or directory` (repeated, `x21 over 39s`) | The readiness probe fails: the Pod is alive but not Ready, so Services stop sending it traffic | Fix what the probe checks; `kubectl describe pod` shows the exact probe output |
| Events `Liveness probe failed: ...` then `Killing: Container app failed liveness probe, will be restarted` | The liveness probe failed `failureThreshold` (2) times in a row, so the kubelet kills the container | Fix the check or the app; add a `startupProbe` or `initialDelaySeconds` if the app is slow to start |
| For a startup probe that always fails (`exec: false`, 3 tries): `Startup probe failed:` then `Killing: Container app failed startup probe, will be restarted` within 19 s | The container never passed its startup probe within `failureThreshold` x `periodSeconds` | Give the app longer: raise `failureThreshold` or `periodSeconds` of the startup probe |

## Related

- **Cards:** Pod; Init and sidecar containers; Service and EndpointSlice (group 4); Deployment (rollouts wait for readiness); Logs, events and kubectl debug (group 11).
- **Chapter and lab:** Chapter 5.2 and Lab 5.2 (Vol 5).
- **Exam domain:** CKA Workloads and Scheduling: self-healing primitives; CKAD Application Observability and Maintenance: probes and health checks.
