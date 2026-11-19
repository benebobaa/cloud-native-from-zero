# etcd

## What and why

A cluster that forgets its objects after a crash is useless, so all state lives in one consistent, replicated store. **etcd** is that store: a key-value database holding every object (Pods, Services, Secrets, everything) as keys under `/registry/`. The API server is its only client; no other component reads or writes it.

etcd uses the Raft consensus algorithm. Members elect a leader, the leader replicates each write, and a write commits once a majority of members has stored it. Three members therefore tolerate one failure and five tolerate two. Because all state is here, an etcd snapshot is a backup of the whole cluster, and a slow disk under etcd shows up as a slow API.

## Diagram

{{diagram etcd-01.jsx | etcd cluster · 1 leader, 2 followers}}
The API server is etcd's only client. etcd elects a leader, replicates every write to its followers and answers once a majority has it.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16); etcd 3.7.0. etcd runs as a static Pod; `etcdctl` is inside it and needs the client certificates the API server uses. Let `E` stand for `kubectl -n kube-system exec etcd-cnlab-control-plane -- etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key`:

```
$ E endpoint health
https://127.0.0.1:2379 is healthy: successfully committed proposal: took = 5.218632ms
$ E member list -w table
| ID               | STATUS  | NAME                    | PEER ADDRS              | CLIENT ADDRS            | IS LEARNER |
| c2ed0eb8fc7bc4fc | started | cnlab-control-plane | https://172.21.0.2:2380 | https://172.21.0.2:2379 | false      |
$ kubectl create cm probe-cm --from-literal=k=v; E get /registry/configmaps/t1/probe-cm --prefix --keys-only
/registry/configmaps/t1/probe-cm
$ E get /registry --prefix --keys-only | cut -d/ -f3 | sort | uniq -c | sort -rn | head -4
    890
    537 events
     77 clusterroles
     64 clusterrolebindings
```

The kind cluster has one member, so it shows the commands, not fault tolerance. Objects are stored under `/registry/<resource>/<namespace>/<name>`; the value is protobuf, not readable text (Secrets are stored this way too unless encrypted at rest).

## Key fields

etcd is configured with flags in its static Pod manifest. Defaults are from `etcd --help` (3.7.0) and the manifest of this cluster.

| Flag | Meaning | Default |
| --- | --- | --- |
| `--data-dir` | Where the database lives | kubeadm: `/var/lib/etcd` |
| `--listen-client-urls` | Where clients (the API server) connect | kubeadm: `https://127.0.0.1:2379` |
| `--listen-peer-urls` | Where other members connect | kubeadm: `https://<node-ip>:2380` |
| `--client-cert-auth` | Require client certificates | kubeadm: `true` |
| `--initial-cluster` | The members at bootstrap | kubeadm: this node only |
| `--snapshot-count` | Committed transactions before a snapshot | 10000 |
| `--heartbeat-interval` | Leader heartbeat, in milliseconds | 100 |
| `--election-timeout` | Follower wait before an election, in milliseconds | 1000 |
| `--quota-backend-bytes` | Database size limit; beyond it etcd becomes read-only | 0 (meaning the 2 GiB default) |
| `--auto-compaction-retention` | Automatic history compaction | 0 (off; the API server compacts every 5m) |

## kubectl

```
kubectl -n kube-system get pod -l component=etcd
kubectl -n kube-system logs etcd-<node>
kubectl -n kube-system exec etcd-<node> -- etcdctl <TLS flags above> endpoint health
kubectl -n kube-system exec etcd-<node> -- etcdctl <TLS flags above> endpoint status -w table
kubectl -n kube-system exec etcd-<node> -- etcdctl <TLS flags above> member list -w table
kubectl get --raw '/readyz/etcd'           # the API server's own view of etcd health (readyz?verbose lists it)
kubectl -n kube-system exec etcd-<node> -- etcdctl <TLS flags above> snapshot save /var/lib/etcd/snap.db   # not run: see the backup card
```

## How it fails

Rows one and two were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `etcdctl endpoint health` without certificates: `https://127.0.0.1:2379 is unhealthy: failed to commit proposal: context deadline exceeded`, `Error: unhealthy cluster` | etcd requires client certificates (`--client-cert-auth=true`), so a client without them cannot complete a request | Pass `--cacert`, `--cert` and `--key` from `/etc/kubernetes/pki/etcd` |
| The same error with an `http://` endpoint | etcd listens only on HTTPS | Use the `https://` endpoint |
| Writes start failing and etcd reports `database space exceeded` (not reproduced) | The database passed `--quota-backend-bytes` (2 GiB by default) and etcd went read-only | Compact and defragment, then clear the alarm; see etcd backup and restore |

## Related

- **Cards:** kube-apiserver; etcd backup and restore (group 11); Encrypting Secrets at rest (group 9); kubeadm and cluster bootstrap; Upgrades and version skew (group 11).
- **Chapter and lab:** Chapters 3.2 and 5.5, Lab 5.5 (Vol 3, 5).
- **Exam domain:** CKA Cluster Architecture: highly available control plane, cluster lifecycle.
