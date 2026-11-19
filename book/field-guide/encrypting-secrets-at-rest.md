# Encrypting Secrets at rest

## What and why

Encryption at rest makes the API server encrypt chosen resources, usually Secrets, before writing them to etcd. Without it anyone who can read etcd or a backup reads every Secret. It does not protect against someone who can call the API.

**Acts on it:** the kube-apiserver, configured with `--encryption-provider-config`. etcd stores only the ciphertext.

## Diagram

{{diagram encrypting-secrets-at-rest-01.jsx | Encryption at rest path · 4 links}}

Clients never see the ciphertext; only a copy of etcd does.

## Minimal example

Tested on kind v0.33.0 (1 node), node image `kindest/node:v1.37.0`, kubectl v1.37.1, etcd 3.7.0 (2026-11-17). The cluster was created with `--encryption-provider-config=/etc/kubernetes/secb/enc.yaml` and `--encryption-provider-config-automatic-reload=true` (kubeadm patch plus a mounted directory, as in the Audit card). The key below is a demo; never publish a real one. The first configuration lists `identity` first, so new Secrets are written in plain text.

```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
- resources: ["secrets"]
  providers:                    # the first provider writes; all of them can read
  - aescbc:
      keys:
      - name: key1
        secret: ZmllbGRndWlkZS1rZXktMDEyMzQ1Njc4OWFiY2RlZmc=     # 32 random bytes, base64
  - identity: {}                # reads data that was stored in plain text
```

```text
$ kubectl create secret generic s1 --from-literal=password=hunter2        # config with identity FIRST
$ kubectl -n kube-system exec etcd-<node> -- etcdctl $EP get /registry/secrets/default/s1 | strings | head -12
/registry/secrets/default/s1
Secret
...
password
hunter2                          # plain text in etcd
$ # edit enc.yaml so aescbc is first; the API server reloads it (about a minute)
$ kubectl create secret generic s2 --from-literal=password=hunter2
$ kubectl -n kube-system exec etcd-<node> -- etcdctl $EP get /registry/secrets/default/s2 | head -c 80 | strings
/registry/secrets/default/s2
k8s:enc:aescbc:v1:key1:          # encrypted, with the key name
$ kubectl -n kube-system exec ... get /registry/secrets/default/s1 | strings | grep -c hunter2
1                                # the old Secret is still plain text
$ kubectl get secrets -A -o json | kubectl replace -f -     # rewrite every Secret
$ kubectl -n kube-system exec ... get /registry/secrets/default/s1 | head -c 60 | strings
/registry/secrets/default/s1
k8s:enc:aescbc:v1:key1:
$ kubectl get secret s1 -o jsonpath='{.data.password}'        # clients still see the value
aHVudGVyMg==
```

Encryption protects etcd and its backups on disk; anyone who can call the API with the right RBAC still reads the decoded value.

## Key fields

Encryption is set by an `EncryptionConfiguration` file (`apiserver.config.k8s.io/v1`) given to kube-apiserver, not by an API object.

| Field or flag | Meaning | Default |
| --- | --- | --- |
| `resources[].resources` | Resources this entry covers, for example `["secrets"]` | required |
| `resources[].providers` | Ordered list: the first provider encrypts new writes; all are tried, in order, to read | `identity` (no encryption) |
| `identity: {}` | Stores plaintext; keep it last so old plaintext data stays readable |  |
| `aescbc` / `aesgcm` | Local AES keys (16, 24 or 32 bytes, base64) in `keys[].name` and `keys[].secret`; the docs do not recommend them |  |
| `secretbox` | Local 32-byte key, XSalsa20 and Poly1305 |  |
| `kms` (`apiVersion: v2`) | Envelope encryption: a KMS plugin holds the key; the recommended choice; stable since v1.29 |  |
| `keys[]` order | The first key encrypts; every key is tried to decrypt, which allows rotation |  |
| `--encryption-provider-config` | Path to the file on the control-plane node | none: no encryption |
| `--encryption-provider-config-automatic-reload` | Reload the file when it changes, without a restart | false |

Stored data starts with `k8s:enc:<provider>:v1:<key name>:` when encrypted. Source: [Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/) and [kube-apiserver flags](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/).

## kubectl

```
head -c 32 /dev/urandom | base64                                  # a new 32-byte key
docker exec cnlab-control-plane cat /etc/kubernetes/enc/enc.yaml   # the config the API server reads
kubectl -n kube-system exec etcd-cnlab-control-plane -- etcdctl \
  --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/enc-demo/after --print-value-only | head -c 60   # expect k8s:enc:aescbc:v1:key1
kubectl get secrets -A -o json | kubectl replace -f -             # rewrite every Secret with the first provider
kubectl create -f svm.yaml                                        # or: a StorageVersionMigration for secrets
kubectl get --raw /metrics | grep apiserver_encryption_config_controller_automatic_reload
kubectl -n kube-system logs kube-apiserver-cnlab-control-plane | grep -i encryption
```

On a kubeadm cluster run `etcdctl` on the control-plane node with `sudo`; on kind it runs inside the etcd Pod.

## How it fails

All rows were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Secrets created before encryption was switched on are still readable in etcd (`strings` finds `hunter2`) | Only writes are encrypted; existing objects keep their old form until rewritten | `kubectl get secrets -A -o json \| kubectl replace -f -`, then check a key in etcd for the `k8s:enc:aescbc:v1:key1:` prefix |
| `Error from server (InternalError): Internal error occurred: StorageError: corrupt object, Code: 7, Key: /secrets/default/s2, ResourceVersion: 0, AdditionalErrorMsg: data from the storage is not transformable revision=0: no matching key was found for the provided AES transformer` | The configuration was changed to a key with another name (`key2`): the data written with `key1` can no longer be decrypted | Put the old key back (the Secret read worked again about a minute later); to rotate, add the new key first, rewrite all Secrets, and only then remove the old key |
| Edited config has a bad key and nothing seems to happen; the API server log repeats `error processing encryption config file /etc/kubernetes/secb/enc.yaml: error while parsing file: resources[0].providers[0].aescbc.keys[0].secret: Invalid value: "REDACTED": secret is not of the expected length, got 5, expected ...` | A key that is not 16, 24 or 32 bytes after base64 decoding is rejected; with automatic reload the server keeps the previous valid configuration and logs the error | Read the API server log after each edit; on a server started with a bad file the API server will not start (not run here) |

Back up the encryption configuration file together with etcd snapshots: a restore without the key leaves the Secrets unreadable, as the second row shows.

## Related

- **Cards:** Secret (group 5), etcd (group 1), kube-apiserver (group 1), etcd backup and restore, StorageVersionMigration.
- **Chapter and lab:** 6.3.
- **Exam:** no curriculum line names it (checked in the CKA and CKAD v1.37 curriculum PDFs, [cncf/curriculum](https://github.com/cncf/curriculum), 2026-11-17).
