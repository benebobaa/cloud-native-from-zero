# Authentication

## What and why

Authentication answers "who is calling?" for every API request. Kubernetes keeps no user database: the identity comes from the credential, such as a client certificate (CN is the user, O the groups), a ServiceAccount token, an OIDC token or an authenticating proxy header.

**Acts on it:** the kube-apiserver runs its configured authenticators in turn. SelfSubjectReview and TokenReview expose the same logic as API objects.

## Diagram

{{diagram authentication-01.jsx | Authentication stage · 4 steps}}

Authentication only names the caller; it grants nothing until authorization runs.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1, openssl (2026-11-17). Kubernetes has no User object: a user exists only because a credential says so. Here a client certificate for `jane` (group `dev`) is made with the CSR API, and a ServiceAccount token is checked with a `TokenReview`.

```bash
openssl genrsa -out jane.key 2048
openssl req -new -key jane.key -out jane.csr -subj "/CN=jane/O=dev"      # CN = user name, O = group
cat <<EOF | kubectl apply -f -
apiVersion: certificates.k8s.io/v1
kind: CertificateSigningRequest
metadata: {name: jane}
spec:
  request: $(base64 -w0 jane.csr)
  signerName: kubernetes.io/kube-apiserver-client
  expirationSeconds: 86400
  usages: [client auth]
EOF
kubectl certificate approve jane
kubectl get csr jane -o jsonpath='{.status.certificate}' | base64 -d > jane.crt
kubectl config set-credentials jane --client-certificate=jane.crt --client-key=jane.key --embed-certs=true --kubeconfig=jane.kc
# (set-cluster and set-context with the cluster CA go into the same file)
kubectl --kubeconfig=jane.kc auth whoami
```

```text
$ kubectl get csr jane
NAME   AGE   SIGNERNAME                            REQUESTOR          REQUESTEDDURATION   CONDITION
jane   4s    kubernetes.io/kube-apiserver-client   kubernetes-admin   24h                 Approved,Issued
$ openssl x509 -in jane.crt -noout -subject -issuer -dates
subject=O=dev, CN=jane
issuer=CN=kubernetes
notBefore=Nov 17 04:39:56 2026 GMT
notAfter=Nov 18 04:39:56 2026 GMT
$ kubectl --kubeconfig=jane.kc auth whoami
ATTRIBUTE                                           VALUE
Username                                            jane
Groups                                              [dev system:authenticated]
Extra: authentication.kubernetes.io/credential-id   [X509SHA256=e528e9ae...]
$ kubectl auth whoami            # the admin kubeconfig that kubeadm and kind create
Username                                            kubernetes-admin
Groups                                              [kubeadm:cluster-admins system:authenticated]
```

`jane` is now authenticated but has no rights yet (see the third failure). A token is checked the same way by the API server; `TokenReview` shows its verdict:

```text
$ kubectl create -f tokenreview.yaml -o jsonpath='{.status}'      # spec.token = output of: kubectl -n authn create token probe
{"audiences":["https://kubernetes.default.svc.cluster.local"],"authenticated":true,"user":{"groups":["system:serviceaccounts","system:serviceaccounts:authn","system:authenticated"],"username":"system:serviceaccount:authn:probe", ...}}
$ kubectl create -f tokenreview-garbage.yaml -o jsonpath='{.status}'  # spec.token: garbage
{"error":"invalid bearer token","user":{}}
```

## Key fields

| Field or flag | Meaning | Default |
| --- | --- | --- |
| `TokenReview spec.token` | The bearer token to check | required |
| `TokenReview spec.audiences` | Audiences the token must be meant for | the API server's own audience |
| `TokenReview status.authenticated` | `true` when the token maps to a known user | set by the server |
| `TokenReview status.user` | `username`, `uid`, `groups`, `extra` of that user | set by the server |
| `SelfSubjectReview status.userInfo` | Who the API server thinks you are (`kubectl auth whoami`) | set by the server |
| `--client-ca-file` | CA that signs client certificates; certificate CN = user, O = groups | not set (kubeadm sets it) |
| `--service-account-key-file`, `--service-account-issuer` | Keys that verify ServiceAccount tokens; `iss` claim the server puts in them | kubeadm sets both |
| `--oidc-issuer-url`, `--oidc-client-id`, `--oidc-username-claim` | Trust an external OIDC identity provider | not set; username claim `sub` |
| `--authentication-config` | Structured AuthenticationConfiguration file (several JWT issuers, anonymous settings); cannot be mixed with `--oidc-*` | not set |
| `--anonymous-auth` | Requests with no credentials become `system:anonymous` in group `system:unauthenticated` | enabled unless the authorizer is AlwaysAllow |

API fields are from the [v1.37.0 OpenAPI spec](https://github.com/kubernetes/kubernetes/tree/v1.37.0/api/openapi-spec/v3); flags and defaults from [Authenticating](https://kubernetes.io/docs/reference/access-authn-authz/authentication/). Every authenticated user also gets the group `system:authenticated`.

## kubectl

```
kubectl auth whoami                                   # SelfSubjectReview: your username and groups
kubectl auth whoami -o yaml                           # full userInfo, incl. extra fields
kubectl create token app -n sec --duration=10m        # short-lived ServiceAccount token (TokenRequest)
kubectl --token="$TOKEN" auth whoami                  # test a token as a bearer credential
kubectl create -f tokenreview.yaml -o jsonpath='{.status}'   # ask the server to validate a token
kubectl config view --minify                          # which user and credential the current context uses
kubectl config set-credentials jane --client-certificate=jane.crt --client-key=jane.key --embed-certs=true
kubectl --context jane auth whoami                    # check a new certificate user
kubectl get csr                                       # client certificate requests (Certificates card)
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `error: You must be logged in to the server (Unauthorized)` (same for `kubectl auth whoami`), with a kubeconfig that holds only `token: ...` | The token is invalid, expired, or its ServiceAccount was deleted: the test deleted the SA and a token that worked a second earlier was refused | Create a new token (`kubectl create token <sa>`), or fix the credential in the kubeconfig. Beware: `kubectl --token=bad get pods` with a kubeconfig that also has a client certificate still succeeds, because the certificate is used first |
| `Unable to connect to the server: tls: failed to verify certificate: x509: certificate signed by unknown authority` | The client does not trust the CA that signed the API server's certificate (reproduced with `--certificate-authority=<another CA>`) | Use the cluster's CA: `certificate-authority-data` in the kubeconfig, copied from the cluster the kubeconfig names |
| `Error from server (Forbidden): pods is forbidden: User "jane" cannot list resource "pods" in API group "" in the namespace "authn"`; anonymous curl: `User "system:anonymous" cannot list resource "namespaces"` | Authentication worked (`auth whoami` prints the name), authorization did not: Forbidden (403) is a different stage from Unauthorized (401) | Bind a Role: see the RBAC card. If a client is anonymous when it should not be, its credential is not reaching the server |

## Related

- **Cards:** ServiceAccount, Certificates and trust bundles, RBAC, Access reviews, kubeconfig and contexts.
- **Chapter and lab:** 5.5.
- **Exam:** CKAD Application Environment, Configuration and Security (25%): authentication, authorization and admission control.
