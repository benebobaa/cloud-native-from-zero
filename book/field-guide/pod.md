# Pod

## What and why

A Pod is the smallest unit Kubernetes schedules: one or more containers that share one IP address and, optionally, volumes, and that always run together on one node. Containers that must cooperate (an app and a log shipper) need the same network namespace and files, so Kubernetes places them as one unit.

Two components act on it. The **scheduler** picks a node once and records it in `spec.nodeName`. From then on the **kubelet** on that node is the only component that starts, probes, restarts and reports on the Pod. A bare Pod is never moved to another node and not recreated if its node is lost, which is why Deployments, Jobs and the other workload cards exist.

## Diagram

{{diagram pod-01.jsx | Pod placement and phases · 4 actors, 4 phases}}
The top row shows who touches a Pod; the bottom row shows the phase the API reports as they act.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). The nginx image reported version 1.31.8.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web
  labels: {app: web}
spec:
  containers:
  - name: nginx
    image: nginx:1.31.8
    ports: [{containerPort: 80}]
    resources:
      requests: {cpu: 50m, memory: 32Mi}
      limits: {memory: 64Mi}
```

```
$ kubectl apply -f pod.yaml && kubectl wait --for=condition=Ready pod/web --timeout=60s
pod/web created
pod/web condition met
$ kubectl get pod web -o wide
NAME   READY   STATUS    RESTARTS   AGE   IP            NODE                      NOMINATED NODE   READINESS GATES
web    1/1     Running   0          26s   10.244.0.11   cnlab-control-plane       <none>           <none>
$ kubectl describe pod web | sed -n '/^Events/,$p'
  Normal  Scheduled  27s   default-scheduler  Successfully assigned t3/web to cnlab-control-plane
  Normal  Pulling    26s   kubelet            spec.containers{nginx}: Pulling image "nginx:1.31.8"
  Normal  Pulled     1s    kubelet            spec.containers{nginx}: Successfully pulled image ...
  Normal  Started    1s    kubelet            spec.containers{nginx}: Container started
```

The Events show both actors: the scheduler assigned the node, the kubelet pulled and started the container. Because the Pod has requests and a memory limit but no CPU limit, `status.qosClass` is `Burstable`.

## Key fields

Defaults are from `kubectl explain` and the v1.37.0 OpenAPI spec.

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.containers[].image` | Image to pull and run (required) | none |
| `spec.containers[].command`, `args` | Replace the image ENTRYPOINT and CMD | the image's own |
| `spec.containers[].imagePullPolicy` | `Always`, `IfNotPresent` or `Never` | `Always` for the `:latest` tag, else `IfNotPresent` |
| `spec.containers[].resources` | `requests` (used by the scheduler) and `limits` (enforced by the kernel) | none |
| `spec.restartPolicy` | `Always`, `OnFailure` or `Never`, for all containers | `Always` |
| `spec.terminationGracePeriodSeconds` | Seconds from SIGTERM to SIGKILL | 30 |
| `spec.nodeName` | Set by the scheduler; setting it yourself skips the scheduler | empty |
| `spec.nodeSelector` | Node labels a node must have | none |
| `spec.dnsPolicy` | How the Pod resolves names | `ClusterFirst` |
| `spec.activeDeadlineSeconds` | Kill the Pod this long after it starts | none |

## kubectl

All commands below were run on the test cluster (some on other Pods of the same session) unless marked *not run*.

```
kubectl apply -f pod.yaml                      # create
kubectl run web --image=nginx:1.31.8           # quick create without YAML
kubectl get pod web -o wide                    # phase, node, Pod IP
kubectl get pod web -o jsonpath='{.status.phase} {.spec.nodeName}'
kubectl describe pod web                       # spec, conditions and the Events at the bottom
kubectl events --for pod/web                   # only this Pod's Events
kubectl logs web [-c container] [--previous]   # container output; --previous = the last crashed container
kubectl exec web -- nginx -v                   # run a command inside
kubectl explain pod.spec.restartPolicy         # field reference for this cluster version
kubectl delete pod web --now                   # SIGKILL after 0 seconds of grace
kubectl debug web -it --image=alpine:3.21      # not run: ephemeral debug container
```

## How it fails

All three were reproduced on the test cluster; the quoted text is real output.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ImagePullBackOff` or `ErrImagePull`; events show `Failed to pull image "nginx:no-such-tag": rpc error: code = NotFound desc = failed to pull and unpack image "docker.io/library/nginx:no-such-tag": ... not found` | The image name or tag does not exist, the registry is unreachable, or credentials are missing | Correct the name or tag; for a private registry add `imagePullSecrets`; read the Events with `kubectl describe pod` |
| `Pending`; event `FailedScheduling`: `0/1 nodes are available: 1 Insufficient cpu. preemption: 0/1 nodes are available: 1 Preemption is not helpful for scheduling.` | The Pod requests more CPU (here 100 cores) than any node has free, or fails a nodeSelector or taint | Lower the request, add capacity, or fix the selector; the scheduler retries on its own |
| `OOMKilled`: `state.terminated` shows `reason: OOMKilled`, `exitCode: 137` (limit was 20Mi); with `restartPolicy: Always` `a crashing container then shows Error with RESTARTS climbing and events like Back-off restarting failed container` | The process used more memory than `resources.limits.memory`, so the kernel killed it | Raise the limit or fix the memory use; check `kubectl describe pod` for the last state |

## Related

- **Cards:** Pod lifecycle and probes; Init and sidecar containers; ReplicaSet; Deployment; Job; kube-scheduler; kubelet; Requests, limits and QoS (group 7).
- **Chapter and lab:** Chapter 5.2 and Lab 5.2 (Vol 5).
- **Exam domain:** KCNA Kubernetes Fundamentals; CKAD Application Design and Build, choose a workload resource (see the group overview).
