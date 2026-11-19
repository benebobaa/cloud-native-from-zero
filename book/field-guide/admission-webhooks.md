# Admission webhooks

## What and why

Admission webhooks let your own HTTPS service change or reject API requests after authorization. Mutating webhooks can patch the object; validating webhooks can only accept or reject. They suit rules the built-in checks cannot express, at the cost of running and securing a server.

**Acts on it:** the kube-apiserver calls the server named in a MutatingWebhookConfiguration or ValidatingWebhookConfiguration and obeys its answer.

## Diagram

{{diagram admission-webhooks-01.jsx | Admission webhook order · 5 stages}}

The webhook server is your code outside the API server: if it is down, requests can fail.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1, python:3.12-alpine for the server (2026-11-17). One 25-line Python HTTPS server in namespace `hooks` answers two paths: `/validate` denies Pods without an `owner` label, and `/mutate` adds the label `injected=by-webhook`. The certificate (made with `openssl`) is for `webhook.hooks.svc`, and its CA is the `caBundle`. Both configurations only match namespaces labelled `hook=on`.

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata: {name: require-owner}
webhooks:
- name: require-owner.example.com
  admissionReviewVersions: [v1]
  sideEffects: None
  failurePolicy: Fail
  timeoutSeconds: 5
  namespaceSelector: {matchLabels: {hook: "on"}}    # keeps the webhook away from kube-system and from its own namespace
  rules: [{apiGroups: [""], apiVersions: [v1], operations: [CREATE], resources: [pods]}]
  clientConfig: {service: {namespace: hooks, name: webhook, path: /validate}, caBundle: <base64 CA>}
```

The server's reply is a JSON `AdmissionReview` carrying the request's `uid`: `{"allowed": false, "status": {"code": 403, "message": "label \"owner\" is required"}}`. A mutating reply adds `"patchType": "JSONPatch"` and a base64 `patch`.

```text
$ kubectl -n shop run noowner --image=busybox:1.37 -- sleep 3600
Error from server: admission webhook "require-owner.example.com" denied the request: label "owner" is required
$ kubectl -n shop run withowner --image=busybox:1.37 --labels=owner=alice -- sleep 3600
pod/withowner created
$ kubectl -n shop get pod withowner --show-labels
NAME        READY   STATUS              RESTARTS   AGE   LABELS
withowner   0/1     ContainerCreating   0          1s    injected=by-webhook,owner=alice
```

The order is visible in the result: the mutating webhook ran first (it added `injected`), then the validating webhook saw the final object.

## Key fields

One `ValidatingWebhookConfiguration` or `MutatingWebhookConfiguration` holds a list of `webhooks`; each entry has these fields.

| Field | Meaning | Default |
| --- | --- | --- |
| `webhooks[].name` | Fully qualified name, for example `pinned-tags.demo.example.com` | required |
| `webhooks[].clientConfig.service` | Service name, namespace, path and port of an in-cluster webhook server | port 443 |
| `webhooks[].clientConfig.url` | External `https://` URL; use `service` or `url`, never both | none |
| `webhooks[].clientConfig.caBundle` | PEM CA that signed the webhook server's certificate | API server system trust roots |
| `webhooks[].rules` | API groups, versions, resources and operations (`CREATE`, `UPDATE`, `DELETE`, `CONNECT`) to send | none: nothing matches |
| `webhooks[].rules[].scope` | `Cluster`, `Namespaced` or `*` | `*` |
| `webhooks[].namespaceSelector` / `objectSelector` | Labels that a namespace or object must carry to be sent | match everything |
| `webhooks[].failurePolicy` | `Fail` rejects the request when the webhook is unreachable; `Ignore` lets it through | `Fail` |
| `webhooks[].timeoutSeconds` | Seconds to wait for the webhook, 1 to 30 | 10 |
| `webhooks[].sideEffects` | `None` or `NoneOnDryRun`; tells the API server if dry-run calls are safe | required |
| `webhooks[].admissionReviewVersions` | `AdmissionReview` versions the server understands, usually `["v1"]` | required |
| `webhooks[].reinvocationPolicy` (mutating only) | `IfNeeded` calls the webhook again after later mutations | `Never` |

Fields and defaults are from the [v1.37.0 OpenAPI spec](https://github.com/kubernetes/kubernetes/tree/v1.37.0/api/openapi-spec/v3) (`admissionregistration.k8s.io/v1`); `matchPolicy` also exists and defaults to `Equivalent`.

## kubectl

```
kubectl apply -f cfg.yaml                                         # create the webhook configurations
kubectl get validatingwebhookconfigurations,mutatingwebhookconfigurations
kubectl get validatingwebhookconfiguration demo-validate -o yaml  # rules, selectors, failurePolicy, caBundle
kubectl label ns hook-test webhook=enabled                        # opt a namespace in (namespaceSelector)
kubectl -n hook-test run good --image=nginx:1.27                  # the API server calls the webhook here
kubectl -n hook-test get pod good --show-labels                   # see what the mutating webhook added
kubectl -n webhook-demo logs deploy/demo-webhook                  # the webhook server's own log
kubectl -n webhook-demo get endpointslices                        # is a Ready Pod behind the webhook Service?
kubectl patch validatingwebhookconfiguration demo-validate --type=json \
  -p '[{"op":"replace","path":"/webhooks/0/failurePolicy","value":"Ignore"}]'   # fail open
kubectl delete validatingwebhookconfiguration demo-validate       # emergency exit when a webhook blocks the cluster
```

## How it fails

All rows were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Error from server (InternalError): Internal error occurred: failed calling webhook "require-owner.example.com": failed to call webhook: Post "https://webhook.hooks.svc:443/validate?timeout=5s": dial tcp 10.96.139.214:443: connect: connection refused` for every Pod in `hook=on` namespaces | The webhook server has no ready endpoints (scaled to 0 in the test) and `failurePolicy: Fail` blocks the request | Restore the server (several replicas plus a PodDisruptionBudget); use `failurePolicy: Ignore` only where skipping the check is safe |
| `... Post "https://webhook.hooks.svc:443/validate?timeout=5s": tls: failed to verify certificate: x509: certificate is valid for wrong.example.svc, not webhook.hooks.svc` | The serving certificate's names do not include the Service DNS name `<service>.<namespace>.svc` | Re-issue the certificate with `subjectAltName=DNS:webhook.hooks.svc`; the `caBundle` must be the CA that signed it |
| Deployment `webhook` shows `0/1` after being scaled from 0 to 1; event `Error creating: Internal error occurred: failed calling webhook "guard-everything.example.com": ... connect: connection refused`; no Pod ever appears | A second configuration without `namespaceSelector` also matches Pods in `hooks`: the webhook cannot start because it is not running to approve its own Pod. The cluster stays stuck until `kubectl delete validatingwebhookconfiguration guard-everything`, after which the Pod appeared within 20 s | Exclude the webhook's own namespace and `kube-system` with `namespaceSelector` (or `objectSelector`), as the first configuration does |

One more error text worth knowing, seen while developing the test server: `received invalid webhook response: validating webhook may not return response.patch`. It appeared because a bug sent a mutation reply to the validating path; validating webhooks may only allow or deny.

## Related

- **Cards:** ValidatingAdmissionPolicy, MutatingAdmissionPolicy, Pod Security Admission, kube-apiserver (group 1).
- **Chapter and lab:** 6.3.
- **Exam:** CKAD Application Environment, Configuration and Security (25%): authentication, authorization and admission control.
