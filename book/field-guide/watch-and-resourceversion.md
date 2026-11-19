# Watch and resourceVersion

## What and why

Controllers and kubelets must react to changes at once, and polling the API server for everything would overwhelm it. So the API has a **watch** verb that tracks changes to objects as a stream ([API concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/)): you list once, then watch from where the list ended, and the server pushes each change.

The place in history is the object's **resourceVersion**, an opaque string that clients must treat as a token, not a number to compare. It has a second job: an update carries the resourceVersion it was based on, and the API server rejects it with `409 Conflict` if the object changed meanwhile (optimistic concurrency). If a watch asks for a point the server no longer holds, it answers `410 Gone` and the client must list again. Controller libraries hide this loop; `kubectl get -w` shows the raw stream.

## Diagram

{{diagram watch-and-resourceversion-01.jsx | List-then-watch loop · 4 steps}}
The resourceVersion returned by a LIST is the bookmark a WATCH resumes from; if the server no longer has that point, it answers 410 and the client lists again.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). Watch a ConfigMap change with kubectl, then read the raw event stream from the API:

```
$ kubectl create cm w1 --from-literal=a=1
$ timeout 8 kubectl get cm w1 -w -o name &      # then, in another shell: patch it, delete it
$ kubectl patch cm w1 -p '{"data":{"a":"2"}}'; kubectl delete cm w1
configmap/w1
configmap/w1
configmap/w1                                     <- ADDED, MODIFIED, DELETED (kubectl prints only the name)
$ RV=$(kubectl get cm -o jsonpath='{.metadata.resourceVersion}')
$ kubectl get --raw "/api/v1/namespaces/t2/configmaps?watch=1&timeoutSeconds=5&resourceVersion=$RV" &
$ kubectl create cm w2 --from-literal=x=y; kubectl delete cm w2
{"type":"ADDED","object":{"kind":"ConfigMap","metadata":{"name":"kube-root-ca.crt","resourceVersion":"534", ...
{"type":"ADDED","object":{"kind":"ConfigMap","metadata":{"name":"w2","resourceVersion":"2010", ...
{"type":"DELETED","object":{"kind":"ConfigMap","metadata":{"name":"w2","resourceVersion":"2018", ...
$ kubectl get cm kube-root-ca.crt -o jsonpath='{.metadata.resourceVersion}'; kubectl get pods -o jsonpath='{.metadata.resourceVersion}'
534
                                                  <- an object's version (534); a list has its own (the empty list printed nothing)
```

The watch starts with the current objects as `ADDED`, then streams changes in order; each object carries the `resourceVersion` at which it last changed (`2010` for the create, `2018` for the delete).

## Key fields

| Field or parameter | Meaning | Default |
| --- | --- | --- |
| `metadata.resourceVersion` | Opaque version of an object; treat as a token, never compare numerically | set by the server |
| List `metadata.resourceVersion` | The point in history a list was taken at; pass it to start a watch | set by the server |
| `?watch=1` | Turn the request into a stream of events | off |
| `?resourceVersion=N` (watch) | Resume the stream after version N | most recent state |
| `?timeoutSeconds=S` | Server closes the watch after S seconds | server decides |
| `?resourceVersion=N&resourceVersionMatch=Exact` (list) | List the state at exactly version N | not set |
| `?limit=L` and `continue` token | Page through large lists | no limit |
| Event `type` | `ADDED`, `MODIFIED`, `DELETED`, `BOOKMARK`, `ERROR` | n/a |
| kube-apiserver `--etcd-compaction-interval` | How often history is compacted; older versions give 410 | 5m0s |
| kube-apiserver `--watch-cache` | Serve watches from memory | true |

Parameters were exercised on the test cluster except `BOOKMARK` and the `limit` paging success path; the compaction and watch-cache defaults are from `kube-apiserver --help` (1.37.0).

## kubectl

```
kubectl get cm w1 -w -o name                    # watch one object (-w = --watch)
kubectl get pods -w --output-watch-events       # not run: print the event type too
kubectl get --raw '/api/v1/namespaces/t2/configmaps?watch=1&timeoutSeconds=5&resourceVersion=<rv>'
kubectl get cm kube-root-ca.crt -o jsonpath='{.metadata.resourceVersion}'
kubectl replace -f saved.yaml                   # carries the old resourceVersion: 409 if the object changed
kubectl get --raw '/api/v1/namespaces/t2/configmaps?limit=1'   # shows metadata.continue and remainingItemCount
```

## How it fails

All three were reproduced on the test cluster (the 410 after the cluster was older than the 5-minute compaction interval).

| Symptom | Cause | Fix |
| --- | --- | --- |
| A watch from an old version ends at once with `{"type":"ERROR","object":{"kind":"Status",...,"message":"too old resource version: 1 (2724)","reason":"Expired","code":410}}` | Version 1 is older than the history the server keeps (etcd was compacted) | List again, then watch from the new list's `resourceVersion`; controller libraries do this for you |
| `Error from server (Conflict): error when replacing "cf-old.yaml": Operation cannot be fulfilled on configmaps "cf": the object has been modified; please apply your changes to the latest version and try again` | `kubectl replace` sent a stale `resourceVersion` after someone else changed the object (409) | Get the current object, re-apply your change, and retry; or use server-side apply (see that card) |
| `Error from server (BadRequest): invalid continue token: continue key is not valid: invalid character 'o' in literal null (expecting 'u')` | A made-up or mangled `continue` token for a paged list | Pass the `continue` value exactly as the server returned it; an expired token needs a fresh list |

On the same cluster, minutes younger, the same watch from version 1 did **not** fail: it replayed the existing objects as `ADDED`. A 410 appears only after compaction has run.

## Related

- **Cards:** Objects, spec and status; Server-side apply and field managers (conflict handling); kube-apiserver; etcd; kube-controller-manager and its controllers; Operators and custom controllers (group 10).
- **Chapter and lab:** Chapter 5.1 and Lab 5.1 (Vol 5).
- **Exam domain:** KCNA Kubernetes Fundamentals.
