# ValidatingAdmissionPolicy

## What and why

ValidatingAdmissionPolicy accepts or rejects objects with rules written in the Common Expression Language (CEL) that run inside the API server, so no webhook server is needed. A policy holds the rules; a binding switches them on for chosen namespaces or resources. It is served as `admissionregistration.k8s.io/v1`.

**Acts on it:** the ValidatingAdmissionPolicy admission plugin in the kube-apiserver.

## Diagram

{{diagram validatingadmissionpolicy-01.jsx | Policy, binding, parameters · 5 links}}

Validating rules are data, not a server: apply two objects and the API server enforces them.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-17). The policy limits Deployments to 5 replicas; the binding switches it on only for namespaces labelled `env=prod`.

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata: {name: replica-limit}
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules: [{apiGroups: [apps], apiVersions: [v1], operations: [CREATE, UPDATE], resources: [deployments]}]
  validations:
  - expression: "object.spec.replicas <= 5"
    messageExpression: "'replicas must be 5 or fewer, got ' + string(object.spec.replicas)"
    reason: Invalid
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata: {name: replica-limit-prod}
spec:
  policyName: replica-limit
  validationActions: [Deny]
  matchResources: {namespaceSelector: {matchLabels: {env: prod}}}
```

```text
$ kubectl get validatingadmissionpolicy,validatingadmissionpolicybinding
NAME                                                                   VALIDATIONS   PARAMKIND   AGE
validatingadmissionpolicy.admissionregistration.k8s.io/replica-limit   1             <unset>     4s
NAME                                                                               POLICYNAME      PARAMREF   AGE
validatingadmissionpolicybinding.admissionregistration.k8s.io/replica-limit-prod   replica-limit   <unset>    4s
$ kubectl -n prod create deploy big --image=nginx:1.31.8 --replicas=6
error: failed to create deployment: deployments.apps "big" is forbidden: ValidatingAdmissionPolicy 'replica-limit' with binding 'replica-limit-prod' denied request: replicas must be 5 or fewer, got 6
$ kubectl -n prod create deploy ok --image=nginx:1.31.8 --replicas=2
deployment.apps/ok created
$ kubectl -n dev create deploy big --image=nginx:1.31.8 --replicas=6      # namespace without env=prod
deployment.apps/big created
```

With `validationActions: [Warn, Audit]` the same request is accepted and kubectl prints `Warning: Validation failed for ValidatingAdmissionPolicy 'replica-limit' with binding 'replica-limit-prod': replicas must be 5 or fewer, got 7` while the API server writes an audit annotation. No webhook server is involved: the CEL runs inside kube-apiserver.

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| Policy `spec.matchConstraints.resourceRules` | API groups, versions, operations and resources the policy can check | none: nothing matches |
| Policy `spec.validations[].expression` | CEL expression that must return `true`; sees `object`, `oldObject`, `request`, `params` | required |
| Policy `spec.validations[].message` / `messageExpression` | Text returned when the expression is `false` | `failed rule: {Rule}` |
| Policy `spec.validations[].reason` | `Unauthorized`, `Forbidden`, `Invalid` or `RequestEntityTooLarge` | `Invalid` |
| Policy `spec.matchConditions` | Extra CEL filters; a request skips the policy if one is `false` | match all |
| Policy `spec.paramKind` | apiVersion and kind of the object that holds parameters | no parameters |
| Policy `spec.failurePolicy` | What happens when an expression errors or a parameter is missing: `Fail` or `Ignore` | `Fail` |
| Binding `spec.policyName` | The policy this binding switches on | required |
| Binding `spec.validationActions` | Any of `Deny`, `Warn`, `Audit` (not `Deny` with `Warn`) | required |
| Binding `spec.matchResources` | Narrows the policy, for example with a `namespaceSelector` | all matched resources |
| Binding `spec.paramRef` | `name` or `selector` of the parameter object, plus `parameterNotFoundAction` (`Allow` or `Deny`) | no parameters |

Fields and defaults are from the [v1.37.0 OpenAPI spec](https://github.com/kubernetes/kubernetes/tree/v1.37.0/api/openapi-spec/v3) (`admissionregistration.k8s.io/v1`). Stable since v1.30 ([Validating Admission Policy](https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/)). A policy without a binding does nothing.

## kubectl

```
kubectl apply -f policy.yaml                                      # policy and binding in one file
kubectl get validatingadmissionpolicies,validatingadmissionpolicybindings
kubectl get validatingadmissionpolicy replicas-limit -o jsonpath='{.status}'   # typeChecking warnings
kubectl -n vap-demo create deployment big --image=nginx:1.27 --replicas=9      # test: should be denied
kubectl -n vap-demo apply --dry-run=server -f deploy.yaml         # test without creating anything
kubectl patch validatingadmissionpolicybinding replicas-limit-binding --type=merge \
  -p '{"spec":{"validationActions":["Warn","Audit"]}}'             # roll out softly first
kubectl explain validatingadmissionpolicy.spec.validations
kubectl delete validatingadmissionpolicybinding replicas-limit-binding         # switch the policy off
```

## How it fails

All rows were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `The ValidatingAdmissionPolicy "syntax" is invalid: spec.validations[0].expression: Invalid value: "object.spec.replicas <= ": compilation failed: ERROR: <input>:1:25: Syntax error: mismatched input '<EOF>' expecting {...}` | The CEL expression does not parse; the API server rejects the policy | Fix the expression; test small ones with `kubectl apply --dry-run=server` |
| Policy applies fine, but `kubectl get validatingadmissionpolicy broken -o jsonpath='{.status.typeChecking}'` shows `undefined field 'replica'` or `found no matching overload for '_<=_' applied to '(int, string)'` | A well-formed expression that does not fit the resource's schema is accepted; type checking reports warnings in `status.typeChecking` and the rule will fail at request time | After every apply read `status.typeChecking`; correct the field name or the types (`replicas <= 5`, not `'5'`) |
| `kubectl -n prod create deploy latest --image=nginx:latest` succeeds although policy `no-latest` forbids `:latest` | A policy without a binding does nothing: no error, no warning | Create a `ValidatingAdmissionPolicyBinding` with `policyName` and a `validationActions`; check `kubectl get validatingadmissionpolicybinding` |
| ` denied request: failed to configure binding: no params found for policy binding with  `Deny`  parameterNotFoundAction ` for every Deployment in the bound namespaces; after creating the ConfigMap the message becomes `denied request: limit is 2` | The binding's `paramRef` names an object that does not exist, and `parameterNotFoundAction: Deny` makes that a denial | Create the parameter object (same name and namespace as `paramRef`), or use `parameterNotFoundAction: Allow` while rolling out |

## Related

- **Cards:** Admission webhooks, MutatingAdmissionPolicy, Pod Security Admission, kube-apiserver (group 1).
- **Chapter and lab:** 6.3.
- **Exam:** CKAD Application Environment, Configuration and Security (25%): authentication, authorization and admission control.
