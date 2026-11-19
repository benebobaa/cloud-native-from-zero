# SecurityContext and capabilities

## What and why

A `securityContext` sets the Linux privileges a Pod or container runs with: user and group IDs, Linux capabilities, a read-only root filesystem, seccomp, and whether privilege escalation is allowed. It limits what a compromised container can do.

**Acts on it:** the kubelet and the container runtime apply it when they create the container. Pod Security Admission checks the same fields at the API.

## Diagram

{{diagram securitycontext-and-capabilities-01.jsx | securityContext to kernel · 5 steps}}

The API only records the settings; the kernel does the enforcing.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0` (containerd runtime), kubectl v1.37.1 (2026-11-17). Pod `locked` drops everything it does not need; Pod `plain` has no securityContext, for comparison.

```yaml
apiVersion: v1
kind: Pod
metadata: {name: locked, namespace: sc-demo}
spec:
  securityContext:                      # Pod level: applies to every container
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001
    runAsNonRoot: true
    seccompProfile: {type: RuntimeDefault}
  containers:
  - name: c
    image: busybox:1.37
    command: [sleep, "3600"]
    securityContext:                    # container level: wins over the Pod level
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities: {drop: [ALL]}
    volumeMounts: [{name: tmp, mountPath: /tmp}]
  volumes: [{name: tmp, emptyDir: {}}]
```

```text
$ kubectl -n sc-demo exec locked -- id
uid=10001 gid=10001 groups=10001
$ kubectl -n sc-demo exec locked -- sh -c 'touch /x; echo rc=$?'
touch: /x: Read-only file system
rc=1
$ kubectl -n sc-demo exec locked -- sh -c 'touch /tmp/ok && echo tmp-ok; ls -ld /tmp'
tmp-ok
drwxrwsrwx    2 root     10001         4096 Nov 17 04:47 /tmp
$ kubectl -n sc-demo exec locked -- grep -E 'CapEff|NoNewPrivs|Seccomp:' /proc/1/status
CapEff:	0000000000000000
NoNewPrivs:	1
Seccomp:	2
$ kubectl -n sc-demo exec plain -- grep -E 'CapEff|NoNewPrivs|Seccomp:' /proc/1/status
CapEff:	00000000a80425fb
NoNewPrivs:	0
Seccomp:	2
$ kubectl -n sc-demo exec plain -- id
uid=0(root) gid=0(root) groups=0(root),10(wheel)
```

The kernel's own view (`/proc/1/status`) confirms the settings: no capabilities (`CapEff` all zero), `no_new_privs` set, and the `fsGroup` shows up as the setgid group on the volume (`drwxrwsrwx ... 10001`). `plain` runs as root with the runtime's default capability set (`a80425fb`). Seccomp `2` (filter mode) appears in both, because the runtime default profile is applied on this kind node.

## Key fields

| Field | Level | Meaning | Default |
| --- | --- | --- | --- |
| `runAsUser`, `runAsGroup` | Pod or container | UID and GID of the main process | the image's `USER`; runtime default group |
| `runAsNonRoot` | Pod or container | Kubelet refuses to start the container if it would run as UID 0 | not set (no check) |
| `fsGroup` | Pod | Extra group that owns supported volumes and new files in them | not set |
| `seccompProfile.type` | Pod or container | `RuntimeDefault`, `Localhost` or `Unconfined` system-call filter | not set |
| `allowPrivilegeEscalation` | Container | `false` sets `no_new_privs`, so setuid binaries cannot gain root | not set; always true when privileged or with `CAP_SYS_ADMIN` |
| `capabilities.drop` / `.add` | Container | Remove or add Linux capabilities, for example `drop: [ALL]`, `add: [NET_BIND_SERVICE]` | the runtime's default set |
| `readOnlyRootFilesystem` | Container | Container cannot write to its image filesystem; mount `emptyDir` for scratch space | `false` |
| `privileged` | Container | Almost all host powers; avoid | `false` |
| `procMount` | Container | How `/proc` is masked | `Default` |

Fields and defaults are from the [v1.37.0 OpenAPI spec](https://github.com/kubernetes/kubernetes/tree/v1.37.0/api/openapi-spec/v3). When a field is set at both levels, the container value wins.

## kubectl

```
kubectl apply -f hardened.yaml
kubectl exec -n sc-demo hardened -- id                                  # uid=10001 gid=10001 groups=10001
kubectl exec -n sc-demo hardened -- grep -E 'Cap(Eff|Bnd)|NoNewPrivs|Seccomp:' /proc/1/status   # what the kernel applied
kubectl get pod hardened -n sc-demo -o jsonpath='{.spec.securityContext}{"\n"}{.spec.containers[0].securityContext}'
kubectl describe pod rootcheck -n sc-demo                               # CreateContainerConfigError reasons in Events
kubectl logs ro-nginx -n sc-demo                                        # read-only filesystem errors from the app
kubectl explain pod.spec.containers.securityContext                     # field list for your server version
kubectl label --dry-run=server --overwrite ns sc-demo pod-security.kubernetes.io/enforce=restricted   # would these Pods pass?
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pod `CreateContainerConfigError`; event `Error: container has runAsNonRoot and image will run as root (pod: "nonroot-root_sc-demo(...)", container: c)` | `runAsNonRoot: true` but the image's user is root (busybox) and no `runAsUser` was set; the kubelet refuses to start it | Set a numeric `runAsUser` (not 0), or use an image whose `USER` is a non-root number |
| Pod `CreateContainerConfigError`; event `Error: container's runAsUser breaks non-root policy (pod: "nonroot-named_sc-demo(...)", container: c)` | `runAsNonRoot: true` together with `runAsUser: 0` in the container | Remove the contradiction: pick a non-zero UID |
| `touch: /x: Read-only file system`; `ip: RTNETLINK answers: Operation not permitted` | `readOnlyRootFilesystem: true` blocks writes outside mounted volumes; `drop: [ALL]` removes `CAP_NET_ADMIN` | Mount an `emptyDir` where the app writes (the `/tmp` mount above); add back only the single capability the program needs, with `capabilities.add` |

Note what did not fail: `nc -l -p 80` as UID 10001 with all capabilities dropped did not report a permission error, because on this node unprivileged Pods may bind low ports. Do not add `NET_BIND_SERVICE` out of habit; test first.

## Related

- **Cards:** Pod Security Admission, Pod, ServiceAccount, RuntimeClass (group 7).
- **Chapter and lab:** 1.5 and 6.3.
- **Exam:** CKAD Application Environment, Configuration and Security (25%): application security (SecurityContexts, capabilities).
