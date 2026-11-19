# Lab 6.3 · Kyverno, cosign and Falco

**Goal.** Harden the wallet until a reviewer with a shell in the cluster cannot run what she likes: enforce the `restricted` Pod Security level, add a Kyverno policy, sign the wallet image with cosign and make the cluster refuse unsigned images, and read a Falco alert when someone opens a shell in a wallet Pod. Time: about 4 hours, of which the cosign build can take 7 minutes.

**Versions tested** (run on 2026-11-17): continues on the cluster of Labs 6.1 and 6.2 (Kubernetes 1.37.0, Cilium 1.20.4, Linkerd edge-26.11.2). New here: Kyverno v1.20.0 (Helm chart 3.10.0), cosign v2.6.1, Falco 0.45.2 (Helm chart 9.2.2, modern eBPF driver), `registry:2`. Falco's driver loaded on the WSL2 kernel 6.18.58.1-microsoft-standard-WSL2 (BTF present) and raised the alert below; your kernel may differ, so Part E checks first. Not run here: keyless cosign signing (needs an OIDC identity and the public Sigstore services), a Falco kernel-module driver, Ubuntu 24.04 on bare metal.

### What you will build

{{diagram lab-6-3-01.jsx | Lab 6.3 · what you will build}}

## Part A · Pod Security `restricted`

Label the namespace first and read what Kubernetes says; the wallet from Lab 6.1 asked for none of the required settings. Only new Pods are checked, so the running Pods stay up.

```bash
kubectl label ns wallet pod-security.kubernetes.io/enforce=restricted
kubectl rollout restart deploy/wallet-api -n wallet
kubectl get rs -n wallet -l app=wallet-api
```

```text
Warning: existing pods in namespace "wallet" violate the new PodSecurity enforce level "restricted:latest"
Warning: postgres-0 (and 3 other pods): allowPrivilegeEscalation != false, unrestricted capabilities, runAsNonRoot != true, seccompProfile
namespace/wallet labeled
Warning: would violate PodSecurity "restricted:latest": allowPrivilegeEscalation != false (container "api" must set securityContext.allowPrivilegeEscalation=false), unrestricted capabilities (container "api" must set securityContext.capabilities.drop=["ALL"]), runAsNonRoot != true (pod or container "api" must set securityContext.runAsNonRoot=true), seccompProfile (pod or container "api" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")
deployment.apps/wallet-api restarted

NAME                    DESIRED   CURRENT   READY   AGE
wallet-api-5b9984859f   1         0         0       7s
wallet-api-656467d8c5   2         2         2       6m45s
```

The Deployment was accepted with a warning, but the new ReplicaSet wants 1 Pod and has 0: the Pod was rejected. This is the behaviour of part 3: Pod Security Admission checks Pods, not Deployments, so the error lives in `kubectl describe rs` (the condition `ReplicaFailure True FailedCreate`), not in `kubectl apply`. Fix all three workloads with one patch file each. The api and the worker already run as UID 10001; Postgres needs a numeric non-root user, and `fsGroup` so that it may write its volume.

```yaml
# harden-api.yaml (harden-worker.yaml is the same with name: worker)
spec:
  template:
    spec:
      securityContext: {runAsNonRoot: true, seccompProfile: {type: RuntimeDefault}}
      containers:
        - name: api
          securityContext: {allowPrivilegeEscalation: false, capabilities: {drop: [ALL]}}
---
# harden-postgres.yaml
spec:
  template:
    spec:
      securityContext: {runAsNonRoot: true, runAsUser: 999, runAsGroup: 999, fsGroup: 999, seccompProfile: {type: RuntimeDefault}}
      containers:
        - name: postgres
          securityContext: {allowPrivilegeEscalation: false, capabilities: {drop: [ALL]}}
```

```bash
kubectl -n wallet patch deploy wallet-api --patch-file harden-api.yaml
kubectl -n wallet patch deploy wallet-worker --patch-file harden-worker.yaml
kubectl -n wallet patch sts postgres --patch-file harden-postgres.yaml
kubectl get pods -n wallet
```

```text
NAME                           READY   STATUS    RESTARTS   AGE
postgres-0                     2/2     Running   0          58s
wallet-api-6b9d4c8b56-jm52v    2/2     Running   0          52s
wallet-api-6b9d4c8b56-vkk79    2/2     Running   0          61s
wallet-worker-85c56946ff-6c2f5 2/2     Running   0          60s
```

All three are `2/2`: the wallet container and the Linkerd proxy. The Linkerd CNI plugin of Lab 6.2 matters here: the sidecar's usual init container needs `NET_ADMIN`, which `restricted` forbids, and the CNI plugin removes the need.

While you are here, ask the API server what a default ServiceAccount may do, the habit of part 3. The default account should have no rights. The two answers below are the expected ones: this command was not run on the test cluster.

```bash
kubectl auth can-i list secrets --as=system:serviceaccount:wallet:default -n wallet
kubectl auth can-i get pods --as=system:serviceaccount:wallet:default -n wallet
```

```text
no
no
```

## Part B · Kyverno, and a first policy

Install Kyverno with Helm. The values trim it for a laptop: one admission replica (production runs 3), and the optional controllers off except reporting.

```yaml
# kyverno-values.yaml
admissionController:
  replicas: 1              # production: 3 (Kyverno docs: HA needs 2 or more)
backgroundController: {enabled: false}
cleanupController: {enabled: false}
reportsController: {enabled: true}
features:
  registryClient:
    allowInsecure: true    # lab only: our test registry speaks plain HTTP
```

```bash
helm repo add kyverno https://kyverno.github.io/kyverno/
helm install kyverno kyverno/kyverno --version 3.10.0 -n kyverno --create-namespace -f kyverno-values.yaml
kubectl -n kyverno rollout status deploy --timeout=240s
kubectl get crd | grep -E 'validatingpolicies|imagevalidatingpolicies'
```

```text
deployment "kyverno-admission-controller" successfully rolled out
deployment "kyverno-reports-controller" successfully rolled out
imagevalidatingpolicies.policies.kyverno.io
validatingpolicies.policies.kyverno.io
```

The first policy forbids images without a version tag, or with `:latest`, in the `wallet` namespace. It is a `ValidatingPolicy`: CEL expressions, as in Kubernetes's own ValidatingAdmissionPolicy, plus Kyverno's extras. `validationActions: [Deny]` enforces it; start with `[Audit]` on a real cluster (the "In production" table).

```yaml
apiVersion: policies.kyverno.io/v1
kind: ValidatingPolicy
metadata: {name: no-latest-tag}
spec:
  validationActions: [Deny]
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: [v1]
        operations: [CREATE, UPDATE]
        resources: [pods]
  matchConditions:
    - name: wallet-namespace-only
      expression: "object.metadata.namespace == 'wallet'"
  validations:
    - message: "Images in the wallet namespace need a version tag or a digest, not :latest"
      expression: >-
        object.spec.containers.all(c, c.image.contains('@') ||
        (c.image.substring(c.image.lastIndexOf('/') + 1).contains(':') && !c.image.endsWith(':latest')))
```

Test it with `--dry-run=server`, which runs admission without creating anything. The `--overrides` give the test Pod the hardening that `restricted` demands, so that only the image name decides the result.

```bash
ov() { echo "{\"spec\":{\"securityContext\":{\"runAsNonRoot\":true,\"runAsUser\":101,\"seccompProfile\":{\"type\":\"RuntimeDefault\"}},\"containers\":[{\"name\":\"t\",\"image\":\"$1\",\"securityContext\":{\"allowPrivilegeEscalation\":false,\"capabilities\":{\"drop\":[\"ALL\"]}}}]}}"; }
for img in nginx nginx:latest nginx:1.27; do echo "== $img"; kubectl -n wallet run t --image=$img --dry-run=server --overrides="$(ov $img)" 2>&1 | cut -c1-160; done
```

```text
== nginx
Error from server: admission webhook "vpol.validate.kyverno.svc-fail-finegrained-no-latest-tag" denied the request: Policy no-latest-tag failed: Images in the w
== nginx:latest
Error from server: admission webhook "vpol.validate.kyverno.svc-fail-finegrained-no-latest-tag" denied the request: Policy no-latest-tag failed: Images in the w
== nginx:1.27
pod/t created (server dry run)
```

The message the developer reads is the `message` of the policy. Write it as a sentence that says what to do, not as a rule number.

## Part C · Sign the wallet image with cosign

A signature needs a registry to live in, so start one on the kind network and teach the nodes to reach it over plain HTTP. This is lab-only: a real registry uses TLS (Harbor, or your cloud registry).

```bash
docker run -d --name wallet-registry --network kind -p 127.0.0.1:5051:5000 registry:2
for n in cnlab-vol6-control-plane cnlab-vol6-worker; do
  docker exec $n mkdir -p /etc/containerd/certs.d/wallet-registry:5000
  printf 'server = "http://wallet-registry:5000"\n\n[host."http://wallet-registry:5000"]\n  capabilities = ["pull", "resolve"]\n' \
    | docker exec -i $n tee /etc/containerd/certs.d/wallet-registry:5000/hosts.toml >/dev/null
done
docker tag wallet:v1 localhost:5051/wallet:v1
docker push localhost:5051/wallet:v1
curl -s localhost:5051/v2/wallet/tags/list
```

```text
v1: digest: sha256:6506e8061da76f1cf9cb8147c8fa702ffab6782461b053f4bdc50826fd8967d2 size: 856
{"name":"wallet","tags":["v1"]}
```

If `docker push` fails with `error getting credentials`, Docker's credential helper is unreachable in your shell; run the command with `DOCKER_CONFIG` pointing at a directory that holds a file `config.json` containing `{}`. The Pods will name the image `wallet-registry:5000/wallet`; your laptop names the same registry `localhost:5051`.

Now install cosign. `go install` compiles it, which took 6 minutes 55 seconds on the test machine; the project also publishes release binaries (a corporate network may block those downloads, as it did here).

```bash
GOBIN=$HOME/bin go install github.com/sigstore/cosign/v2/cmd/cosign@v2.6.1
export PATH=$HOME/bin:$PATH
cosign version | grep GitVersion
mkdir -p ~/cn-lab/vol6/supply-chain && cd ~/cn-lab/vol6/supply-chain
COSIGN_PASSWORD="" cosign generate-key-pair
REF=localhost:5051/wallet@sha256:6506e8061da76f1cf9cb8147c8fa702ffab6782461b053f4bdc50826fd8967d2   # use YOUR digest
cosign verify --key cosign.pub --insecure-ignore-tlog=true $REF
COSIGN_PASSWORD="" cosign sign --key cosign.key --tlog-upload=false --yes $REF
cosign verify --key cosign.pub --insecure-ignore-tlog=true $REF
```

```text
GitVersion:    v2.6.1
Private key written to cosign.key
Public key written to cosign.pub

Error: no signatures found
Pushing signature to: localhost:5051/wallet
  - The signatures were verified against the specified public key
[{"critical":{"identity":{"docker-reference":"localhost:5051/wallet"},"image":{"docker-manifest-digest":"sha256:6506e8..."},"type":"cosign container image signature"},"optional":null}]
```

The signature names the digest, so it holds for exactly these bytes. Three flags are lab shortcuts and each one has a reason: an empty `COSIGN_PASSWORD` (a real key gets a passphrase or lives in a KMS), `--tlog-upload=false` (no public transparency log, so nothing leaves your laptop) and `--insecure-ignore-tlog=true` on verify (the matching setting). **Never commit `cosign.key`.** Add it to `.gitignore` now: Milestone 6 gives 0 points for a committed private key.

## Part D · Make the cluster check the signature

A signature that nobody checks protects nothing. Kyverno's `ImageValidatingPolicy` holds your public key and verifies every matching image at admission. This script writes the policy with your `cosign.pub` inside; run it in the directory that holds the key.

```bash
cat > require-signed.sh <<'EOF'
#!/usr/bin/env bash
cat <<YAML | kubectl apply -f -
apiVersion: policies.kyverno.io/v1
kind: ImageValidatingPolicy
metadata: {name: wallet-images-signed}
spec:
  validationActions: [Deny]
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: [v1]
        operations: [CREATE, UPDATE]
        resources: [pods]
  matchImageReferences:
    - glob: "wallet-registry:5000/*"          # only images from our registry
  attestors:
    - name: cosign
      cosign:
        key:
          data: |
$(sed 's/^/            /' cosign.pub)
        ctlog: {insecureIgnoreTlog: true}     # lab only: we signed with --tlog-upload=false
  validations:
    - expression: >-
        images.containers.map(image, verifyImageSignatures(image, [attestors.cosign])).all(e, e > 0)
      message: "image must be signed with the wallet cosign key"
YAML
EOF
bash require-signed.sh
sleep 10; kubectl get imagevalidatingpolicy
```

```text
imagevalidatingpolicy.policies.kyverno.io/wallet-images-signed created
NAME                   AGE   READY
wallet-images-signed   12s   true
```

Now make an image you did not sign, push it, and try three Pods: the signed image, the unsigned image, and a privileged Pod. (`wallet:alpine` is the small variant from Vol 4; any other image works.)

```bash
docker tag wallet:alpine localhost:5051/wallet:unsigned && docker push localhost:5051/wallet:unsigned
ov() { echo "{\"spec\":{\"securityContext\":{\"runAsNonRoot\":true,\"runAsUser\":10001,\"seccompProfile\":{\"type\":\"RuntimeDefault\"}},\"containers\":[{\"name\":\"t\",\"image\":\"$1\",\"command\":[\"sleep\",\"3600\"],\"securityContext\":{\"allowPrivilegeEscalation\":false,\"capabilities\":{\"drop\":[\"ALL\"]}}}]}}"; }
for img in wallet-registry:5000/wallet:v1 wallet-registry:5000/wallet:unsigned; do echo "== $img"; kubectl -n wallet run t --image=$img --dry-run=server --overrides="$(ov $img)" 2>&1 | cut -c1-420; done
kubectl -n wallet run priv --image=wallet-registry:5000/wallet:v1 --dry-run=server --overrides='{"spec":{"containers":[{"name":"priv","image":"wallet-registry:5000/wallet:v1","securityContext":{"privileged":true}}]}}' 2>&1 | cut -c1-330
```

```text
== wallet-registry:5000/wallet:v1
pod/t created (server dry run)
== wallet-registry:5000/wallet:unsigned
Error from server: admission webhook "ivpol.validate.kyverno.svc-fail" denied the request: Policy wallet-images-signed failed: image must be signed with the wallet cosign key; verification details: image "wallet-registry:5000/wallet:unsigned@sha256:bb907156161c6545e23346d4d8633ae114883f0f89f35a10b4a4a28b8c3196c5", attestor "cosign": failed to verify cosign signatures: no signatures found
Error from server (Forbidden): pods "priv" is forbidden: violates PodSecurity "restricted:latest": privileged (container "priv" must not set securityContext.privileged=true), allowPrivilegeEscalation != false (container "priv" must set securityContext.allowPrivilegeEscalation=false), unrestricted capabilities ...
```

Two different gates answered. The unsigned image was refused by Kyverno, and the message names the digest it resolved the tag to, because the policy checks bytes, not names. The privileged Pod never reached Kyverno's verdict: Pod Security refused it first, with its own readable list. Finally move the real wallet to the signed image, referenced by digest, and let admission re-check it.

```bash
D=sha256:6506e8061da76f1cf9cb8147c8fa702ffab6782461b053f4bdc50826fd8967d2     # use YOUR digest
kubectl -n wallet set image deploy/wallet-api api=wallet-registry:5000/wallet@$D
kubectl -n wallet set image deploy/wallet-worker worker=wallet-registry:5000/wallet@$D
kubectl -n wallet rollout status deploy/wallet-api deploy/wallet-worker --timeout=300s
kubectl -n wallet get pods -l app=wallet-api -o jsonpath='{.items[*].spec.containers[?(@.name=="api")].image}'
```

## Part E · Falco: detect a shell

Prevention is done; now watch what runs. Falco needs a kernel driver, so check your kernel before you install anything. The modern eBPF driver wants BTF and BPF support.

```bash
docker exec cnlab-vol6-worker sh -c 'ls -l /sys/kernel/btf/vmlinux; zcat /proc/config.gz | grep -E "CONFIG_BPF_SYSCALL=|CONFIG_DEBUG_INFO_BTF="'
```

```text
-r--r--r-- 1 root root 6037569 Nov 17 02:57 /sys/kernel/btf/vmlinux
CONFIG_BPF_SYSCALL=y
CONFIG_DEBUG_INFO_BTF=y
```

The node is a container that shares your kernel, so this is also your host kernel's answer. If `vmlinux` is missing, Falco's modern eBPF driver cannot load: record the failing command and your `uname -r` in your Milestone notes and skip to the checkpoint. Otherwise install Falco with the values below (the image already holds the default rules, so nothing is downloaded at start).

```yaml
# falco-values.yaml
driver:
  kind: modern_ebpf
tty: true                      # flush alerts immediately
falcoctl:
  artifact:
    install: {enabled: false}  # use the rules built into the image
    follow: {enabled: false}
```

```bash
helm install falco oci://ghcr.io/falcosecurity/charts/falco --version 9.2.2 -n falco --create-namespace -f falco-values.yaml
kubectl -n falco rollout status ds/falco --timeout=240s
kubectl -n falco logs ds/falco | grep -E 'Opening|modern BPF'
```

The `oci://` form fetches the chart from a container registry. The usual `helm repo add falcosecurity https://falcosecurity.github.io/charts` redirects to a GitHub release download, which the test network blocked. If Helm reports `error getting credentials` on an `oci://` chart, run it with `HELM_REGISTRY_CONFIG` pointing at a file containing `{}`.

```text
Opening 'syscall' source with modern BPF probe.
```

Now be the intruder. Open a shell in a wallet Pod, run one command and leave, then read the alert.

```bash
kubectl exec -it deploy/wallet-api -n wallet -c api -- sh
# inside the shell:  ls /app   then   exit
kubectl logs -n falco -l app.kubernetes.io/name=falco --tail=200 | grep 'shell was spawned'
```

```text
03:44:23.304882153: Notice A shell was spawned in a container with an attached terminal | evt_type=execve user=<NA> user_uid=10001 user_loginuid=-1 process=sh proc_exepath=/usr/bin/dash parent=<NA> command=sh terminal=34816 exe_flags=EXE_LOWER_LAYER container_id=5eb5ce130392 container_name=api container_image_repository=wallet-registry/wallet container_image_tag=v1 k8s_pod_name=wallet-api-6b9d4c8b56-vkk79 k8s_ns_name=wallet
```

Read the line like a responder: the rule's message, then the user (`uid 10001`, the wallet's account), the process, the container and image, and the Pod and namespace (`wallet-api-6b9d4c8b56-vkk79`, `wallet`). The first alert for a new container can show `<NA>` in the Kubernetes fields because Falco has not yet matched the container to its Pod; the second line carries them, so repeat the shell once if you see `<NA>`. One more real observation: during Postgres start-up Falco also printed `Shell spawned by untrusted binary` for `postgres --single`, a false positive from the database's own initialisation. That is the tuning work of part 5: decide whether such a rule is worth its noise before you route it to a person.

## Checkpoint

| # | Command | Expected output |
| --- | --- | --- |
| 1 | `kubectl get ns wallet -L pod-security.kubernetes.io/enforce` | `restricted` in the label column |
| 2 | `kubectl get pods -n wallet` | every Pod `2/2` |
| 3 | `kubectl auth can-i list secrets --as=system:serviceaccount:wallet:default -n wallet` | `no` |
| 4 | `kubectl get validatingpolicy,imagevalidatingpolicy` | `no-latest-tag` and `wallet-images-signed`, both `READY true` |
| 5 | `cosign verify --key cosign.pub --insecure-ignore-tlog=true $REF` | `The signatures were verified against the specified public key` |
| 6 | the three dry-runs of Part D | signed image accepted; unsigned image: `must be signed`; privileged Pod: `violates PodSecurity` |
| 7 | `kubectl logs -n falco -l app.kubernetes.io/name=falco \| grep 'shell was spawned'` | one line with `k8s_ns_name=wallet` after your shell |

## Break it

**A tag is not an identity.** Someone with push rights re-pushes `wallet:v1` with different content. Predict what Kyverno does with a Pod that names the tag, and with a Pod that names the digest.

```bash
docker tag wallet:alpine localhost:5051/wallet:v1 && docker push localhost:5051/wallet:v1
kubectl -n wallet run t --image=wallet-registry:5000/wallet:v1 --dry-run=server --overrides="$(ov wallet-registry:5000/wallet:v1)" 2>&1 | cut -c1-330
kubectl -n wallet run t --image=wallet-registry:5000/wallet@$D --dry-run=server --overrides="$(ov wallet-registry:5000/wallet@$D)" 2>&1 | cut -c1-200
```

```text
Error from server: admission webhook "ivpol.validate.kyverno.svc-fail" denied the request: Policy wallet-images-signed failed: image must be signed with the wallet cosign key; verification details: image "wallet-registry:5000/wallet:v1@sha256:bb907156161c6545e23346d4d8633ae114883f0f89f35a10b4a4a28b8c3196c5", attestor "cosig
pod/t created (server dry run)
```

The tag now points at bytes nobody signed, so the tag form is refused; the digest form still points at your signed bytes and passes. This is why the Milestone references images by digest. Restore the tag with `docker tag wallet:v1 localhost:5051/wallet:v1 && docker push localhost:5051/wallet:v1`.

A second failure you should know about but not cause: when Kyverno's webhook is down, behaviour depends on its `failurePolicy`. On the test machine, scaling the admission controller to 0 replicas let Pods in unchecked, so nothing was enforced while the engine was down. A crash would differ if the webhook stayed registered with `failurePolicy: Fail`; that case was not run here. Part 2 of the chapter is the reason to run several replicas and to rehearse this outage.

**Clean up** when Vol 6 is finished: `kind delete cluster --name cnlab-vol6`, `docker rm -f wallet-registry`, and delete your `cosign.key`.
