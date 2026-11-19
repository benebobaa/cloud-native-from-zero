# Cloud Native from Zero · Vol 6: Kubernetes Networking and Security

Volume 6 takes three weeks. It teaches how Pods talk to each other and the outside world, and how to keep a cluster safe.

## Outcomes

After this volume you can make a cluster's network work, open it to the outside, and lock it down, and you can prove each step with a command.

1. **Explain how a Pod gets its address.** Name the three actors (kubelet, container runtime, CNI plugin), read a CNI configuration, and find on a real node the same veth pair, routes and namespaces you built by hand in Ch 2.5.
2. **Run a cluster without kube-proxy** and watch every Pod-to-Pod flow, with its verdict, in Hubble.
3. **Write NetworkPolicies** that deny everything by default and allow only the wallet's real paths, and debug a dropped flow in under five minutes.
4. **Expose a Service through Gateway API** with a `GatewayClass`, `Gateway` and `HTTPRoute`.
5. **Encrypt service-to-service traffic** with a mesh, and explain what a sidecar and a certificate do in it.
6. **Gate what enters the cluster:** Pod Security `restricted`, an admission policy, and an image-signature check.
7. **Detect what runs wrong:** read a runtime alert and say which rule fired and why.

The optional KCNA point comes after week 22 (Vol 5) and the CKA and CKAD points after week 28 (Vol 7). NetworkPolicy, Services and Gateway API from this volume are on the CKA curriculum ([cncf/curriculum](https://github.com/cncf/curriculum)).

## Chapter map

{{diagram overview-01.jsx | Vol 6 chapter map · three chapters and the milestone}}

| Chapter | Question it answers | Lab builds |
| --- | --- | --- |
| 6.1 Pod networking, CNI and Cilium | How does every Pod get an IP and a path, and who may use it? | A cluster with Cilium, no kube-proxy, Hubble flows, default-deny policy on the wallet |
| 6.2 Gateway API and the service mesh | How does traffic get in, and how do services trust each other? | A Gateway and HTTPRoute in front of the wallet, Linkerd mTLS between its Pods |
| 6.3 Security and supply chain | What may enter the cluster, and what is it doing now? | Pod Security `restricted`, a Kyverno policy, a cosign-signed wallet image, runtime alerts |
| Milestone 6 | Can you hand over a wallet that is secured end to end? | All of the above, together, graded |

## Prerequisites and versions tested

You need Vols 1 to 5 and the wallet from them; the labs rebuild everything else. Ch 2.5 (a network built by hand with `ip`) and Ch 5.3 (Services and DNS) are the two chapters this volume leans on most.

| You need | Why |
| --- | --- |
| A Linux shell on Ubuntu 24.04 LTS (native, VM or WSL2) with Docker | kind runs each node as a Docker container |
| `kind`, `kubectl`, `helm`, `openssl`, `go` | cluster, client, charts, certificates, and the `cosign` install in Lab 6.3 |
| The `wallet:v1` image and `test_e2e.sh` from Vol 3 | the case study that every lab secures |
| 8 GB of RAM and about 15 GB of free disk | one two-node cluster at a time; the full stack of this volume (Cilium, Hubble, Linkerd, Kyverno, Falco and the wallet) ran on an 8 GB machine |
| A kernel with BTF (`/sys/kernel/btf/vmlinux`) | Cilium and Falco load eBPF programs; Lab 6.3 checks this before it promises an alert |

Versions tested on 2026-11-17 on Ubuntu 26.04 under WSL2 (kernel 6.18.58.1-microsoft-standard-WSL2) with Docker Desktop 29.9.2; the target for students is Ubuntu 24.04 LTS.

| Tool | Version | Used in |
| --- | --- | --- |
| Kubernetes (kind node image) | 1.37.0, `kindest/node:v1.37.0`; kubectl v1.37.1 | all labs |
| kind | v0.33.0 | all labs |
| Helm | v4.3.1 | all labs |
| Cilium and Hubble | 1.20.4 (chart 1.20.4) | 6.1, 6.2 |
| Gateway API CRDs | v1.6.3, standard channel | 6.2 |
| Linkerd | edge-26.11.2 (charts 2026.11.2, CNI plugin v1.7.1) | 6.2 |
| Kyverno | v1.20.0 (chart 3.10.0) | 6.3 |
| cosign | v2.6.1, built with `go install` | 6.3 |
| Falco | 0.45.2 (chart 9.2.2), modern eBPF driver | 6.3 |
| registry | `registry:2`, plain HTTP, lab only | 6.3 |

What was **not** run, and is marked as targeted where it appears: a native Ubuntu 24.04 host, plain Docker Engine (the `kind load docker-image` path), and the CKA exam environment. Calico, Flannel, Istio, OPA Gatekeeper and Harbor have project cards only; you do not install them. Image downloads dominate the time: the first Cilium install pulled about 1 GB per node and took 6 minutes on the test network.
