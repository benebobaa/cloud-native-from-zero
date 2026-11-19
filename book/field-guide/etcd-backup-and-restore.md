# etcd backup and restore

## What and why

etcd holds all cluster state, so a snapshot of it is your cluster backup. A restore turns a snapshot back into a data directory etcd can start from.

**Acts on it:** `etcdctl` talks to the running etcd member to save a snapshot, `etcdutl` writes the restored directory offline, and the kubelet restarts the etcd static Pod.

## Diagram

{{diagram etcd-backup-and-restore-01.jsx | etcd backup and restore · 5 steps}}

Restore is not in place: it builds a new directory, and you then redirect etcd to it.

## Minimal example

Tested on kind v0.33.0 (1 control-plane node), node image `kindest/node:v1.37.0`, etcd `registry.k8s.io/etcd:3.7.0-0`, kubectl v1.37.1 (2026-11-17), complete save-and-restore. On kind the node has no `etcdctl`, so the tools were run inside the etcd Pod (`kubectl -n kube-system exec etcd-<node> -- ...`); on a kubeadm node in the exam you run `etcdctl` and `etcdutl` on the host with the same flags. Certificate paths come from the Pod's `--cert-file`, `--key-file` and `--trusted-ca-file` arguments.

```text
$ kubectl create cm keep --from-literal=before=backup
$ EP="--endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key"
$ kubectl -n kube-system exec etcd-cnlab-control-plane -- etcdctl $EP endpoint health
https://127.0.0.1:2379 is healthy: successfully committed proposal: took = 8.6253ms
$ kubectl -n kube-system exec etcd-cnlab-control-plane -- etcdctl $EP snapshot save /var/lib/etcd/snapshot.db
...
Snapshot saved at /var/lib/etcd/snapshot.db
$ kubectl -n kube-system exec etcd-cnlab-control-plane -- etcdutl snapshot status /var/lib/etcd/snapshot.db -w table
+----------+----------+------------+------------+---------+
|   HASH   | REVISION | TOTAL KEYS | TOTAL SIZE | VERSION |
+----------+----------+------------+------------+---------+
| b2c02997 |     1165 |        412 |     1.8 MB |   3.7.0 |
+----------+----------+------------+------------+---------+
$ kubectl delete cm keep; kubectl create cm after --from-literal=after=backup      # changes made after the backup
```

Restore (etcd stopped, new data directory, static Pod pointed at it):

```text
$ kubectl -n kube-system exec etcd-... -- etcdutl snapshot restore /var/lib/etcd/snapshot.db --data-dir /var/lib/etcd/restored
... restored snapshot ...
$ docker exec cnlab-control-plane sed -i 's#path: /var/lib/etcd$#path: /var/lib/etcd/restored#' /etc/kubernetes/manifests/etcd.yaml
  # (the hostPath named etcd-data in the etcd static Pod manifest; on a kubeadm host, edit /etc/kubernetes/manifests/etcd.yaml)
$ kubectl get cm keep after          # a minute later, kubelet has restarted etcd and the API server reconnected
NAME   DATA   AGE
keep   1      94s
Error from server (NotFound): configmaps "after" not found
```

The cluster is back in the state of the snapshot: `keep` exists again and `after` is gone. The kubelet restarts the etcd Pod by itself when its manifest changes; no `kubectl` command can restart a static Pod. `etcdutl snapshot restore` works offline on a file; `etcdctl snapshot save` talks to a running etcd.

## Key fields

Flags are from the commands above (etcdctl and etcdutl 3.7.0); the paths are the defaults of a kubeadm cluster.

| Flag or path | Meaning | Value seen |
| --- | --- | --- |
| `--endpoints` | Where etcd listens for clients | `https://127.0.0.1:2379` (the manifest's `--listen-client-urls` lists it) |
| `--cacert`, `--cert`, `--key` | TLS client authentication (the server runs `--client-cert-auth=true`) | `/etc/kubernetes/pki/etcd/ca.crt`, `server.crt`, `server.key` |
| `etcdctl snapshot save <file>` | Write a consistent snapshot of a running member | `Snapshot saved at ...` |
| `etcdutl snapshot status <file> -w table` | Hash, revision, key count and size of a snapshot file | revision 1165, 412 keys |
| `etcdutl snapshot restore <file> --data-dir <new dir>` | Build a data directory from a snapshot; the directory must not exist | `restored snapshot` |
| `--data-dir=/var/lib/etcd` (etcd Pod argument) and the `hostPath` `etcd-data` | Where etcd keeps its data; the restore is activated by pointing the hostPath at the new directory | `/var/lib/etcd` |
| `/etc/kubernetes/manifests/etcd.yaml` | The static Pod manifest the kubelet watches |  |
| `etcdctl member list -w table` | Members and their client and peer URLs | one member, `started` |

See [Operating etcd clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/). In a multi-member cluster each member needs its own restore with the `--name` and `--initial-cluster` flags; that case was not run.

## kubectl

```bash
kubectl -n kube-system get pod -l component=etcd                      # the etcd static Pod
kubectl -n kube-system get pod etcd-<node> -o jsonpath='{.spec.containers[0].command}' | jq -r '.[]'   # endpoint and certificate flags
kubectl -n kube-system exec etcd-<node> -- etcdctl $EP endpoint health
kubectl -n kube-system exec etcd-<node> -- etcdctl $EP member list -w table
kubectl -n kube-system exec etcd-<node> -- etcdctl $EP snapshot save /var/lib/etcd/snapshot.db
kubectl -n kube-system exec etcd-<node> -- etcdutl snapshot status /var/lib/etcd/snapshot.db -w table
kubectl -n kube-system exec etcd-<node> -- etcdutl snapshot restore /var/lib/etcd/snapshot.db --data-dir /var/lib/etcd/restored
# on the node: edit /etc/kubernetes/manifests/etcd.yaml (hostPath etcd-data), then wait for the Pod
kubectl -n kube-system get pod -l component=etcd -w
```

## How it fails

All rows were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `https://127.0.0.1:2379 is unhealthy: failed to commit proposal: context deadline exceeded` then `Error: unhealthy cluster`, after log lines `retrying of unary invoker failed` | `etcdctl` was run without `--cacert`, `--cert` and `--key`, and etcd requires client certificates | Add the three flags, with the paths from the etcd manifest; the same message appears for `--endpoints=http://127.0.0.1:2379` (wrong scheme), so check both |
| `Error: data-dir "/var/lib/etcd/restored" not empty or could not be read` | `snapshot restore` refuses to write into a directory that already holds data | Choose a new directory (or remove the old restore directory) |
| After the restore the API still shows the old objects (`after` exists, `keep` is missing) | The restore only built a directory; etcd keeps using `/var/lib/etcd` until the manifest's `hostPath` points to the new directory | Edit the `etcd-data` hostPath in `/etc/kubernetes/manifests/etcd.yaml`; the kubelet restarts etcd, and the test showed the restored state after about a minute |

Take backups before upgrades and before risky changes, and copy the snapshot off the node: a snapshot stored only in `/var/lib/etcd` is lost with the disk.

## Related

- **Cards:** etcd (group 1), kubeadm and cluster bootstrap (group 1), Upgrades and version skew, Encrypting Secrets at rest.
- **Chapter and lab:** 5.5.
- **Exam:** CKA Cluster Architecture, Installation and Configuration (25%): manage the lifecycle of Kubernetes clusters.
