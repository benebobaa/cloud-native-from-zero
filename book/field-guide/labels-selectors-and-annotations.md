# Labels, selectors and annotations

## What and why

Kubernetes objects have no built-in hierarchy, so grouping is done with data. A **label** is a key/value pair on `metadata.labels` that says what an object is (`app=web`, `tier=front`). A **selector** is a query over labels, and it is how a Service finds its Pods, a ReplicaSet counts its Pods and `kubectl get -l` filters output. An **annotation** is also key/value metadata but is for people and tools (a contact, a build ID); nothing selects on it and it is not meant to identify an object.

No single controller owns labels: the API server stores them, and every component that has a selector (Service, ReplicaSet, Deployment, NetworkPolicy, scheduler affinity) evaluates it against the live objects.

## Diagram

{{diagram labels-selectors-and-annotations-01.jsx | Label selection · 1 selector, 3 Pods}}
A Service, ReplicaSet or `kubectl -l` picks every Pod whose labels satisfy the selector; Pods that do not match are simply not part of the set.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). Three Pods with different labels, then selectors over them:

```
$ kubectl run l1 --image=alpine:3.21 --labels="app=web,tier=front,env=prod" --command -- sleep 3600   # l2: app=web,tier=back,env=dev   l3: app=db,tier=back,env=prod
$ kubectl get pods -l "app in (web,db),env!=dev" --show-labels
NAME   READY   STATUS    RESTARTS   AGE   LABELS
l1     1/1     Running   0          2s    app=web,env=prod,tier=front
l3     0/1     ContainerCreating   0   1s   app=db,env=prod,tier=back
$ kubectl get pods -l "tier,!canary" -o name
pod/l1
pod/l2
pod/l3
$ kubectl label pod l1 env=staging --overwrite; kubectl label pod l1 canary=true; kubectl label pod l1 canary-; kubectl get pod l1 --show-labels
l1     1/1     Running   0          3s    app=web,env=staging,tier=front
$ kubectl annotate pod l1 contact="team-a@example.com"; kubectl get pod l1 -o jsonpath='{.metadata.annotations}'
{"contact":"team-a@example.com"}
```

The first selector matched `l1` and `l3` but not `l2` (its `env` is `dev`). Other Pods in the namespace (a Deployment's) were listed too when their labels matched.

## Key fields

| Field or syntax | Meaning | Default |
| --- | --- | --- |
| `metadata.labels` | Map of label keys to values used for selection | none |
| `metadata.annotations` | Map of free-form notes, never selected on | none |
| `selector.matchLabels` | Every listed key must equal its value (AND) | required in workload selectors |
| `selector.matchExpressions` | Rules with an operator: `In`, `NotIn`, `Exists`, `DoesNotExist` | none |
| `kubectl get -l a=b,c!=d` | Equality-based selector on the command line | all objects |
| `kubectl get -l 'a in (x,y)'` | Set-based selector on the command line | all objects |
| `kubectl label key=value`, `key-` | Add, overwrite (`--overwrite`) or remove a label | not applicable |

Selector semantics are from `kubectl explain` and the commands run in the example; the exact syntax limits are shown by the error text in the failures table.

## kubectl

```
kubectl get pods --show-labels                     # show every label
kubectl get pods -l app=web                        # equality selector
kubectl get pods -l 'app in (web,db),env!=dev'     # set-based, comma = AND
kubectl get pods -l 'tier,!canary'                 # key exists / does not exist
kubectl label pod l1 env=staging --overwrite       # change a label
kubectl label pod l1 canary-                       # remove a label (trailing dash)
kubectl annotate pod l1 contact=team-a             # set an annotation
kubectl get svc,ep,endpointslices -l app=web       # same selector across kinds (not run in this form)
kubectl describe svc web                           # shows Selector and Endpoints
```

## How it fails

All four texts are real output from the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `error: invalid label value: "team=a b": a valid label must be an empty string or consist of alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric character` | Label values allow only letters, digits, `-`, `_` and `.` | Use a value such as `a-b`; put long free text in an annotation |
| `error: 'env' already has a value (staging), and --overwrite is false` | `kubectl label` refuses to change an existing label silently | Add `--overwrite` |
| `Error from server (BadRequest): Unable to find "/v1, Resource=pods" that match label selector "app web", ...: unable to parse requirement: found 'web', expected: in, notin, =, ==, !=, gt, lt` | The selector text is not valid (missing `=` or an operator) | Write `app=web` or `'app in (web)'` |
| A Service with `selector: {app: wbe}` is created but `kubectl describe svc` shows `Selector: app=wbe` and an empty `Endpoints:`; its EndpointSlice has no endpoints | A typo: no Pod has label `app=wbe`, so the selector matches nothing | Fix the selector or the Pod labels; compare with `kubectl get pods --show-labels` |

## Related

- **Cards:** Service (group 4); ReplicaSet and Deployment; NetworkPolicy (group 4); Taints, tolerations and affinity (group 7); Objects, spec and status.
- **Chapter and lab:** Chapter 5.1 and Lab 5.1 (Vol 5).
- **Exam domain:** KCNA Kubernetes Fundamentals. Neither the [CKA](https://github.com/cncf/curriculum/blob/main/CKA_Curriculum_v1.37.pdf) nor the [CKAD](https://github.com/cncf/curriculum/blob/main/CKAD_Curriculum_v1.37.pdf) 1.37 curriculum names labels, but Services, Deployments and `kubectl -l` all rely on them.
