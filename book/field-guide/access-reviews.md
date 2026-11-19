# Access reviews

## What and why

Access reviews are create-only API objects that ask the authorizer a question instead of doing the action: can I, can they, what can I do here. They let you test permissions without trying the real call, and `kubectl auth can-i` is built on them.

**Acts on it:** the kube-apiserver evaluates the question with the same authorizers it uses for real requests and returns the answer in `status`.

## Diagram

{{diagram access-reviews-01.jsx | Access review objects · 4 kinds}}

kubectl auth can-i is a thin wrapper around these objects.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-17), with `jane` and the `pod-reader` Role from the RBAC card. Each review is created, never stored; the answer comes back in `status`.

```yaml
apiVersion: authorization.k8s.io/v1
kind: SubjectAccessReview
spec:
  user: jane
  resourceAttributes: {namespace: rbac-demo, verb: list, resource: pods}
```

```text
$ kubectl create -f sar.yaml -o yaml | sed -n '/status/,$p'
status:
  allowed: true
  reason: 'RBAC: allowed by RoleBinding "jane-pods/rbac-demo" of Role "pod-reader" to User "jane"'
$ kubectl create -f sar-delete.yaml -o jsonpath='{.status}'        # verb: delete
{"allowed":false}
$ kubectl -n rbac-demo create -f lsar.yaml -o jsonpath='{.status}'  # LocalSubjectAccessReview, verb: get
{"allowed":true,"reason":"RBAC: allowed by RoleBinding \"jane-pods/rbac-demo\" of Role \"pod-reader\" to User \"jane\""}
$ kubectl auth can-i --list -n rbac-demo --as=jane | head -8      # built on SelfSubjectRulesReview
Resources                                       Non-Resource URLs   Resource Names   Verbs
selfsubjectreviews.authentication.k8s.io        []                  []               [create]
selfsubjectaccessreviews.authorization.k8s.io   []                  []               [create]
selfsubjectrulesreviews.authorization.k8s.io    []                  []               [create]
rolebindings.rbac.authorization.k8s.io          []                  []               [create]
pods                                            []                  []               [get list watch]
nodes                                           []                  []               [get list]
```

`kubectl auth can-i list pods -n rbac-demo --as=jane` is a `SelfSubjectAccessReview` sent with impersonation headers. The four reviews are: `SelfSubjectAccessReview` (may I?), `SelfSubjectRulesReview` (what may I do in this namespace?), `SubjectAccessReview` (may this user?), `LocalSubjectAccessReview` (same, limited to one namespace).

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.user`, `spec.groups` (SubjectAccessReview) | Who to test; a user without groups is tested as a member of no groups | none |
| `spec.resourceAttributes.verb` | Verb to test (`get`, `list`, `delete`, ...); `*` = all | none |
| `spec.resourceAttributes.resource`, `.group`, `.subresource` | What is accessed; `""` group = core | none |
| `spec.resourceAttributes.namespace` | Namespace of the action; LocalSubjectAccessReview fills it from its own namespace | `""` (all) |
| `spec.resourceAttributes.name` | One object name; `""` = any | `""` |
| `spec.nonResourceAttributes` | A path such as `/healthz` instead of a resource; set exactly one of the two | none |
| `status.allowed` | `true` if the action would be allowed | `false` |
| `status.denied`, `status.reason` | Explicit denial and the authorizer's explanation | not set |
| `spec.namespace` (SelfSubjectRulesReview) | Namespace whose rules to list | required |
| `status.incomplete` (rules review) | `true` when an authorizer (for example a webhook) cannot list its rules | `false` |

Fields and defaults are from the [v1.37.0 OpenAPI spec](https://github.com/kubernetes/kubernetes/tree/v1.37.0/api/openapi-spec/v3). All four review kinds support only `create`: nothing is stored, the answer comes back in `status`.

## kubectl

```
kubectl auth can-i create deployments -n sec                          # SelfSubjectAccessReview: yes / no
kubectl auth can-i '*' '*'                                            # am I cluster-admin?
kubectl auth can-i --list -n sec                                      # SelfSubjectRulesReview: all my rules
kubectl auth can-i list pods -n sec --as=system:serviceaccount:sec:app   # SubjectAccessReview via impersonation
kubectl auth can-i get pods -n sec --as=jane --as-group=dev-team      # include group membership
kubectl auth can-i get pods/log -n sec                                # subresource (or --subresource=log)
kubectl auth can-i get pods -A -q; echo $?                            # quiet: exit code 0 = yes
kubectl create -f sar.yaml -o yaml                                    # raw review object; read .status
kubectl -v=8 auth can-i get pods -n sec                               # shows the POST to .../selfsubjectaccessreviews
```

## How it fails

All three were reproduced on the test cluster, with the limited user `jane`.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Error from server (Forbidden): selfsubjectaccessreviews.authorization.k8s.io is forbidden: User "jane" cannot impersonate-on:user-info:create resource "selfsubjectaccessreviews" in API group "authorization.k8s.io" at the cluster scope` after `kubectl auth can-i ... --as=bob` | `--as` is impersonation, and impersonating needs its own RBAC permission | Run as an administrator, or grant `impersonate` on `users` to the person who must test other users' access |
| `Error from server (Forbidden): ... subjectaccessreviews.authorization.k8s.io is forbidden: User "jane" cannot create resource "subjectaccessreviews" in API group "authorization.k8s.io" at the cluster scope` | Asking about someone else needs `create` on `subjectaccessreviews`; only the Self reviews are open to every authenticated user (they are in `can-i --list` above). Without `--validate=false` kubectl first fails with a CRD-list error, which hides this one | Grant `create` on `subjectaccessreviews` to the tool that needs it (admission webhooks and proxies do) |
| `Warning: the server doesn't have a resource type 'podz'` followed by `no` | A typo in the resource name; the answer `no` is not about permissions. `pods.apps` gives the same warning because Pods are in the core group | Check `kubectl api-resources` for the exact name and group before trusting a `no` |

An answer that looks wrong may be right: `can-i` reports what RBAC (and the other authorizers) say, not what an admission policy will later do. `kubectl auth can-i get pods -n rbac-demo --as=jane --subresource=log` prints `no` because the Role names `pods` but not `pods/log`.

## Related

- **Cards:** RBAC, Authentication, ServiceAccount.
- **Chapter and lab:** 5.5.
- **Exam:** no curriculum line of its own (checked in the CKA and CKAD v1.37 curriculum PDFs, [cncf/curriculum](https://github.com/cncf/curriculum), 2026-11-17); `kubectl auth can-i` is the fast check inside CKA and CKAD RBAC and ServiceAccount tasks.
