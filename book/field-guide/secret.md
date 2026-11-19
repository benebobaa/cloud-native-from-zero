# Secret

## What and why

A Secret holds a small amount of sensitive data (a password, token or key), up to 1 MiB, so it stays out of images and Pod specs. The API stores the values base64-encoded. That is an encoding, not encryption: protection comes from RBAC (who can `get` the Secret), encryption at rest in etcd, and where the data lands in the container.

The **kubelet** fetches only the Secrets that Pods on its node use and writes volume Secrets to a tmpfs (memory-backed) directory. Types include `Opaque` (default), `kubernetes.io/tls`, `kubernetes.io/dockerconfigjson` (image pull credentials), `kubernetes.io/basic-auth` and `kubernetes.io/service-account-token`. The API server validates the keys a typed Secret must have.

## Diagram

{{diagram secret-01.jsx | Secret path · 5 boxes}}
The API server stores the Secret in etcd and the kubelet hands it to Pods on its node as a tmpfs volume or env var.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). Create a Secret, read it back, and mount it:

```bash
kubectl create secret generic db-cred --from-literal=username=wallet --from-literal=password='s3cr3t!'
```

```
$ kubectl get secret db-cred -o yaml
apiVersion: v1
data:
  password: czNjcjN0IQ==
  username: d2FsbGV0
kind: Secret
metadata: {name: db-cred, namespace: default}
type: Opaque

$ kubectl get secret db-cred -o jsonpath='{.data.password}' | base64 -d; echo
s3cr3t!
```

The values are only base64-encoded. A Pod can take a key as an environment variable and the whole Secret as files:

```yaml
    env: [{name: DB_PASSWORD, valueFrom: {secretKeyRef: {name: db-cred, key: password}}}]
    volumeMounts: [{name: s, mountPath: /etc/db, readOnly: true}]
  volumes: [{name: s, secret: {secretName: db-cred, defaultMode: 0400}}]
```

```
$ kubectl exec sec-demo -- sh -c 'ls -l /etc/db; cat /etc/db/username; echo; echo $DB_PASSWORD'
lrwxrwxrwx    1 root     root            15 Nov 16 08:40 password -> ..data/password
lrwxrwxrwx    1 root     root            15 Nov 16 08:40 username -> ..data/username
wallet
s3cr3t!
```

Other generators: `kubectl create secret docker-registry` produces type `kubernetes.io/dockerconfigjson`, and `kubectl create secret tls` produces `kubernetes.io/tls`.

## Key fields

Checked with `kubectl explain secret` on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| `type` | tells tools what keys to expect: `Opaque`, `kubernetes.io/tls` (needs `tls.crt`, `tls.key`), `kubernetes.io/dockerconfigjson`, `kubernetes.io/basic-auth`, `kubernetes.io/service-account-token` | `Opaque` |
| `data` | base64-encoded values; keys use letters, digits, `-`, `_`, `.` | empty |
| `stringData` | write-only plain text, merged into `data` on write, never returned by reads | empty |
| `immutable` | `true` forbids changing the data | `nil`, so editable |
| Pod `env[].valueFrom.secretKeyRef` | one key into one variable | n/a |
| Pod `volumes[].secret` | mount keys as files on a tmpfs; `defaultMode`, `items` | all keys, one file each |
| Pod `imagePullSecrets` | `dockerconfigjson` Secrets used to pull private images | none |
| size | each Secret is limited to 1 MiB | n/a |

## kubectl

```bash
kubectl create secret generic db-cred --from-literal=username=wallet --from-literal=password='s3cr3t!'
kubectl get secret db-cred                                  # TYPE and DATA count, no values
kubectl get secret db-cred -o jsonpath='{.data.password}' | base64 -d
kubectl create secret docker-registry regcred --docker-server=registry.example.com --docker-username=u --docker-password=p
kubectl auth can-i get secrets --as=system:serviceaccount:default:default   # who may read them
kubectl describe pod sec-badkey                             # missing key shows as a Failed event
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `The Secret "bad-tls" is invalid:` with `data[tls.crt]: Required value` and `data[tls.key]: Required value` | A `kubernetes.io/tls` Secret needs both keys, and the API checks them | Supply `tls.crt` and `tls.key`, or use `kubectl create secret tls` |
| Pod `CreateContainerConfigError`; event `Error: couldn't find key token in Secret default/db-cred` | `secretKeyRef` names a key the Secret does not have | Fix the key or add it |
| Pod `ImagePullBackOff`; event `Failed to pull image "docker.io/library/fg2-private-image-does-not-exist:1": ... failed to resolve reference` | The image does not exist or needs credentials; for a private registry the Pod lacks a valid `imagePullSecrets` entry | Check the image name; create a `docker-registry` Secret and list it in `imagePullSecrets` |

## Related

- **Cards:** ConfigMap, Encrypting Secrets at rest, RBAC, ServiceAccount
- **Chapter and lab:** Ch 5.3 and Lab 5.3
- **Exam:** CKA, Workloads and Scheduling (15%): ConfigMaps and Secrets; CKAD, Application Environment, Configuration and Security (25%): Secrets
- **Source:** [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
