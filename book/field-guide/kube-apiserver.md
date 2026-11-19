# kube-apiserver

## What and why

Every part of a cluster needs one consistent place to read and change state, with identity and permission checks, and none of them should touch the database directly. The **kube-apiserver** is that place: it exposes the Kubernetes HTTP API ([components overview](https://kubernetes.io/docs/concepts/overview/components/)). It authenticates and authorizes each request, runs admission, validates the object, stores it in etcd, and serves list and watch streams.

kubectl, the kubelet, the scheduler and every controller talk only to the API server. Components never call each other: they watch the API server for work and write their results back to it. The API server itself keeps no state, so several copies can run behind a load balancer; etcd is the only stateful part.

## Diagram

{{diagram kube-apiserver-01.jsx | API server request path · 6 stages}}
A write is authenticated, authorized, mutated, validated and then stored; only after the etcd write succeeds does the caller get a response and do watchers see the change.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). In kind (as in kubeadm) the API server is a static Pod defined in `/etc/kubernetes/manifests/kube-apiserver.yaml`; there is nothing to apply. Ask it about itself:

```
$ kubectl get --raw '/readyz?verbose' | sed -n '1,4p;$p'
[+]ping ok
[+]log ok
[+]etcd ok
[+]etcd-readiness ok
readyz check passed
$ kubectl get --raw /version
{ "major": "1", "minor": "37", "gitVersion": "v1.37.0", "buildDate": "2026-08-26T10:44:25Z", "goVersion": "go1.26.6", ... }
$ kubectl get pods -v=6 2>&1 | grep GET
"Response" verb="GET" url="https://127.0.0.1:38561/api/v1/namespaces/t1/pods?limit=500" status="200 OK" milliseconds=8
```

Every `kubectl` command is one or more such HTTPS calls; `-v=6` prints them. The flags that shape the API server of this cluster (from the static Pod): `--etcd-servers=https://127.0.0.1:2379`, `--authorization-mode=Node,RBAC`, `--enable-admission-plugins=NodeRestriction`, `--service-cluster-ip-range=10.96.0.0/16`, `--secure-port=6443`.

## Key fields

The API server is configured with command-line flags in its static Pod manifest, not an API object. Defaults below are from `kube-apiserver --help` on 1.37.0.

| Flag | Meaning | Default |
| --- | --- | --- |
| `--etcd-servers` | etcd endpoints to store state in | none; kubeadm sets `https://127.0.0.1:2379` |
| `--authorization-mode` | Ordered authorizers | `AlwaysAllow` if unset; kubeadm sets `Node,RBAC` |
| `--enable-admission-plugins` | Admission plug-ins on top of the defaults | kubeadm adds `NodeRestriction` |
| `--service-cluster-ip-range` | ClusterIP range for Services | none; kind uses `10.96.0.0/16` |
| `--event-ttl` | How long Events are kept | 1h0m0s |
| `--enable-priority-and-fairness` | Queue and prioritise requests (see the APF card) | true |
| `--etcd-compaction-interval` | How often the API server asks etcd to compact history | 5m0s |
| `--watch-cache` | Serve watches from an in-memory cache | true |
| `--request-timeout` | Default time a handler keeps a request open | set per request kind (see `--help`) |

`--max-requests-inflight` and `--max-mutating-requests-inflight` are summed into the total concurrency limit that APF divides among priority levels.

## kubectl

```
kubectl get --raw /readyz?verbose        # per-check health (also /livez, /healthz)
kubectl get --raw /version
kubectl api-resources                     # what this server serves
kubectl get pods -v=6                     # show the HTTP call behind a command
kubectl auth can-i list pods --as=system:serviceaccount:t1:default   # ask the authorizers
kubectl create deploy x --image=alpine:3.21 --dry-run=server -o name # run the full request path, store nothing
kubectl -n kube-system get pod -l component=kube-apiserver
kubectl -n kube-system logs kube-apiserver-<node>    # only works while the API server is up
crictl ps -a --name kube-apiserver                  # on the node: works when kubectl does not
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubectl get pods` fails with `Get "https://127.0.0.1:38561/api/v1/namespaces/t1/pods?limit=500": read tcp ...: read: connection reset by peer`; `crictl ps -a --name kube-apiserver` on the node lists nothing | The manifest `/etc/kubernetes/manifests/kube-apiserver.yaml` was moved away, so the kubelet stopped the static Pod | Put the manifest back; the kubelet restarts the Pod within seconds and `/readyz` returns `ok` |
| `Unable to connect to the server: net/http: TLS handshake timeout`; the container is `Running` but never ready; its log is full of `grpc: addrConn.createTransport failed to connect to {Addr: "127.0.0.1:9999" ...} ... connect: connection refused` | A flag points somewhere wrong (here `--etcd-servers` was edited to port 9999), so the API server cannot reach etcd | Read the container log on the node (`/var/log/pods/kube-system_kube-apiserver-*/`), restore the flag |
| `Error from server (Forbidden): pods is forbidden: User "system:serviceaccount:t1:default" cannot list resource "pods" in API group "" in the namespace "t1"` | Authentication worked, authorization (RBAC) denied it | Grant a Role and RoleBinding; test with `kubectl auth can-i ... --as=...` |

## Related

- **Cards:** etcd; Authentication, RBAC, Admission webhooks and ValidatingAdmissionPolicy (group 9); Watch and resourceVersion; API Priority and Fairness; API groups, versions and deprecation (group 2); kubeconfig and contexts (group 11).
- **Chapter and lab:** Chapters 5.1 and 5.5, Lab 5.1 (Vol 5).
- **Exam domain:** CKA Troubleshooting: cluster components; KCNA Kubernetes Fundamentals.
