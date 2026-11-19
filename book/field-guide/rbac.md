# RBAC

## What and why

Role-based access control (RBAC) decides what an authenticated subject may do, as lists of allowed verbs on resources. Access is denied unless some rule allows it, and the rules are ordinary objects you can review.

**Acts on it:** the RBAC authorizer inside the kube-apiserver evaluates Role, ClusterRole, RoleBinding and ClusterRoleBinding objects on every request.

## Diagram

{{diagram rbac-01.jsx | RBAC objects · 4 kinds}}

Permission = a subject, a binding and a role; remove any one and access disappears.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-17). `jane` is the user from the Authentication card (certificate kubeconfig `jane.kc`). She may read Pods in one namespace and nothing else.

```bash
kubectl create ns rbac-demo
kubectl -n rbac-demo create role pod-reader --verb=get,list,watch --resource=pods
kubectl -n rbac-demo create rolebinding jane-pods --role=pod-reader --user=jane
```

```text
$ kubectl auth can-i list pods -n rbac-demo --as=jane
yes
$ kubectl auth can-i delete pods -n rbac-demo --as=jane
no
$ kubectl auth can-i list pods -n default --as=jane
no
$ kubectl --kubeconfig=jane.kc -n rbac-demo get pods
NAME                   READY   STATUS              RESTARTS   AGE
web-74478f6647-6qr8p   0/1     ContainerCreating   0          4s
$ kubectl --kubeconfig=jane.kc -n rbac-demo get deploy
Error from server (Forbidden): deployments.apps is forbidden: User "jane" cannot list resource "deployments" in API group "apps" in the namespace "rbac-demo"
$ kubectl -n rbac-demo get rolebinding jane-pods -o yaml | sed -n '/roleRef/,$p'
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pod-reader
subjects:
- apiGroup: rbac.authorization.k8s.io
  kind: User
  name: jane
```

A Role and RoleBinding apply to one namespace. A `ClusterRoleBinding` to a ClusterRole grants across the cluster: after `kubectl create clusterrolebinding jane-nodes --clusterrole=node-reader --user=jane`, `kubectl --kubeconfig=jane.kc get nodes` lists both nodes. The built-in `view`, `edit`, `admin` and `cluster-admin` ClusterRoles exist on every cluster; `view` is an aggregated role (`aggregationRule` selects ClusterRoles labelled `rbac.authorization.k8s.io/aggregate-to-view: "true"`), so a ClusterRole written for a CRD joins it by carrying that label.

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `rules[].apiGroups` | API groups the rule covers; `""` is the core group (pods, secrets) | none |
| `rules[].resources` | Resources such as `pods` or a subresource such as `pods/log`; `*` = all | none |
| `rules[].verbs` | `get`, `list`, `watch`, `create`, `update`, `patch`, `delete`, plus special verbs like `bind`, `escalate`, `impersonate`; `*` = all | required |
| `rules[].resourceNames` | Limit the rule to named objects | empty = all names |
| `rules[].nonResourceURLs` | Paths like `/healthz`; ClusterRole only | none |
| `aggregationRule.clusterRoleSelectors` | ClusterRole whose rules the controller fills from other ClusterRoles with matching labels | not set |
| `roleRef` (`apiGroup`, `kind`, `name`) | The Role or ClusterRole a binding grants; immutable after creation | required |
| `subjects[].kind` | `User`, `Group` or `ServiceAccount` | required |
| `subjects[].namespace` | Namespace of a ServiceAccount subject; empty for users and groups | none |
| `subjects[].apiGroup` | `""` for ServiceAccount, `rbac.authorization.k8s.io` for User and Group | as stated |

Fields and defaults are from the [v1.37.0 OpenAPI spec](https://github.com/kubernetes/kubernetes/tree/v1.37.0/api/openapi-spec/v3). RBAC only adds permissions: there are no deny rules.

## kubectl

```
kubectl create role pod-reader -n sec --verb=get,list,watch --resource=pods
kubectl create rolebinding app-pod-reader -n sec --role=pod-reader --serviceaccount=sec:app
kubectl create clusterrole cr-low --verb=get --resource=pods
kubectl create clusterrolebinding jane-low --clusterrole=cr-low --user=jane
kubectl create rolebinding view-sec -n sec --clusterrole=view --group=dev-team   # reuse a ClusterRole in one namespace
kubectl auth can-i list pods -n sec --as=system:serviceaccount:sec:app           # test before handing out
kubectl auth can-i --list -n sec --as=jane                                       # everything a user may do
kubectl get role,rolebinding -n sec -o wide
kubectl get clusterrole view -o yaml                                             # built-in roles: view, edit, admin, cluster-admin
kubectl describe rolebinding app-pod-reader -n sec
kubectl auth reconcile -f rbac.yaml                                              # apply RBAC files, keeping existing grants
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Error from server (Forbidden): deployments.apps is forbidden: User "jane" cannot list resource "deployments" in API group "apps" in the namespace "rbac-demo"` | No rule allows that verb on that resource in that namespace; the message names the user, verb, resource, API group and namespace, which is exactly the rule to add | Add the verb and `apiGroups` to the Role (note `apps`, not `""`), or bind a broader role; confirm with `kubectl auth can-i <verb> <resource> -n <ns> --as=<user>` |
| `The RoleBinding "jane-pods" is invalid: roleRef: Invalid value: {"APIGroup":"rbac.authorization.k8s.io","Kind":"Role","Name":"other"}: field is immutable` | `roleRef` cannot be changed after creation | Delete the binding and create a new one |
| `error: failed to create rolebinding: rolebindings.rbac.authorization.k8s.io "steal" is forbidden: user "jane" (groups=["dev" "system:authenticated"]) is attempting to grant RBAC permissions not currently held: {APIGroups:[""], Resources:["secrets"], Verbs:["get"]}` | Escalation prevention: you cannot grant rights you do not hold, even if you may create RoleBindings | Have someone who holds the permission create the binding, or give the user the `escalate` and `bind` verbs deliberately |

A binding to a Role that does not exist is accepted without error (`kubectl create rolebinding dangling --role=nosuch --user=bob` printed `created`); `kubectl auth can-i get pods -n rbac-demo --as=bob` then answers `no - rbac: RBAC: role.rbac.authorization.k8s.io "nosuch" not found`, which names the missing Role.

## Related

- **Cards:** ServiceAccount, Access reviews, Authentication, Namespace (group 2).
- **Chapter and lab:** 5.5.
- **Exam:** CKA Cluster Architecture, Installation and Configuration (25%): manage role-based access control; CKAD Application Environment, Configuration and Security (25%).
