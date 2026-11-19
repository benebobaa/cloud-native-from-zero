# MutatingAdmissionPolicy

## What and why

MutatingAdmissionPolicy changes objects with CEL expressions that run inside the API server, instead of calling a mutating webhook. It is served as `admissionregistration.k8s.io/v1`; the Kubernetes docs list it as Stable since v1.36, first available in v1.30 ([source](https://kubernetes.io/docs/reference/access-authn-authz/mutating-admission-policy/)).

**Acts on it:** the mutating-policy admission plugin in the kube-apiserver. A policy does nothing until a MutatingAdmissionPolicyBinding names it.

## Diagram

{{diagram mutatingadmissionpolicy-01.jsx | Policy, binding, parameters · 5 links}}

Same two-object shape as ValidatingAdmissionPolicy, but the output is a patch instead of a verdict.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0` (the API is `admissionregistration.k8s.io/v1` in 1.37), kubectl v1.37.1 (2026-11-17). The policy adds a label with an apply configuration and an annotation with a JSON patch, for new Pods in namespaces labelled `env=prod`.

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingAdmissionPolicy
metadata: {name: add-team-label}
spec:
  failurePolicy: Fail
  reinvocationPolicy: Never          # required: Never or IfNeeded
  matchConstraints:
    resourceRules: [{apiGroups: [""], apiVersions: [v1], operations: [CREATE], resources: [pods]}]
  mutations:
  - patchType: ApplyConfiguration
    applyConfiguration:
      expression: >
        Object{ metadata: Object.metadata{ labels: {"team": "payments"} } }
  - patchType: JSONPatch
    jsonPatch:
      expression: >
        [JSONPatch{op: "add", path: "/metadata/annotations", value: {"mutated-by": "map"}}]
---
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingAdmissionPolicyBinding
metadata: {name: add-team-label}
spec:
  policyName: add-team-label
  matchResources: {namespaceSelector: {matchLabels: {env: prod}}}
```

```text
$ kubectl -n prod run mp --image=busybox:1.37 -- sleep 3600
pod/mp created
$ kubectl -n prod get pod mp -o jsonpath='{.metadata.labels} {.metadata.annotations}'
{"run":"mp","team":"payments"} {"mutated-by":"map"}
$ kubectl -n dev run mp --image=busybox:1.37 -- sleep 3600      # namespace without env=prod
$ kubectl -n dev get pod mp --show-labels
NAME   READY   STATUS              RESTARTS   AGE   LABELS
mp     0/1     ContainerCreating   0          0s    run=mp
```

The mutation happens inside kube-apiserver, before validation and before the object is stored; no webhook server and no certificates are needed.

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| Policy `spec.matchConstraints.resourceRules` | API groups, versions, operations and resources the policy can change | none: nothing matches |
| Policy `spec.matchConditions` | CEL filters; the policy skips a request when one is `false`, for example "label already set" | match all |
| Policy `spec.mutations[].patchType` | `ApplyConfiguration` (merge an `Object{...}`) or `JSONPatch` (a list of `JSONPatch{...}` ops) | required |
| Policy `spec.mutations[].applyConfiguration.expression` | CEL that returns the partial object to merge, server-side apply style | required for that type |
| Policy `spec.mutations[].jsonPatch.expression` | CEL that returns JSON Patch operations | required for that type |
| Policy `spec.reinvocationPolicy` | `Never` or `IfNeeded`: run again if a later mutation changed the object | required |
| Policy `spec.failurePolicy` | `Fail` or `Ignore` when an expression errors | `Fail` |
| Policy `spec.paramKind` / `spec.variables` | Parameter object kind; named CEL helper values | none |
| Binding `spec.policyName` | The policy this binding switches on | required |
| Binding `spec.matchResources` | Narrows the policy, for example with a `namespaceSelector` | all matched resources |
| Binding `spec.paramRef` | The parameter object for this binding | no parameters |

Fields and defaults are from the [v1.37.0 OpenAPI spec](https://github.com/kubernetes/kubernetes/tree/v1.37.0/api/openapi-spec/v3) (`admissionregistration.k8s.io/v1`). Unlike the validating binding, this binding has no `validationActions`.

## kubectl

```
kubectl api-resources --api-group=admissionregistration.k8s.io    # is the API served?
kubectl apply -f map.yaml                                          # policy and binding
kubectl get mutatingadmissionpolicies,mutatingadmissionpolicybindings
kubectl -n map-demo run p4 --image=nginx:1.27 --dry-run=server \
  -o jsonpath='{.metadata.labels}'                                  # see the mutation without creating a Pod
kubectl -n map-demo get pod p1 --show-labels                       # check a real Pod
kubectl get mutatingadmissionpolicy add-team-label -o jsonpath='{.status}'
kubectl explain mutatingadmissionpolicy.spec.mutations
kubectl delete mutatingadmissionpolicybinding add-team-label-binding   # switch it off
```

## How it fails

All rows were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `The MutatingAdmissionPolicy "bad-patch" is invalid: spec.reinvocationPolicy: Required value` | `reinvocationPolicy` has no default and must be set (`Never` or `IfNeeded`) | Add it; use `IfNeeded` only when another mutator may change the object after yours |
| `The MutatingAdmissionPolicy "bad-cel" is invalid: spec.mutations[0].applyConfiguration.expression: Invalid value: "Object{ metadata: ...": compilation failed: ERROR: <input>:1:55: Syntax error: mismatched input '<EOF>' expecting {'}', ','}` | The CEL expression does not parse | Fix the expression; the API server checks syntax when the policy is applied |
| `The pods "mp2" is invalid: : policy 'bad-patch' with binding 'bad-patch' denied request: JSON Patch: add operation does not apply: doc is missing path: "/spec/nosuchfield/x": missing value` | The expression compiled but the patch fails on the real object, and `failurePolicy: Fail` turns that into a denial of every matching request | A JSON Patch `add` needs the parent path to exist; use `ApplyConfiguration` for nested fields, or set `failurePolicy: Ignore` while you test, and bind to a test namespace first |

A policy with no binding changes nothing: with the policy applied but unbound, a Pod created in an `env=prod` namespace came out without the `team` label and without any message.

## Related

- **Cards:** ValidatingAdmissionPolicy, Admission webhooks, kube-apiserver (group 1).
- **Chapter and lab:** 6.3.
- **Exam:** CKAD Application Environment, Configuration and Security (25%): authentication, authorization and admission control.
