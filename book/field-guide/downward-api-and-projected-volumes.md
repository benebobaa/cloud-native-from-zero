# Downward API and projected volumes

## What and why

The Downward API lets a container read facts about its own Pod (name, namespace, IP, node name, labels, annotations, and its own CPU and memory requests and limits) without calling the API server and without extra permissions. A **projected volume** merges several sources into one mounted directory. A source entry is one of: `configMap`, `secret`, `downwardAPI`, `serviceAccountToken`, `clusterTrustBundle` (stable since v1.37, from v1.29) or `podCertificate` (stable since v1.37, from v1.34; see [Projected Volumes](https://kubernetes.io/docs/concepts/storage/projected-volumes/)).

The **kubelet** resolves the fields and writes them: as environment variables (`fieldRef`, `resourceFieldRef`) at container start, or as files in a volume that it updates when labels or annotations change. The `serviceAccountToken` source asks for a token with a chosen audience and lifetime, and the kubelet renews it before it expires.

## Diagram

{{diagram downward-api-and-projected-volumes-01.jsx | projected volume · 4 sources}}
A projected volume merges several kinds of source (four are drawn) into one mounted directory.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16), after creating the `app-config` ConfigMap and `db-cred` Secret from the previous cards:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: dw-demo
  labels: {app: dw, tier: web}
spec:
  containers:
  - name: c
    image: alpine:3.21
    command: [sleep, "3600"]
    resources: {requests: {cpu: 250m, memory: 64Mi}, limits: {memory: 128Mi}}
    env:
    - {name: POD_NAME, valueFrom: {fieldRef: {fieldPath: metadata.name}}}
    - {name: NODE_NAME, valueFrom: {fieldRef: {fieldPath: spec.nodeName}}}
    - {name: POD_IP, valueFrom: {fieldRef: {fieldPath: status.podIP}}}
    - {name: MEM_LIMIT_MIB, valueFrom: {resourceFieldRef: {containerName: c, resource: limits.memory, divisor: 1Mi}}}
    - {name: CPU_REQ_M, valueFrom: {resourceFieldRef: {containerName: c, resource: requests.cpu, divisor: 1m}}}
    volumeMounts: [{name: podinfo, mountPath: /etc/podinfo}, {name: all, mountPath: /etc/all}]
  volumes:
  - name: podinfo
    downwardAPI:
      items: [{path: labels, fieldRef: {fieldPath: metadata.labels}}]
  - name: all
    projected:
      sources:
      - configMap: {name: app-config, items: [{key: greeting, path: cfg/greeting}]}
      - secret: {name: db-cred, items: [{key: username, path: sec/username}]}
      - downwardAPI: {items: [{path: meta/name, fieldRef: {fieldPath: metadata.name}}]}
      - serviceAccountToken: {path: token, audience: wallet-api, expirationSeconds: 3600}
```

```
$ kubectl exec dw-demo -- sh -c 'env | grep -E "POD_NAME|NODE_NAME|POD_IP|MEM_LIMIT|CPU_REQ"; cat /etc/podinfo/labels'
POD_IP=10.244.1.20
CPU_REQ_M=250
NODE_NAME=cnlab-worker
POD_NAME=dw-demo
MEM_LIMIT_MIB=128
app="dw"
tier="web"

$ kubectl exec dw-demo -- find /etc/all -type l -o -type f | grep -v '\.\.'    # one directory, four sources
/etc/all/cfg/greeting   /etc/all/meta/name   /etc/all/sec/username   /etc/all/token

$ kubectl label pod dw-demo tier=api --overwrite
$ kubectl exec dw-demo -- cat /etc/podinfo/labels         # within 100 seconds
app="dw"
tier="api"
```

The projected token's payload (decoded) names the requested audience and a one-hour life: `"aud":["wallet-api"]`, `"iat":1794818465`, `"exp":1794822065`.

## Key fields

Checked with `kubectl explain pod.spec` on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| `env[].valueFrom.fieldRef.fieldPath` | `metadata.name`, `metadata.namespace`, `metadata.labels['KEY']`, `metadata.annotations['KEY']`, `spec.nodeName`, `spec.serviceAccountName`, `status.hostIP`, `status.podIP`, `status.podIPs` | required |
| `fieldRef.apiVersion` | schema version of the path | `v1` |
| `env[].valueFrom.resourceFieldRef` | `limits.cpu`, `limits.memory`, `limits.ephemeral-storage` and the `requests.` forms; `divisor` sets the unit | `containerName` optional for env, required for volumes |
| `volumes[].downwardAPI.items[]` | `path` plus `fieldRef` or `resourceFieldRef`; labels and annotations files are refreshed | none |
| `volumes[].projected.sources[]` | each entry sets exactly one of `configMap`, `secret`, `downwardAPI`, `serviceAccountToken`, `clusterTrustBundle`, `podCertificate` | none |
| `serviceAccountToken.audience` / `expirationSeconds` / `path` | who the token is for, its lifetime (at least 10 minutes), where to write it | audience: the API server; lifetime: 1 hour |
| `projected.defaultMode` | file permission bits, octal 0000 to 0777 | not stated in the explain output |

## kubectl

```bash
kubectl explain pod.spec.containers.env.valueFrom.fieldRef     # the list of allowed field paths
kubectl exec dw-demo -- env                                     # values the container sees
kubectl exec dw-demo -- cat /etc/podinfo/labels                 # file form
kubectl label pod dw-demo tier=api --overwrite                  # change a label, then re-read the file
kubectl get pod dw-demo -o yaml | grep -A8 'projected:'         # what was requested
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `The Pod "dw-bad" is invalid: spec.containers[0].env[0].valueFrom.fieldRef.fieldPath: Invalid value: "metadata.uid2": error converting fieldPath: field label not supported: metadata.uid2` | The path is not one the Downward API supports | Use a path from `kubectl explain ...fieldRef` |
| `The Pod "dw-dup" is invalid:` with `spec.volumes[0].projected: Invalid value: "db-cred": conflicting duplicate paths` | Two sources of one projected volume write to the same path (`same`) | Give every source item a unique `path` |
| An env var built from a label keeps its old value after `kubectl label` (documented, not reproduced; the volume file did change) | Environment variables are set once when the container starts | Read the volume file, or restart the Pod |

## Related

- **Cards:** ConfigMap, Secret, Volume types, ServiceAccount (token projection), Certificates and trust bundles (trust bundles)
- **Chapter and lab:** not a separate row in the coverage matrix; closest is Ch 5.3 and Lab 5.3
- **Exam:** CKAD, Application Environment, Configuration and Security (25%)
- **Source:** [Downward API](https://kubernetes.io/docs/concepts/workloads/pods/downward-api/), [Projected Volumes](https://kubernetes.io/docs/concepts/storage/projected-volumes/)
