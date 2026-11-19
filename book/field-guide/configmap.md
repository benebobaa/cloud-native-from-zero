# ConfigMap

## What and why

A ConfigMap holds non-confidential settings as key-value pairs, so one container image can run unchanged in every environment. A Pod uses it as environment variables, command arguments or files in a volume.

The **kubelet** reads the ConfigMap through the API. Environment variables are set once, when the container starts. For a volume the kubelet refreshes the files after the ConfigMap changes, with a delay. A ConfigMap is limited to 1 MiB. Setting `immutable: true` forbids later edits and lets the kubelet stop watching it, which reduces load on the API server.

## Diagram

{{diagram configmap-01.jsx | ConfigMap delivery · 4 boxes}}
Environment variables are copied once at start; a mounted ConfigMap volume is refreshed by the kubelet.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). One ConfigMap with a literal and a file, used three ways in one Pod:

```bash
kubectl create configmap app-config --from-literal=greeting=hello --from-file=app.properties
```

```yaml
apiVersion: v1
kind: Pod
metadata: {name: cm-demo}
spec:
  containers:
  - name: c
    image: alpine:3.21
    command: [sh, -c, "sleep 3600"]
    env:
    - name: GREETING
      valueFrom: {configMapKeyRef: {name: app-config, key: greeting}}
    envFrom: [{configMapRef: {name: app-config}, prefix: CFG_}]
    volumeMounts: [{name: conf, mountPath: /etc/app}]
  volumes:
  - name: conf
    configMap: {name: app-config}
```

```
$ kubectl exec cm-demo -- sh -c 'echo $GREETING; env | grep CFG_; ls /etc/app; cat /etc/app/app.properties'
hello
CFG_greeting=hello
CFG_app.properties=log.level=info
app.properties
greeting
log.level=info
feature.x=on
```

Edit the ConfigMap and watch which copy changes. The file followed after about 80 seconds in this test; the environment variable did not:

```
$ kubectl patch cm app-config --type merge -p '{"data":{"greeting":"bonjour"}}'
$ kubectl exec cm-demo -- sh -c 'echo file=$(cat /etc/app/greeting) env=$GREETING'
file=bonjour env=hello
```

## Key fields

Checked with `kubectl explain configmap` on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| `data` | text key-value pairs; keys use letters, digits, `-`, `_`, `.` | empty |
| `binaryData` | base64 binary values; keys must not overlap `data`; not usable through `configMapKeyRef` or `envFrom` | empty |
| `immutable` | `true` forbids changing `data` and `binaryData` (metadata can still change) | `nil`, so editable |
| Pod `env[].valueFrom.configMapKeyRef` | one key into one variable (`name`, `key`, optional `optional`) | n/a |
| Pod `envFrom[].configMapRef` | every key as a variable, with optional `prefix` | n/a |
| Pod `volumes[].configMap` | mount keys as files; `items`, `defaultMode` choose files and permissions | all keys, one file each |
| size | the whole object must stay under 1 MiB | n/a |

## kubectl

```bash
kubectl create configmap app-config --from-literal=greeting=hello --from-file=app.properties
kubectl get cm app-config -o yaml        # data, binaryData, immutable
kubectl describe pod cm-demo             # the Failed event names a missing ConfigMap or key
kubectl exec cm-demo -- env              # what the container really sees
kubectl patch cm app-config --type merge -p '{"data":{"greeting":"bonjour"}}'
kubectl patch cm app-config --type merge -p '{"immutable":true}'   # lock it
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pod `CreateContainerConfigError`; event `Error: configmap "nope" not found` | The Pod names a ConfigMap that does not exist in its namespace | Create the ConfigMap (same namespace) or fix the name; `optional: true` lets the Pod start without it |
| Pod `CreateContainerConfigError`; event `Error: couldn't find key nokey in ConfigMap default/app-config` | `configMapKeyRef` names a key the ConfigMap does not have | Fix the key name or add the key |
| ``The ConfigMap "app-config" is invalid: data: Forbidden: field is immutable when `immutable` is set`` | The ConfigMap was locked with `immutable: true` | Create a new ConfigMap under a new name and point the Pod at it; an immutable object cannot be unlocked |

## Related

- **Cards:** Secret, Downward API and projected volumes, Pod, Helm and Kustomize (generate ConfigMaps from files)
- **Chapter and lab:** Ch 5.3 and Lab 5.3
- **Exam:** CKA, Workloads and Scheduling (15%): ConfigMaps and Secrets; CKAD, Application Environment, Configuration and Security (25%): ConfigMaps
- **Source:** [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/)
