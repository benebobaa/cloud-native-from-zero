# Milestone 6 · A Secured Wallet

## Goal

You hand over a wallet that a security reviewer can attack from inside the cluster and fail: every connection is denied unless a policy allows it, traffic enters through one Gateway, service-to-service traffic is encrypted, only signed and hardened Pods are admitted, and a shell in a wallet container raises an alert.

**Scenario.** The wallet is about to handle real money. A security reviewer has one afternoon with a Pod inside your cluster and the credentials of a normal developer. The rubric below is what she will try.

**Starting point.** The cluster and manifests of Labs 6.1 to 6.3 (a kind cluster with Cilium, the `wallet` namespace with `wallet-api`, `wallet-worker` and `postgres`, image `wallet:v1`). Rebuild from your repo with the script you write in deliverable 9; do not hand over a cluster you hand-edited.

**Versions tested** (2026-11-19, Ubuntu 24.04.5 LTS on arm64 in a virtual machine, Docker Engine 29.10.0 from Docker's apt repository): the reference solution, an `up.sh` and a `check.sh` like the ones you write, built everything from an empty machine in 9.5 minutes and passed all 18 checks. kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1, Helm v4.3.1, Cilium 1.20.4, Gateway API v1.6.3, Linkerd edge-26.11.2, Kyverno v1.20.0, cosign v2.6.1, Falco 0.45.2 (modern eBPF driver), `registry:2`.

## Deliverables

Put everything in one directory of your wallet repository, `milestone6/`.

| # | Deliverable | What it contains | Proof the reviewer runs |
| --- | --- | --- | --- |
| 1 | Cluster | `kind.yaml` with the default CNI and kube-proxy off; Helm values file for Cilium (kube-proxy replacement, Hubble) | `cilium-dbg status` reports kube-proxy replacement on; no `kube-proxy` DaemonSet exists |
| 2 | Network isolation | `netpol/`: default deny for ingress and egress, DNS, and one policy per legitimate path; `test-netpol.sh` | The script prints PASS for 3 allowed paths and 3 blocked paths |
| 3 | Entry point | `gateway/`: a `Gateway` and an `HTTPRoute` for `wallet-api` | `curl` through the Gateway address returns the wallet's `/healthz`; `./test_e2e.sh` passes against it |
| 4 | Encryption in transit | `mesh/`: Linkerd installed by Helm, wallet Pods injected, a short `NOTES` on how you made the mesh work with your policies | Pods show `2/2`; the proxy's metrics show connections with TLS to `postgres` |
| 5 | Admission | The `wallet` namespace labelled Pod Security `restricted`; one Kyverno policy in `Enforce` mode | A privileged Pod and an unsigned image are both rejected with a readable message |
| 6 | Supply chain | `supply-chain/`: `cosign.pub`, `sign.sh`, `verify.sh`; the private key is not in the repository | `verify.sh` succeeds for `wallet:v1` by digest and fails for a re-pushed tag |
| 7 | Runtime detection | Falco installed with its alert for a shell in a container; `evidence/falco.txt` holds the alert line. If your kernel cannot load Falco's driver, hand in the failing command output and the kernel facts instead | The alert names the Pod, namespace and the command |
| 8 | Threat model | `THREATS.md`: five attacks, the control that stops each, and the command that proves it | The reviewer picks two rows and runs them |
| 9 | Reproducibility | `up.sh` builds everything from nothing; `down.sh` removes it | A clean machine reaches the checks above in one run |

## Grading rubric

100 points. Partial credit is allowed where the table says so; a control that works only because it is switched to audit-only earns half.

| Area | Points | Full marks | Partial credit |
| --- | --- | --- | --- |
| Network isolation | 20 | Default deny in both directions; all 3 blocked paths fail and all 3 allowed paths work; DNS works | 10 if only ingress is denied; 5 if the policy exists but a blocked path still works |
| Entry point | 10 | Traffic enters through the Gateway; `test_e2e.sh` passes through it | 5 if the Gateway works only from inside the cluster with no explanation |
| Encryption in transit | 15 | Wallet Pods meshed; evidence of TLS between `wallet-api` and `postgres`; policies still allow the mesh | 8 if Pods are meshed but there is no evidence of TLS |
| Admission | 15 | `restricted` enforced on the namespace with no weakened Pods; Kyverno rule enforces and rejects with a clear message | 8 if the policy only audits |
| Supply chain | 15 | Digest signed; `verify.sh` passes and fails correctly; no private key in the repo | 8 if signing works but admission does not verify; 0 if the private key is committed |
| Runtime detection | 5 | Alert for a shell in a wallet Pod captured | 3 for a documented attempt with kernel facts if the driver cannot load |
| Threat model | 10 | Five attacks, each with control and proof command that actually runs | 5 for rows without a runnable proof |
| Reproducibility | 10 | `up.sh` builds a passing cluster from nothing | 5 if one manual step remains and is documented |

## Rules

- No `latest` tags; images are referenced by digest where the policy requires it.
- No secret, token or private key in Git. The reviewer runs `git log -p | grep -i 'BEGIN'` before grading.
- Every exception (a namespace left outside a policy, a port left open) is listed in `THREATS.md` with the reason.

**Stretch goals.** A `CiliumNetworkPolicy` that allows only `GET` on `/accounts/*` to `wallet-api`; a TLS listener on the Gateway; keyless signing from a CI workflow.
