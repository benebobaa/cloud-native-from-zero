# Deployment

## What and why

Changing a running app means replacing its Pods without downtime, and undoing the change if it is bad. A **Deployment** describes the Pod template and the number of replicas you want. Each time the template changes, the Deployment controller creates a new ReplicaSet and moves Pods to it in small steps, keeping the old ReplicaSet so `kubectl rollout undo` can go back.

The Deployment controller (in `kube-controller-manager`) scales the old and new ReplicaSets within the limits `maxSurge` and `maxUnavailable`, waits for new Pods to become Ready, and marks the rollout failed if it makes no progress for `progressDeadlineSeconds`. Use a Deployment for stateless, long-running apps.

## Diagram

{{diagram deployment-01.jsx | Rolling update · 5 steps, 2 ReplicaSets}}
Each rollout creates a new ReplicaSet and shifts Pods to it; filled squares are Pods of the new ReplicaSet. The step sequence is the pattern these limits allow, not a fixed script.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16).

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: {name: web}
spec:
  replicas: 3
  selector: {matchLabels: {app: web}}
  strategy: {type: RollingUpdate, rollingUpdate: {maxSurge: 1, maxUnavailable: 0}}
  template:
    metadata: {labels: {app: web}}
    spec:
      containers:
      - name: nginx
        image: nginx:1.31.8
        readinessProbe: {httpGet: {path: /, port: 80}, periodSeconds: 2}
```

```
$ kubectl apply -f deploy.yaml; kubectl rollout status deploy/web
deployment.apps/web created
Waiting for deployment "web" rollout to finish: 0 of 3 updated replicas are available...
Waiting for deployment "web" rollout to finish: 2 of 3 updated replicas are available...
deployment "web" successfully rolled out
$ kubectl set env deploy/web A=1; kubectl rollout status deploy/web; kubectl rollout history deploy/web; kubectl get rs -l app=web
deployment "web" successfully rolled out
REVISION  CHANGE-CAUSE
1         <none>
2         <none>
NAME             DESIRED   CURRENT   READY   AGE
web-5b9bb988ff   0         0         0       7s      <- revision 1, kept for rollback
web-68dcff75c9   3         3         3       5s      <- revision 2
$ kubectl rollout undo deploy/web; kubectl rollout status deploy/web; kubectl rollout history deploy/web
deployment.apps/web rolled back
deployment "web" successfully rolled out
REVISION  CHANGE-CAUSE
2         <none>
3         <none>
```

A template change (`set env` here, or `set image`) creates a new ReplicaSet. `undo` re-uses the old template and records it as revision 3; revision 1 is gone because that template became revision 3. The first `kubectl get rs` line shows the old ReplicaSet kept at 0 replicas.

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.replicas` | Number of Pods wanted | 1 |
| `spec.selector` | Label query for the Pods it manages; immutable; must match template labels | required |
| `spec.strategy.type` | `RollingUpdate` or `Recreate` (stop all, then start) | `RollingUpdate` |
| `spec.strategy.rollingUpdate.maxSurge` | Extra Pods allowed above `replicas` (number or %) | 25% |
| `spec.strategy.rollingUpdate.maxUnavailable` | Pods allowed to be unavailable (number or %) | 25% |
| `spec.minReadySeconds` | Seconds a new Pod must be ready before it counts as available | 0 |
| `spec.revisionHistoryLimit` | Old ReplicaSets kept for rollback | 10 |
| `spec.progressDeadlineSeconds` | Seconds without progress before the rollout is reported failed | 600 |
| `spec.paused` | Stop the controller from acting on template changes | false |

Defaults are from `kubectl explain` and the v1.37.0 OpenAPI spec; `maxSurge` and `maxUnavailable` cannot both be 0.

## kubectl

```
kubectl apply -f deploy.yaml
kubectl create deploy web --image=nginx:1.31.8 --replicas=3      # imperative
kubectl rollout status deploy/web [--timeout=60s]               # waits; non-zero exit on failure
kubectl set image deploy/web nginx=nginx:1.31.8                 # change the image (starts a rollout)
kubectl set env deploy/web A=1                                  # any template change starts one
kubectl rollout history deploy/web [--revision=2]
kubectl rollout undo deploy/web [--to-revision=2]
kubectl rollout restart deploy/web                              # new rollout with an unchanged template
kubectl rollout pause deploy/web      kubectl rollout resume deploy/web
kubectl scale deploy/web --replicas=5
kubectl describe deploy web                                     # strategy, conditions, ScalingReplicaSet Events
kubectl get deploy,rs,pods -l app=web
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubectl rollout status` ends with `error: deployment "web" exceeded its progress deadline` (deadline set to 20 s); `kubectl get deploy` shows `READY 3/3  UP-TO-DATE 1`; a new Pod is `ImagePullBackOff`; condition `Progressing=False ProgressDeadlineExceeded: ReplicaSet "web-76df44c8dd" has timed out progressing.` | The new template cannot start (here the image tag does not exist). With `maxUnavailable: 0` the old Pods keep serving, so the app stays up but the rollout is stuck | `kubectl rollout undo deploy/web` (it then said `successfully rolled out`), then fix the image and roll again |
| `The Deployment "zero" is invalid: spec.strategy.rollingUpdate.maxUnavailable: Invalid value: 0: may not be 0 when maxSurge is 0` | A rolling update with no surge and no unavailability could never make a step | Allow at least one of them, for example `maxSurge: 1` |
| After `kubectl rollout pause` and `kubectl set env`, no new ReplicaSet appears (`web-7dd57b55f5  3 3 3` only) and `rollout status` ends `Waiting for deployment "web" rollout to finish: 0 out of 3 new replicas have been updated...` then `error: timed out waiting for the condition` | A paused Deployment records template changes but does not roll them out | `kubectl rollout resume deploy/web`; the rollout then completed in a few seconds |

The selector is immutable: patching it gives `The Deployment "web" is invalid: ... spec.selector: Invalid value: {"matchLabels":{"app":"other"}}: field is immutable`. Create a new Deployment instead.

## Related

- **Cards:** ReplicaSet; Pod lifecycle and probes (readiness gates a rollout); HorizontalPodAutoscaler (group 8); Service (group 4, traffic to the Pods); Helm and Kustomize (group 11).
- **Chapter and lab:** Chapter 5.2 and Lab 5.2 (Vol 5); canary and blue/green patterns also in Chapter 7.1.
- **Exam domain:** CKA Workloads and Scheduling: rolling updates and rollbacks, self-healing; CKAD Application Deployment: rolling updates, blue/green and canary.
