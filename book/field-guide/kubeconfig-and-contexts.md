# kubeconfig and contexts

## What and why

A kubeconfig file tells kubectl and other clients which cluster to talk to and as whom. It holds clusters (address and CA), users (credentials) and contexts (one cluster, one user and a default namespace).

**Acts on it:** only the client reads it. The cluster never sees the file, only the TLS connection and credential that come from it.

## Diagram

{{diagram kubeconfig-and-contexts-01.jsx | kubeconfig lookup · 3 steps}}

Switching context changes which cluster every later command talks to, so check it before deleting anything.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-17). A kubeconfig joins three lists by name: a cluster (server and CA), a user (credential) and a context (which pair, plus a default namespace). kind wrote the first file; the second (`jane.kc`) was built with `kubectl config set-*` in the Authentication card.

```bash
kubectl config set-cluster demo --server=https://127.0.0.1:6443 --insecure-skip-tls-verify=true
kubectl config set-credentials jane --token=abc
kubectl config set-context jane@demo --cluster=demo --user=jane --namespace=dev
kubectl config use-context jane@demo
kubectl config view --minify          # only the current context; secrets shown as REDACTED
```

```text
$ kubectl config view --minify
apiVersion: v1
clusters:
- cluster:
    insecure-skip-tls-verify: true
    server: https://127.0.0.1:6443
  name: demo
contexts:
- context:
    cluster: demo
    namespace: dev
    user: jane
  name: jane@demo
current-context: jane@demo
kind: Config
users:
- name: jane
  user:
    token: REDACTED
$ export KUBECONFIG=~/.kube/config:jane.kc           # two files are merged
$ kubectl config get-contexts
CURRENT   NAME              CLUSTER           AUTHINFO          NAMESPACE
          jane              kind              jane
*         kind-cnlab        kind-cnlab        kind-cnlab
$ kubectl config use-context jane; kubectl auth whoami | sed -n 2p
Switched to context "jane".
Username                                            jane
$ kubectl --context=kind-cnlab      auth whoami | sed -n 2p        # one command, another context
Username                                            kubernetes-admin
$ kubectl config set-context --current --namespace=kube-system; kubectl get pods --no-headers | head -1
coredns-559f6c778d-ggmcb   1/1   Running   0   46m
```

The context decides who you are and where: `--context` changes both for one command, and `set-context --current --namespace=...` changes only the default namespace, so a later `kubectl get pods` lists `kube-system`.

## Key fields

The structure is the one printed above; lookup rules are from [Organizing cluster access using kubeconfig files](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/).

| Field or rule | Meaning | Default |
| --- | --- | --- |
| `clusters[].cluster.server` | API server URL | required |
| `clusters[].cluster.certificate-authority-data` (or `certificate-authority` file) | CA that signed the server certificate | system roots |
| `clusters[].cluster.insecure-skip-tls-verify` | Skip server certificate checks (lab only) | false |
| `users[].user` | One credential: `client-certificate-data` plus `client-key-data`, or `token`, or an `exec` plugin | none |
| `contexts[].context.cluster`, `.user`, `.namespace` | The pair this context selects, and the default namespace | namespace `default` |
| `current-context` | The context used when none is named |  |
| `--kubeconfig <file>` | Use only that file; no merging |  |
| `KUBECONFIG=a:b` (colon-separated on Linux) | Merge the files; "the first file to set a particular value or map key wins" |  |
| `$HOME/.kube/config` | Used when neither of the above is set |  |
| `--context`, `--namespace`, `--cluster`, `--user` | Override one part for one command |  |

`kubectl config view` hides secrets (`REDACTED`); `--raw` shows them, so do not paste it into a chat or a ticket.

## kubectl

```bash
kubectl config get-contexts                       # * marks the current one
kubectl config current-context
kubectl config use-context <name>
kubectl config set-context --current --namespace=<ns>     # change only the default namespace
kubectl config view --minify                      # the effective config of the current context
kubectl config view --raw -o jsonpath='{.users[?(@.name=="jane")].user}'   # secrets: handle with care
kubectl config set-cluster / set-credentials / set-context <name> ... [--kubeconfig=file --embed-certs=true]
kubectl config rename-context <old> <new>
kubectl config delete-context <name>              # warns if it was the active one
KUBECONFIG=a.kc:b.kc kubectl config view --flatten > merged.kc    # merge into one file
kubectl --context=<name> -n <ns> get pods         # one-off
```

## How it fails

All rows were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `The connection to the server localhost:8080 was refused - did you specify the right host or port?` (with `KUBECONFIG=/dev/null`); with a dead server in the kubeconfig the same message names `127.0.0.1:6444` | No kubeconfig was found, so kubectl uses the old default `localhost:8080`; or the file points to an address where nothing listens | `echo $KUBECONFIG`, `ls ~/.kube/config`, `kubectl config view --minify`; then fix `server:` or the file path |
| `Error in configuration: context was not found for specified context: nope` (`--context=nope`); `error: no context exists with the name: "nope"` (`use-context nope`) | The context name is wrong; the names are in `get-contexts` | Copy the name from `kubectl config get-contexts` |
| `No resources found in nosuchns namespace.` for `-n nosuchns`, or an empty `kubectl get pods` after `set-context --current --namespace=dev` | kubectl does not check that the namespace exists, and the context's default namespace silently scopes every command | Read the namespace in `kubectl config view --minify -o jsonpath='{..namespace}'`; pass `-n` explicitly in scripts and in the exam |
| `Error from server (Forbidden): namespaces is forbidden: User "jane" cannot list resource "namespaces" in API group "" at the cluster scope` after `use-context jane` | A context also selects the identity: you switched to the limited user without noticing | `kubectl auth whoami`; switch back with `use-context` (the exam names the context to use in each task) |

## Related

- **Cards:** Authentication, Certificates and trust bundles, Troubleshooting playbook, kube-apiserver (group 1).
- **Chapter and lab:** 5.5 (assumed from the chapter topic; not named in the coverage matrix).
- **Exam:** every CKA and CKAD task starts with the right context; no separate curriculum line (checked in the CKA and CKAD v1.37 curriculum PDFs, [cncf/curriculum](https://github.com/cncf/curriculum), 2026-11-17).
