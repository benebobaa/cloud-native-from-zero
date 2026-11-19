# Init and sidecar containers

## What and why

Some work must happen before the app starts (wait for a database, run a migration, fetch a file), and some helpers must live exactly as long as the app (a log shipper, a proxy). **Init containers** run one at a time, each to completion, before any regular container starts. A **native sidecar** is an init container with `restartPolicy: Always`: it starts in order, keeps running next to the app, and is stopped after the app exits.

The kubelet runs the sequence. If an init container fails, the Pod's `restartPolicy` decides whether it is retried; the app containers never start until every regular init container has succeeded.

## Diagram

{{diagram init-and-sidecar-containers-01.jsx | Startup order · 1 init, 1 sidecar, 1 app}}
Regular init containers finish before anything else starts; a native sidecar (an init container with restartPolicy Always) starts in order, then keeps running next to the app.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16).

```yaml
apiVersion: v1
kind: Pod
metadata: {name: init-demo}
spec:
  initContainers:
  - name: wait-db            # runs to completion, in order
    image: alpine:3.21
    command: ["sh","-c","echo init-1 done"]
  - name: log-sidecar        # native sidecar: restartPolicy Always
    image: alpine:3.21
    restartPolicy: Always
    command: ["sh","-c","while true; do echo sidecar-alive; sleep 5; done"]
  containers:
  - name: app
    image: alpine:3.21
    command: ["sh","-c","sleep 3600"]
```

```
$ kubectl wait --for=condition=Ready pod/init-demo --timeout=60s; kubectl get pod init-demo
pod/init-demo condition met
NAME        READY   STATUS    RESTARTS   AGE
init-demo   2/2     Running   0          2s
$ kubectl get pod init-demo -o jsonpath='{range .status.initContainerStatuses[*]}{.name} ready={.ready} started={.started}{"\n"}{end}'
wait-db ready=true started=false
log-sidecar ready=true started=true
$ kubectl logs init-demo -c wait-db; kubectl logs init-demo -c log-sidecar | head -1
init-1 done
sidecar-alive
```

The Pod shows `2/2` ready: the sidecar and the app. The finished init container has `started=false` because it is no longer running.

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.initContainers[]` | Containers run in order before `containers`; same fields as a container, but no probes or lifecycle hooks (except for sidecars) | none |
| `spec.initContainers[].restartPolicy: Always` | Makes the init container a native sidecar: restarted on exit until all regular containers end | unset (runs once to completion) |
| `spec.initContainers[].startupProbe` | For a sidecar, the next init container starts after the sidecar is started or this probe passes | none |
| `spec.containers[]` | The app containers, started together after init | required |
| `spec.volumes[]` with `emptyDir` | Scratch space shared by init, sidecar and app containers | none |
| `spec.restartPolicy` (Pod) | Retry behaviour for failed init containers | `Always` |

Defaults and rules are from `kubectl explain` and the v1.37.0 OpenAPI spec.

## kubectl

```
kubectl get pod init-demo                          # STATUS shows Init:N/M while init runs, Init:Error on failure
kubectl describe pod init-demo                     # init container states and Events
kubectl logs init-demo -c wait-db                  # logs of one init container
kubectl logs init-demo -c log-sidecar -f           # follow a sidecar
kubectl get pod init-demo -o jsonpath='{.status.initContainerStatuses}'
kubectl exec init-demo -c app -- sh                # not run: shell in the app container
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `STATUS Init:Error`, `RESTARTS 2`; the app container is `PodInitializing`; `kubectl logs init-fail -c migrate` prints `cannot reach db` | An init container exits non-zero (here `exit 1`), so the app never starts and the init container is retried | Read the init container's logs and fix what it waits for or runs |
| After about 70 s: `Init:Error`, `RESTARTS 3`; event `Back-off restarting failed container migrate in pod init-fail_x2(...)` | The kubelet retries a failing init container with a growing delay (the same back-off as a crashing app container) | Fix the cause; the Pod does not need re-creating, the next retry picks up the fix only if the failing dependency recovers |
| `kubectl logs init-demo` prints only `Defaulted container "app" out of: app, wait-db (init), log-sidecar (init)` and no output | Without `-c`, kubectl shows the first regular container, not the init containers or the sidecar | Name the container: `kubectl logs init-demo -c wait-db` |

All three rows were reproduced on the test cluster.

## Related

- **Cards:** Pod; Pod lifecycle and probes; Requests, limits and QoS (group 7: init requests are counted at scheduling); Logs, events and kubectl debug (group 11).
- **Chapter and lab:** Chapter 5.2 and Lab 5.2 (Vol 5).
- **Exam domain:** CKAD Application Design and Build: multi-container Pod patterns.
