# Event

## What and why

When a Pod does not start, the cause is rarely in its own status; it is in what the scheduler, the kubelet or a controller just tried. An **Event** is a small API object a component creates to report one such state change about another object ("Successfully assigned", "Failed to pull image", "Scaled up replica set"). Events are for humans and debugging: the API spec warns that they have a limited retention time and that consumers should not rely on them continuing to exist.

Two API versions are served for the same data, the core `v1` Event and the newer `events.k8s.io/v1` Event with fields such as `regarding`, `reason`, `note` and `reportingController`. `kubectl describe` shows an object's Events at the bottom, and `kubectl events` lists them across a namespace.

## Diagram

{{diagram event-01.jsx | Event flow · 3 writers, 3 readers}}
Events are ordinary API objects that components create to say what they just did to another object.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). A Pod with a bad image produces Events from two components:

```
$ kubectl run ev --image=nginx:no-such-tag; sleep 20
$ kubectl events --for pod/ev
LAST SEEN          TYPE      REASON      OBJECT   MESSAGE
21s                Normal    Scheduled   Pod/ev   Successfully assigned t2/ev to cnlab-control-plane
19s                Normal    BackOff     Pod/ev   Back-off pulling image "nginx:no-such-tag"
19s                Warning   Failed      Pod/ev   Error: ImagePullBackOff
4s (x2 over 20s)   Normal    Pulling     Pod/ev   Pulling image "nginx:no-such-tag"
3s (x2 over 19s)   Warning   Failed      Pod/ev   Failed to pull image "nginx:no-such-tag": rpc error: code = NotFound desc = failed to pull and unpack image ...: not found
3s (x2 over 19s)   Warning   Failed      Pod/ev   Error: ErrImagePull
$ kubectl get events --field-selector type=Warning,involvedObject.name=ev
$ kubectl get events.events.k8s.io -o json | ...    # the newer API shows who wrote it
{'type': 'Normal', 'reason': 'ScalingReplicaSet', 'note': 'Scaled up replica set web-74478f6647 from 2 to 3', 'reportingController': 'deployment-controller', ...}
```

`Scheduled` came from the scheduler, `Pulling` and `Failed` from the kubelet, and `ScalingReplicaSet` from the Deployment controller. Repeats are folded into one line with a count (`x2 over 20s`).

## Key fields

The `events.k8s.io/v1` fields (definitions from the v1.37.0 OpenAPI spec); core `v1` Events carry the same facts under older names (`involvedObject`, `message`, `count`, `reportingComponent`).

| Field | Meaning | Default |
| --- | --- | --- |
| `type` | `Normal` or `Warning` | required |
| `reason` | Short reason for the action (at most 128 characters) | required |
| `note` | Human-readable description (at most 1 kB) | none |
| `regarding` | The object the Event is about | required |
| `reportingController` | Which controller or component emitted it, such as `kubernetes.io/kubelet` or `deployment-controller` | required |
| `reportingInstance` | Instance ID of that component | required |
| `action` | What was taken or attempted, machine-readable | required |
| `eventTime` | When the Event was first observed | required |
| `series` | Repeat data when the same Event occurs many times | unset |
| API server `--event-ttl` | How long Events are kept | 1h0m0s |

## kubectl

```
kubectl describe pod <pod>                         # Events section at the bottom
kubectl events --for pod/<pod>                     # Events of one object, oldest first
kubectl events -n <ns> --types=Warning             # only warnings (flag not run in this test)
kubectl get events --sort-by=.lastTimestamp        # newest last
kubectl get events --field-selector type=Warning,involvedObject.name=<pod>
kubectl get events.events.k8s.io -o json           # the events.k8s.io/v1 form (reportingController, regarding)
kubectl get events -A --watch                      # not run: follow Events live
```

## How it fails

Rows one and two were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubectl events --for pod/sched` prints `No events found in t1 namespace.` while the Pod is `Pending` with `NODE <none>` | Nothing has acted on the Pod yet: here the scheduler container had just restarted (`crictl` showed `ATTEMPT 1`) after an API server outage | Check the scheduler Pod and its Lease (`kubectl -n kube-system get pod,lease`); the Events appear once it acts |
| `kubectl get events` prints hundreds of lines from every object | Events of all objects in the namespace are listed together | Filter: `kubectl events --for pod/<name>` or `--field-selector involvedObject.name=<name>`; sort with `--sort-by=.lastTimestamp` |
| An error you saw earlier has no Event any more (not reproduced) | Events are kept for `--event-ttl` (1h by default); older ones are deleted | Look at the Pod's current `status`, container `lastState` and logs; ship Events to a log store if you need history |

## Related

- **Cards:** Logs, events and kubectl debug and Troubleshooting playbook (group 11); Pod lifecycle and probes; kube-scheduler; kubelet; Namespace.
- **Chapter and lab:** Chapter 5.1 and Lab 5.1 (Vol 5); debugging use in Chapters 5.2 and 5.5.
- **Exam domain:** KCNA Kubernetes Fundamentals; the CKA and CKAD container-output and debugging competencies (see Logs, events and kubectl debug).
