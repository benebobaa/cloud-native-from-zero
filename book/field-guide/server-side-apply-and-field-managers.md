# Server-side apply and field managers

## What and why

Several actors edit one object: you with kubectl, a controller that adds a field, a GitOps tool. If each replaces the whole object, the last writer silently erases the others' work. **Server-side apply (SSA)** moves the merge into the API server, which tracks which manager owns which field in `metadata.managedFields` ([server-side apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/)). Each apply request names its field manager; the server merges only the fields the applier declares.

A **conflict** happens when an applier changes a field that another manager also claims with a different value. The request fails with `409` unless the applier forces it (`--force-conflicts`), which takes the field over and removes it from the other managers. If two appliers set the same value they share ownership. A field you stop declaring is removed only if you were its sole owner. SSA replaces the older `kubectl.kubernetes.io/last-applied-configuration` annotation approach.

## Diagram

{{diagram server-side-apply-and-field-managers-01.jsx | Field ownership · 2 managers, 3 fields}}
Ownership is tracked per field: equal values share ownership, different values conflict, and forcing takes the field over.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). Two teams apply to one ConfigMap, each under its own field-manager name:

```
$ cat cmf.yaml
apiVersion: v1
kind: ConfigMap
metadata: {name: shared}
data: {a: "1", b: "1"}
$ kubectl apply --server-side -f cmf.yaml --field-manager=team-a
configmap/shared serverside-applied
$ # team-b applies {a: "1", c: "9"}: same value for a, new field c
$ kubectl apply --server-side -f - --field-manager=team-b
configmap/shared serverside-applied
$ kubectl get cm shared --show-managed-fields -o jsonpath='{range .metadata.managedFields[*]}{.manager}/{.operation}/{.fieldsV1}{"\n"}{end}'
team-a/Apply/{"f:data":{"f:a":{},"f:b":{}}}
team-b/Apply/{"f:data":{"f:a":{},"f:c":{}}}
$ # team-b now applies {a: "2"}: a different value for a field team-a also owns
$ kubectl apply --server-side -f - --field-manager=team-b
error: Apply failed with 1 conflict: conflict with "team-a": .data.a
Please review the fields above--they currently have other managers. Here
are the ways you can resolve this warning:
* If you intend to manage all of these fields, please re-run the apply
  command with the `--force-conflicts` flag.
* If you do not intend to manage all of the fields, please edit your
  manifest to remove references to the fields that should keep their
  current managers.
* You may co-own fields by updating your manifest to match the existing
  value; in this case, you'll become the manager if the other manager(s)
  stop managing the field (remove it from their configuration).
See https://kubernetes.io/docs/reference/using-api/server-side-apply/#conflicts
```

Both teams own `.data.a` while they agree on its value; the conflict appears only when one tries to change it. The object kept `a: "1", b: "1", c: "9"`.

## Key fields

| Field or flag | Meaning | Default |
| --- | --- | --- |
| `kubectl apply --server-side` | Send the manifest as a server-side apply patch instead of merging in the client | false |
| `--field-manager=NAME` | Identity recorded for the fields you apply | `kubectl-client-side-apply` (the flag's default in kubectl 1.37) |
| `--force-conflicts` | Take over fields owned by other managers | false |
| `--dry-run=server` | Run the apply on the server without saving | none |
| `--show-managed-fields` (get) | Include `metadata.managedFields` in the output | false |
| `metadata.managedFields[].manager` | Name of the field manager | set by the server |
| `metadata.managedFields[].operation` | `Apply` or `Update` (any other write, such as scale or a controller update) | set by the server |
| `metadata.managedFields[].subresource` | Which subresource the change went through (for example `scale`) | empty |
| `metadata.managedFields[].fieldsV1` | The set of fields the manager owns | set by the server |

Flag defaults are from `kubectl apply --help` (v1.37.1); managedFields meanings are from the server-side apply documentation.

## kubectl

```
kubectl apply --server-side -f app.yaml --field-manager=team-a
kubectl apply --server-side -f app.yaml --field-manager=team-b --force-conflicts
kubectl apply --server-side --dry-run=server -f app.yaml     # see conflicts without changing anything
kubectl get deploy ssa --show-managed-fields -o yaml          # who owns what
kubectl get cm shared --show-managed-fields -o jsonpath='{range .metadata.managedFields[*]}{.manager}/{.operation}{"\n"}{end}'
kubectl patch ... --field-manager=my-tool                     # name your own tool's writes (not run)
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `error: Apply failed with 1 conflict: conflict with "kubectl" with subresource "scale" using apps/v1: .spec.replicas` (a Deployment `ssa` applied by `team-a`, then `kubectl scale ... --replicas=4`, then `team-b` applied `replicas: 3`) | `kubectl scale` wrote `.spec.replicas` as manager `kubectl` through the `scale` subresource, so it owns that field | Re-run with `--force-conflicts` (it then succeeded and `team-b` became owner), or drop `replicas` from your manifest to keep the other owner |
| `Warning: resource deployments/ssa is missing the kubectl.kubernetes.io/last-applied-configuration annotation which is required by kubectl apply...` | A plain client-side `kubectl apply` was run on an object created with server-side apply | Stay with one method per object; use `--server-side` consistently |
| `kubectl apply --server-side` dry run shows no change but a field is unexpectedly reset later (not reproduced) | Another manager (a controller, an HPA) owns the field and writes it | Find the owner in `managedFields` and remove that field from your manifest |

## Related

- **Cards:** Objects, spec and status; Watch and resourceVersion; Labels, selectors and annotations; Helm and Kustomize (group 11); Operators and custom controllers (group 10).
- **Chapter and lab:** Chapter 5.1 and Lab 5.1 (Vol 5); Kustomize and GitOps use in Chapter 7.1.
- **Exam domain:** KCNA Kubernetes Fundamentals. Server-side apply is not named in the [CKA](https://github.com/cncf/curriculum/blob/main/CKA_Curriculum_v1.37.pdf) or [CKAD](https://github.com/cncf/curriculum/blob/main/CKAD_Curriculum_v1.37.pdf) 1.37 curriculum; it is background for the declarative deployment skills (Helm, Kustomize, rolling updates) in CKAD Application Deployment.
