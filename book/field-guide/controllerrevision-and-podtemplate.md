# ControllerRevision and PodTemplate

## What and why

To roll back, a controller needs the old Pod template. A **ControllerRevision** is an immutable snapshot of that state, with a revision number, owned by the object it describes. The DaemonSet and StatefulSet controllers create one for each template change and prune the oldest beyond `revisionHistoryLimit`; `kubectl rollout history` and `rollout undo` read them. Deployments do not use them: they keep old ReplicaSets instead.

A **PodTemplate** is a plain object that stores a Pod template under a name. The API reference defines it only as "a template for creating copies of a predefined pod" ([PodTemplate reference](https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/pod-template-v1/)). The workload controllers above keep their own template in `spec.template`, and in our tests creating a PodTemplate started nothing; we did not verify in the docs that no built-in controller ever reads one.

## Diagram

{{diagram controllerrevision-and-podtemplate-01.jsx | Who keeps revision history · 4 owners}}
DaemonSets and StatefulSets store each template version as a ControllerRevision; a Deployment keeps old ReplicaSets instead, and a PodTemplate is just a stored template.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). A one-replica StatefulSet `rev` (app `rev`, container `c`, `alpine:3.21`) was created, then changed with `kubectl set env`:

```
$ kubectl apply -f sts4.yaml; sleep 6; kubectl set env sts/rev V=2; sleep 10
$ kubectl get controllerrevisions
NAME             CONTROLLER             REVISION   AGE
rev-78bd46587f   statefulset.apps/rev   1          16s
rev-855ccfc44b   statefulset.apps/rev   2          10s
$ kubectl rollout history sts/rev
REVISION  CHANGE-CAUSE
1         <none>
2         <none>
$ kubectl get controllerrevision -o yaml | sed -n '/^  data:/,/^  kind/p' | head -8
  data:
    spec:
      template:
        $patch: replace
        metadata:
          labels:
            app: rev
```

A PodTemplate is a stored template; creating one starts nothing:

```
$ kubectl apply -f pt.yaml; kubectl get podtemplate; kubectl get pods -l app=tmpl
podtemplate/batch-template created
NAME             CONTAINERS   IMAGES        POD LABELS
batch-template   c            alpine:3.21   app=tmpl
No resources found in t3e namespace.
```

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `ControllerRevision.revision` | Revision number of the snapshot | required |
| `ControllerRevision.data` | The serialized state (for a DaemonSet or StatefulSet, the template patch); immutable after creation | required |
| `metadata.ownerReferences` | Points to the DaemonSet or StatefulSet that owns it | set by the controller |
| `PodTemplate.template` | The stored Pod template (`metadata` and `spec`) | required |
| `DaemonSet` or `StatefulSet` `.spec.revisionHistoryLimit` | Revisions kept | 10 |

Defaults and immutability are from the v1.37.0 OpenAPI spec.

## kubectl

```
kubectl get controllerrevisions                 # one per template version; CONTROLLER column names the owner
kubectl rollout history sts/rev                 # the same list, as revisions (also ds/<name>)
kubectl rollout history sts/rev --revision=2    # show the template of one revision
kubectl rollout undo sts/rev --to-revision=1    # restore an old template
kubectl get controllerrevision <name> -o yaml   # the stored data
kubectl get podtemplate                         # stored templates
kubectl explain controllerrevision              # says: immutable, mostly for internal use
```

`--revision=2` and `--to-revision=1` were not run; `--to-revision=99` was (see the failures table).

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `error: unable to find specified revision 99 in history` | `rollout undo --to-revision` names a revision that is not stored (never existed, or pruned beyond `revisionHistoryLimit`) | List real revisions with `kubectl rollout history` first |
| The ControllerRevision "rev-78bd46587f" is invalid: data: Invalid value: {...}: field is immutable | You tried to edit a stored snapshot; `data` cannot be changed once created (the object may only be deleted) | Change the DaemonSet or StatefulSet itself; the controller writes a new revision |
| `kubectl get pods` shows nothing after you created a PodTemplate | A PodTemplate is only a stored template; the workload controllers use their own `spec.template` (not verified that no built-in controller reads PodTemplate objects) | Reference the template yourself, or create a Deployment, Job or Pod from it |

All three rows were reproduced on the test cluster.

## Related

- **Cards:** DaemonSet; StatefulSet; Deployment and ReplicaSet (the Deployment equivalent); Owner references and garbage collection (group 2).
- **Chapter and lab:** Chapter 5.2 and Lab 5.2 (Vol 5).
- **Exam domain:** KCNA Kubernetes Fundamentals.
