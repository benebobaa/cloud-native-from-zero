# ServiceAccount

## What and why

A ServiceAccount is the identity a Pod uses when it talks to the API server. It gives each workload its own name and permissions instead of borrowing a person's.

**Acts on it:** the kubelet requests a short-lived token for each Pod through the TokenRequest API and mounts it as a projected volume. The kube-apiserver authenticates it as `system:serviceaccount:NAMESPACE:NAME`.

## Diagram

{{diagram serviceaccount-01.jsx | ServiceAccount token path · 5 steps}}

Pods never hold a permanent Secret token; the kubelet fetches and rotates a bound one.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-17). One ServiceAccount, two Pods: one gets the token mounted, one opts out.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata: {name: app, namespace: sa-demo}
---
apiVersion: v1
kind: Pod
metadata: {name: tokpod, namespace: sa-demo}
spec:
  serviceAccountName: app
  containers: [{name: c, image: busybox:1.37, command: [sleep, "3600"]}]
---
apiVersion: v1
kind: Pod
metadata: {name: notok, namespace: sa-demo}
spec:
  serviceAccountName: app
  automountServiceAccountToken: false
  containers: [{name: c, image: busybox:1.37, command: [sleep, "3600"]}]
```

```text
$ kubectl -n sa-demo exec tokpod -- ls /var/run/secrets/kubernetes.io/serviceaccount
ca.crt
namespace
token
$ kubectl -n sa-demo exec tokpod -- cat /var/run/secrets/kubernetes.io/serviceaccount/token | cut -d. -f2 | base64 -d | jq -c '{aud, exp, iss, sub, "kubernetes.io"}'
{"aud":["https://kubernetes.default.svc.cluster.local"],"exp":1826426706,"iss":"https://kubernetes.default.svc.cluster.local","sub":"system:serviceaccount:sa-demo:app","kubernetes.io":{"namespace":"sa-demo","node":{"name":"cnlab-worker",...},"pod":{"name":"tokpod",...},"serviceaccount":{"name":"app",...},"warnafter":1794894313}}
$ kubectl -n sa-demo exec notok -- ls /var/run/secrets/kubernetes.io/serviceaccount
ls: /var/run/secrets/kubernetes.io/serviceaccount: No such file or directory
$ kubectl -n sa-demo get pod tokpod -o jsonpath='{.spec.volumes[0].projected.sources[0]}'
{"serviceAccountToken":{"expirationSeconds":3607,"path":"token"}}
$ kubectl -n sa-demo create token app --duration=1h --audience=https://example.com | cut -d. -f2 | base64 -d | jq -c '{aud, sub}'
{"aud":["https://example.com"],"sub":"system:serviceaccount:sa-demo:app"}
```

The token in the Pod is a projected, time-limited token (`expirationSeconds: 3607` here) that the kubelet renews before it expires; its claims name the Pod, the node and the ServiceAccount. A new namespace gets a `default` ServiceAccount at once; no Secret is created for it.

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `automountServiceAccountToken` (ServiceAccount) | Mount an API token into Pods that use this account; the Pod field overrides it | not set (token is mounted) |
| `imagePullSecrets` (ServiceAccount) | Registry Secrets added to every Pod that uses this account | none |
| `secrets` (ServiceAccount) | Secrets Pods may use, enforced only with the `kubernetes.io/enforce-mountable-secrets` annotation | none |
| `pod.spec.serviceAccountName` | Account the Pod runs as; must exist in the Pod's namespace | `default` |
| `pod.spec.automountServiceAccountToken` | Pod-level switch for the token mount; wins over the ServiceAccount field | not set |
| `TokenRequest spec.expirationSeconds` | Requested token lifetime; the server may return a different one | chosen by the server (`kubectl create token --duration=0s`) |
| `TokenRequest spec.audiences` | Who the token is meant for | the API server's audience |
| `TokenRequest spec.boundObjectRef` | Pod or Secret the token is bound to; the token dies with it | none |
| `projected.sources.serviceAccountToken.expirationSeconds` | Lifetime of the token the kubelet mounts; rotated after 80% of it | 1 hour, minimum 10 minutes |

Fields and defaults are from the [v1.37.0 OpenAPI spec](https://github.com/kubernetes/kubernetes/tree/v1.37.0/api/openapi-spec/v3) and `kubectl create token --help` (v1.37.1). Every namespace gets a ServiceAccount named `default` automatically.

## kubectl

```
kubectl create serviceaccount app -n sec
kubectl get sa -n sec                                         # 'default' plus your accounts
kubectl create token app -n sec --duration=10m                # short-lived token, nothing stored
kubectl create token app -n sec --audience=https://example.com
kubectl run sa-pod -n sec --image=busybox:1.36 --overrides='{"spec":{"serviceAccountName":"app"}}' -- sleep 3600
kubectl exec -n sec sa-pod -- ls /var/run/secrets/kubernetes.io/serviceaccount   # ca.crt namespace token
kubectl patch sa app -n sec -p '{"automountServiceAccountToken":false}'
kubectl auth can-i --list -n sec --as=system:serviceaccount:sec:app   # what the account may do
kubectl set serviceaccount deploy/web app -n sec              # switch a Deployment's account
```

## How it fails

All four rows were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| A Pod's own API call fails: `Error from server (Forbidden): pods is forbidden: User "system:serviceaccount:sa-demo:default" cannot list resource "pods" in API group "" in the namespace "sa-demo"` | The Pod runs as the `default` ServiceAccount, which has no rights | Create a ServiceAccount, bind a Role to it (RBAC card), set `serviceAccountName` in the Pod template |
| Deployment shows `0/1`; the ReplicaSet event reads `Error creating: pods "ghost-766c8df5cc-" is forbidden: error looking up service account sa-demo/nosuch: serviceaccount "nosuch" not found` | `serviceAccountName` names a ServiceAccount that does not exist; the error is on the ReplicaSet, not the Deployment | Create the ServiceAccount (the Pod is then created on the next retry) or fix the name |
| `kubectl create token app --duration=5s` gives `error: failed to create token: TokenRequest.authentication.k8s.io "" is invalid: spec.expirationSeconds: Invalid value: 5: may not specify a duration less than 10 minutes` | Tokens live at least 10 minutes | Ask for `--duration=10m` or longer; for a Pod use the projected token, which the kubelet renews |
| A token that worked (`kubectl auth whoami` printed the ServiceAccount) answers `error: You must be logged in to the server (Unauthorized)` after `kubectl delete sa gone` | The token is bound to the ServiceAccount object: deleting the ServiceAccount revokes it. In the test the token was still accepted 2 s after the delete and refused at the next check, 10 s later; a token bound to a deleted Pod was still accepted 3 s after the Pod was deleted, so revocation is not instant | Create a new token. If a long-lived credential is unavoidable, create a Secret of type `kubernetes.io/service-account-token` with the annotation `kubernetes.io/service-account.name` (the test made one and a `token` key appeared in seconds), and treat it like a password |

## Related

- **Cards:** RBAC, Authentication, Pod, Secret, Downward API and projected volumes.
- **Chapter and lab:** 5.5.
- **Exam:** CKAD Application Environment, Configuration and Security (25%): understand ServiceAccounts.
