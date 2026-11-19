# Audit logging

## What and why

Audit logging records who did what to the API, as a JSON event per request stage. It answers incident questions Pod logs cannot, such as who deleted this ConfigMap and from which address. It is off until you give the kube-apiserver a policy.

**Acts on it:** the kube-apiserver, configured with `--audit-policy-file` and a backend such as `--audit-log-path`.

## Diagram

{{diagram audit-logging-01.jsx | Audit pipeline · 4 steps}}

Auditing is off until you give the API server a policy file.

## Minimal example

Tested on kind v0.33.0 (1 node), node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-17). The cluster was created with a kubeadm config patch that adds `--audit-policy-file`, `--audit-log-path=/var/log/kubernetes/audit.log` and `--audit-log-maxage=1` to kube-apiserver, plus `extraVolumes` that mount the policy directory and the log directory into the API server Pod (kind config: `extraMounts` for the policy file, `kubeadmConfigPatches` of kind `ClusterConfiguration`).

```yaml
apiVersion: audit.k8s.io/v1
kind: Policy
omitStages: ["RequestReceived"]
rules:
- level: None                      # first matching rule wins
  users: ["system:kube-proxy"]
- level: None
  nonResourceURLs: ["/healthz*", "/livez*", "/readyz*", "/version"]
- level: Metadata                  # who touched Secrets, never their contents
  resources: [{group: "", resources: ["secrets"]}]
- level: RequestResponse           # full bodies for ConfigMaps in one namespace
  resources: [{group: "", resources: ["configmaps"]}]
  namespaces: ["audit-demo"]
- level: Metadata                  # everything else
```

```text
$ docker exec cnlab-control-plane wc -l /var/log/kubernetes/audit.log
1929 /var/log/kubernetes/audit.log
$ docker exec ... grep '"resource":"configmaps"' /var/log/kubernetes/audit.log | grep '"verb":"patch"' | tail -1 | jq -c '{level,stage,verb,user:.user.username,objectRef:{resource:.objectRef.resource,name:.objectRef.name},code:.responseStatus.code,hasRequest:(.requestObject!=null),hasResponse:(.responseObject!=null),requestURI}'
{"level":"RequestResponse","stage":"ResponseComplete","verb":"patch","user":"kubernetes-admin","objectRef":{"resource":"configmaps","name":"cfg"},"code":200,"hasRequest":true,"hasResponse":true,"requestURI":"/api/v1/namespaces/audit-demo/configmaps/cfg?fieldManager=kubectl-patch"}
$ docker exec ... grep '"resource":"secrets"' /var/log/kubernetes/audit.log | grep '"name":"pw"' | tail -1 | jq -c '{level,stage,verb,user:.user.username,hasRequest:(.requestObject!=null),hasResponse:(.responseObject!=null)}'
{"level":"Metadata","stage":"ResponseComplete","verb":"get","user":"kubernetes-admin","hasRequest":false,"hasResponse":false}
$ docker exec ... cat /var/log/kubernetes/audit.log | jq -r .level | sort | uniq -c
   1936 Metadata
      5 RequestResponse
$ docker exec ... grep -c healthz /var/log/kubernetes/audit.log
0
```

The patched ConfigMap was logged with both bodies, the Secret only with metadata, and the `None` rules kept 1,929 lines from being dominated by health checks (0 lines mention `healthz`). Each line is one JSON object per request and stage.

## Key fields

Audit is configured by a `Policy` file (`audit.k8s.io/v1`) and kube-apiserver flags, not by an API object.

| Field or flag | Meaning | Default |
| --- | --- | --- |
| Policy `rules[]` | Ordered list; the first matching rule sets the level of an event | required, at least one rule |
| `rules[].level` | `None`, `Metadata`, `Request` or `RequestResponse` | required |
| `rules[].users`, `userGroups`, `verbs` | Match by who and what action | match all |
| `rules[].resources`, `namespaces` | Match by API group, resource (and names) and namespace | match all |
| `rules[].nonResourceURLs` | Match paths such as `/healthz*` | match all |
| `omitStages` | Stages not to record: `RequestReceived`, `ResponseStarted`, `ResponseComplete`, `Panic` | record all stages |
| `--audit-policy-file` | Path to the policy; without it no events are logged | none: audit off |
| `--audit-log-path` | Log file backend; `-` means standard out | none |
| `--audit-log-maxage` / `--audit-log-maxbackup` / `--audit-log-maxsize` | Days to keep, files to keep, MB per file before rotation | 366 / 100 / 100 |
| `--audit-log-format` / `--audit-log-mode` | `json` or `legacy`; `blocking`, `batch` or `blocking-strict` | `json` / `blocking` |
| `--audit-webhook-config-file` | kubeconfig-format file for sending events to a remote collector | none |

Sources: [Auditing](https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/) and [kube-apiserver flags](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/).

## kubectl

Audit lives on the control-plane node, so most commands run there (on kind through `docker exec`).

```
kubectl -n kube-system get pod kube-apiserver-cnlab-control-plane -o yaml | grep audit   # which flags are set
docker exec cnlab-control-plane ls -l /var/log/kubernetes/       # the log file
docker exec cnlab-control-plane tail -1 /var/log/kubernetes/audit.log | python3 -m json.tool
docker exec cnlab-control-plane sh -c 'grep "\"cm2\"" /var/log/kubernetes/audit.log | grep "\"delete\""'   # who deleted it
kubectl -n audit-demo create configmap cm1 --from-literal=k=v         # generate an event to look for
# on a kubeadm node: sudo tail -f /var/log/kubernetes/audit.log | jq '{user: .user.username, verb, uri: .requestURI}'
```

Each line is one JSON event with `level`, `stage`, `verb`, `user.username`, `objectRef`, `responseStatus.code` and `sourceIPs`.

## How it fails

Rows 1 and 2 were reproduced on the test cluster; row 3 is documented behaviour that was not run.

| Symptom | Cause | Fix |
| --- | --- | --- |
| After editing the policy to start with a catch-all rule (`- level: Metadata`) and restarting the API server, the same ConfigMap patch is logged as `{"level":"Metadata","hasRequest":false}` although a `RequestResponse` rule for ConfigMaps follows | Rules are evaluated in order and the first match wins; the catch-all matched everything and the later rules never ran | Put specific rules first and the catch-all last |
| `kubectl get nodes` gives `read: connection reset by peer`; the API server container is `Exited` (attempt counter rising); its log ends `"command failed" err="loading audit policy file: failed to read file path \"/etc/kubernetes/secb/nosuch.yaml\": open /etc/kubernetes/secb/nosuch.yaml: no such file or directory"` | `--audit-policy-file` points to a file that does not exist (or is not mounted into the Pod), and kube-apiserver refuses to start | On the node: `crictl ps -a --name kube-apiserver`, `crictl logs <id>`; fix the path or the volume in `/etc/kubernetes/manifests/kube-apiserver.yaml` (the API came back about 40 s after the fix) |
| The audit log grows without bound, or contains Secret contents | No rotation flags, or a `RequestResponse` rule on Secrets writes the secret data into the log | Set `--audit-log-maxage`, `--audit-log-maxbackup`, `--audit-log-maxsize`; log Secrets at `Metadata` only (as the policy above does) |

The policy is read when the API server starts: after editing the file, restart the API server (here `crictl stop <apiserver container>` and the kubelet starts it again).

## Related

- **Cards:** kube-apiserver (group 1), RBAC, Admission webhooks, Event (group 2).
- **Chapter and lab:** 6.3.
- **Exam:** no curriculum line names it (checked in the CKA and CKAD v1.37 curriculum PDFs, [cncf/curriculum](https://github.com/cncf/curriculum), 2026-11-17).
