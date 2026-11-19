# ReplicationController (legacy)

## What and why

The **ReplicationController** is the first Kubernetes controller that keeps N copies of a Pod running. It was superseded by the ReplicaSet, which accepts richer label selectors, and then by the Deployment, which adds rolling updates and rollback. The API still serves it in 1.37, so you will meet it in old manifests and exam vocabulary, but new workloads should use a Deployment.

The replication manager inside `kube-controller-manager` does the same count-and-correct loop as the ReplicaSet controller. The visible differences are the selector (a simple label map) and that updates need a manual procedure instead of a rollout.

## Diagram

{{diagram replicationcontroller-legacy-01.jsx | Controller lineage · 3 generations}}
The ReplicationController is the oldest replica controller; the ReplicaSet generalised its selector, and the Deployment added update and rollback on top.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16).

```yaml
apiVersion: v1
kind: ReplicationController
metadata: {name: legacy}
spec:
  replicas: 2
  selector: {app: legacy}      # a plain map, equality only
  template:
    metadata: {labels: {app: legacy}}
    spec: {containers: [{name: c, image: "alpine:3.21", command: ["sleep","3600"]}]}
```

```
$ kubectl apply -f rc.yaml; sleep 6; kubectl get rc legacy
NAME     DESIRED   CURRENT   READY   AGE
legacy   2         2         2       6s
$ kubectl scale rc legacy --replicas=3; sleep 3; kubectl get pods -l app=legacy
legacy-8sf44   1/1   Running   0   3s
legacy-c2g9l   1/1   Running   0   10s
legacy-x9nn4   1/1   Running   0   10s
```

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.replicas` | Number of Pods to keep | 1 |
| `spec.selector` | Label map (equality only) that picks the Pods | the template labels if empty |
| `spec.template` | Pod template for new Pods | required |
| `spec.minReadySeconds` | Seconds a new Pod must be ready to count as available | 0 |

Defaults are from `kubectl explain` and the v1.37.0 OpenAPI spec.

## kubectl

```
kubectl apply -f rc.yaml
kubectl get rc legacy                  # DESIRED, CURRENT, READY
kubectl scale rc legacy --replicas=3
kubectl describe rc legacy
kubectl explain rc.spec.selector       # a map[string]string, not a matchLabels block
kubectl delete rc legacy --now
```

There is no `kubectl rolling-update` any more (see the failures table); to update, create a Deployment instead.

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `error: unknown command "rolling-update" for "kubectl"` | The old rolling-update command that replaced Pods of a ReplicationController no longer exists in kubectl 1.37 | Use a Deployment (`kubectl rollout`) |
| Error from server (BadRequest): ... ReplicationController in version "v1" cannot be handled as a ReplicationController: json: cannot unmarshal object into Go struct field ReplicationControllerSpec.spec.selector of type string | The selector was written like a ReplicaSet's (`matchLabels:`), but a ReplicationController takes a plain label map | Write `selector: {app: legacy}`, or move to a ReplicaSet |
| `kubectl set image rc/legacy c=alpine:3.22` prints `image updated`, but the Pods still show `alpine:3.21` seconds later; `kubectl rollout undo rc/legacy` fails with `error: no rollbacker has been implemented for "ReplicationController"` and `rollout status` with `error: no status viewer has been implemented for ReplicationController` | A ReplicationController changes only its template; it never replaces existing Pods, and it has no revision history | Delete the old Pods so the controller re-creates them from the new template, or use a Deployment |

## Related

- **Cards:** ReplicaSet; Deployment; Labels, selectors and annotations (group 2).
- **Chapter and lab:** Chapter 5.2 and Lab 5.2 (Vol 5).
- **Exam domain:** KCNA Kubernetes Fundamentals.
