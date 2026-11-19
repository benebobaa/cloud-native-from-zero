# Pod Security Admission

## What and why

Pod Security Admission (PSA) is a built-in admission plugin that checks Pods against the three Pod Security Standards: privileged, baseline and restricted. Labels on a namespace pick the level and what to do on a violation: enforce (reject), warn or audit.

**Acts on it:** the PodSecurity admission plugin in the kube-apiserver. It replaced PodSecurityPolicy, which was removed in Kubernetes 1.25.

## Diagram

{{diagram pod-security-admission-01.jsx | Pod Security Admission · 3 modes}}

PSA judges Pods against a fixed standard; it cannot be customised, only turned up or down.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-17). Pod Security Admission is built into the API server and configured only by namespace labels.

```bash
kubectl create ns psa-demo
kubectl label ns psa-demo \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/warn=restricted
kubectl -n psa-demo run bad --image=busybox:1.37 -- sleep 3600
```

```text
Error from server (Forbidden): pods "bad" is forbidden: violates PodSecurity "restricted:latest": allowPrivilegeEscalation != false (container "bad" must set securityContext.allowPrivilegeEscalation=false), unrestricted capabilities (container "bad" must set securityContext.capabilities.drop=["ALL"]), runAsNonRoot != true (pod or container "bad" must set securityContext.runAsNonRoot=true), seccompProfile (pod or container "bad" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")
$ kubectl -n psa-demo get pods
No resources found in psa-demo namespace.
```

A Pod that meets the four rules is admitted:

```yaml
apiVersion: v1
kind: Pod
metadata: {name: good, namespace: psa-demo}
spec:
  securityContext: {runAsNonRoot: true, runAsUser: 10001, seccompProfile: {type: RuntimeDefault}}
  containers:
  - name: c
    image: busybox:1.37
    command: [sleep, "3600"]
    securityContext: {allowPrivilegeEscalation: false, capabilities: {drop: [ALL]}}
```

The error lists every violated check at once, so one failed attempt tells you the whole fix. At the `baseline` level the checks are fewer, for example `privileged (container "c" must not set securityContext.privileged=true)` and `host namespaces (hostNetwork=true)`.

## Key fields

PSA has no object of its own: you set it with namespace labels, and cluster-wide defaults in the admission configuration file.

| Setting | Meaning | Default |
| --- | --- | --- |
| `pod-security.kubernetes.io/enforce: <level>` | Reject Pods that break the level | `privileged` (nothing rejected) |
| `pod-security.kubernetes.io/warn: <level>` | Allow, but return a warning to the client; also checks Deployments and other Pod templates | `privileged` |
| `pod-security.kubernetes.io/audit: <level>` | Allow, but add an annotation to the audit event | `privileged` |
| `pod-security.kubernetes.io/<mode>-version` | Which Kubernetes minor's rules to apply, for example `v1.37` | `latest` |
| Level `privileged` | No restrictions |  |
| Level `baseline` | Blocks known escalations: privileged containers, host namespaces, `hostPath`, extra capabilities |  |
| Level `restricted` | Baseline plus: run as non-root, `allowPrivilegeEscalation: false`, drop `ALL` capabilities, seccomp `RuntimeDefault` or `Localhost` |  |
| `PodSecurityConfiguration` `defaults` | Cluster-wide level and version for namespaces without labels; passed with `--admission-control-config-file` | all `privileged`, `latest` |
| `PodSecurityConfiguration` `exemptions` | `usernames`, `runtimeClasses`, `namespaces` that skip all three modes | empty |

Sources: [Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/) (stable since v1.25) and [Enforce Pod Security Standards by configuring the built-in admission controller](https://kubernetes.io/docs/tasks/configure-pod-container/enforce-standards-admission-controller/). Enforce applies to Pods only, never to the Deployment that creates them.

## kubectl

```
kubectl label ns psa-demo pod-security.kubernetes.io/enforce=restricted pod-security.kubernetes.io/enforce-version=v1.37
kubectl label ns psa-demo pod-security.kubernetes.io/warn=restricted        # add a warn mode
kubectl get ns psa-demo --show-labels
kubectl get ns -l pod-security.kubernetes.io/enforce                         # which namespaces enforce anything
kubectl label --dry-run=server --overwrite ns psa-existing pod-security.kubernetes.io/enforce=restricted   # lists Pods that would break
kubectl label ns psa-demo pod-security.kubernetes.io/enforce-                # remove the label (back to the default)
kubectl describe rs -n psa-demo                                              # FailedCreate events when a Deployment's Pods are rejected
kubectl get events -n psa-demo --field-selector reason=FailedCreate
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubectl create deploy dep --image=nginx:1.31.8` succeeds (with `Warning: would violate PodSecurity "restricted:latest": ...` only because the `warn` label is set), but `READY 0/1`; `describe rs` shows `Error creating: pods "dep-85585c66f4-2fzcv" is forbidden: violates PodSecurity "restricted:latest": ...` | PSA judges Pods, not Deployments: the Deployment is accepted and its ReplicaSet fails when it creates Pods | Look at the ReplicaSet events (`kubectl describe rs`), then add the securityContext to the Pod template; keep `warn` and `audit` labels beside `enforce` so the Deployment itself warns |
| `The Namespace "psa-exist" is invalid: metadata.labels[pod-security.kubernetes.io/enforce]: Invalid value: "restrcted": must be one of privileged, baseline, restricted` | A typo in the level is rejected at label time on 1.37, so no namespace is left unprotected by accident | Use `privileged`, `baseline` or `restricted` exactly; the same check covers `warn` and `audit` |
| After `kubectl label --dry-run=server --overwrite ns psa-exist pod-security.kubernetes.io/enforce=restricted`: `Warning: existing pods in namespace "psa-exist" violate the new PodSecurity enforce level "restricted:latest"` then `Warning: web: allowPrivilegeEscalation != false, unrestricted capabilities, runAsNonRoot != true, seccompProfile` | Switching `enforce` on in a namespace that already has Pods: the server checks them and warns | Always run the server-side dry run first; fix or move the listed workloads, then apply the label for real |

## Related

- **Cards:** SecurityContext and capabilities, Namespace (group 2), Admission webhooks, ValidatingAdmissionPolicy.
- **Chapter and lab:** 6.3.
- **Exam:** CKAD Application Environment, Configuration and Security (25%): authentication, authorization and admission control.
