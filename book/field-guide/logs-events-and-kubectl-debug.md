# Logs, events and kubectl debug

## What and why

Logs, events and `kubectl debug` are the first tools for finding out why a workload misbehaves. Logs are the container's output, events are Kubernetes's own notes about an object, and `kubectl debug` adds a debugging container or Pod.

**Acts on it:** the kubelet serves logs and exec streams through the API server; controllers and the kubelet write events; the kubelet starts the ephemeral debug container.

## Diagram

{{diagram logs-events-and-kubectl-debug-01.jsx | Debug ladder · 6 tools}}

Each rung needs more privilege and changes more than the one before.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0` (containerd), kubectl v1.37.1 (2026-11-17). Three Pods: `two` (containers `app` and `side`), `crash` (exits with code 3), and `slim` (the `registry.k8s.io/pause` image, which has no shell).

```text
$ kubectl -n dbg logs two
Defaulted container "app" out of: app, side
tick 12:04:49
$ kubectl -n dbg logs two --all-containers --prefix --tail=1
[pod/two/app] tick 12:04:49
[pod/two/side] side-up
$ kubectl -n dbg logs crash --previous
FATAL: cannot reach db:5432
booting
$ kubectl -n dbg describe pod crash | grep -A5 'Last State'
    Last State:     Terminated
      Reason:       Error
      Exit Code:    3
$ kubectl events -n dbg --for pod/crash
LAST SEEN           TYPE      REASON      OBJECT      MESSAGE
12s (x3 over 24s)   Normal    Started     Pod/crash   Container started
11s (x3 over 22s)   Warning   BackOff     Pod/crash   Back-off restarting failed container c in pod crash_dbg(2b311ce3-...)
$ kubectl -n dbg exec slim -- sh
error: Internal error occurred: ... OCI runtime exec failed: exec failed: unable to start container process: exec: "sh": executable file not found in $PATH
$ kubectl -n dbg debug slim -it --image=busybox:1.37 --target=c -- sh
# ps
PID   USER     TIME  COMMAND
    1 65535     0:00 /pause
   17 root      0:00 sh
$ kubectl -n dbg get pod slim -o jsonpath='{.spec.ephemeralContainers[*].name}'
debugger-fxk2p
```

`kubectl debug` added an ephemeral container to the running Pod. It shares the process namespace of container `c` (`ps` shows `/pause` as PID 1), so you can inspect a Pod whose image has no tools. Two more forms were run: `kubectl debug crash --copy-to=crash-debug --container=c -- sleep 600` made a copy of the crashing Pod with a different command (it came up `1/1 Running` and `exec` worked), and `kubectl debug node/cnlab-worker --image=busybox:1.37 -- sh -c 'ls /host'` created a Pod `node-debugger-...` that mounts the node's file system at `/host` (delete it afterwards).

## Key fields

Flags are from `kubectl logs --help` and `kubectl debug --help` (v1.37.1); the Pod fields were seen in the run above.

| Flag or field | Meaning | Default |
| --- | --- | --- |
| `logs -c <container>`, `--all-containers`, `--prefix` | Choose a container, or all, with `[pod/name/container]` prefixes | the Pod's default container (kubectl says `Defaulted container`) |
| `logs --previous` (`-p`) | Logs of the previous instance of a restarted container | current instance |
| `logs -f`, `--tail=N`, `--since=10m`, `--timestamps` | Stream, limit and annotate | all lines |
| `logs -l app=web` | Logs of every Pod matching a selector | one Pod |
| `status.containerStatuses[].lastState.terminated` | `reason`, `exitCode`, `startedAt`, `finishedAt` of the previous run | set by the kubelet |
| `debug --image`, `--target`, `-it` | Ephemeral container image, which container's process namespace to share, interactive terminal | none |
| `debug --copy-to=<name>` | Debug a copy of the Pod; combine with a changed command or image | edit in place |
| `debug node/<name>` | A Pod on that node with the node's root mounted at `/host` | none |
| `spec.ephemeralContainers[]` | Where the debug container is recorded; it cannot be removed from the Pod | none |
| Events (`kubectl events`, `get events --sort-by=.lastTimestamp`) | What the scheduler, kubelet and controllers did; kept for about an hour by default |  |

See [Debug running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/) and [Logging architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/). The kubelet keeps the logs on the node (rotated), which is why they vanish with the Pod.

## kubectl

```bash
kubectl logs <pod> [-c <container>] [--tail=50] [-f] [--since=10m] [--timestamps]
kubectl logs <pod> --previous                           # the crashed run
kubectl logs -l app=web --all-containers --prefix       # every Pod with a label
kubectl describe pod <pod>                              # State, Last State, Exit Code, Events at the bottom
kubectl get events -n <ns> --sort-by=.lastTimestamp     # newest last
kubectl events -n <ns> --for pod/<pod>                  # events of one object
kubectl get events -A --field-selector type=Warning
kubectl debug <pod> -it --image=busybox:1.37 --target=<container>
kubectl debug <pod> --copy-to=<pod>-debug --container=<c> -- sleep 600
kubectl debug node/<node> -it --image=busybox:1.37      # then: chroot /host
kubectl exec -it <pod> -- sh
kubectl top pod <pod> --containers
```

## How it fails

All rows were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Error from server (BadRequest): container "c" in pod "waiting2" is waiting to start: ContainerCreating`; `kubectl describe` shows `Warning  FailedMount  ... MountVolume.SetUp failed for volume "v" : secret "nosuch" not found` | The container never started, so there is no log; the reason is in the Pod's events | Read `describe pod` events first (missing Secret, image pull, scheduling), then logs |
| `Error from server (BadRequest): previous terminated container "app" in pod "two" not found` | `--previous` only works after a restart; Pod `two` had never restarted | Use plain `logs`; `--previous` is for `CrashLoopBackOff` and `Error` Pods (`kubectl logs crash --previous` printed the failing run) |
| `kubectl exec slim -- sh` gives `OCI runtime exec failed: ... exec: "sh": executable file not found in $PATH`; `error: container nosuch is not valid for pod two out of: app, side` for a wrong `-c` | The image has no shell (distroless or `pause`); or the container name is wrong, and kubectl lists the valid ones | Use `kubectl debug ... --target=<container>` to attach a tool image; copy the name from the error |

One trap: the order of output lines can differ from the order the process wrote them, because standard output and standard error are separate streams merged by the runtime (`crash` printed `FATAL: ...` before `booting`).

## Related

- **Cards:** Pod lifecycle and probes (group 3), Event (group 2), Init and sidecar containers (group 3), Troubleshooting playbook, Pod (group 3).
- **Chapter and lab:** 5.2 and 5.5.
- **Exam:** CKA Troubleshooting (30%): manage and evaluate container output streams; CKAD Application Observability and Maintenance (15%): utilize container logs, debugging.
