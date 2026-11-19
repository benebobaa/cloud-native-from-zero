# Glossary & References

## Glossary

Terms are in the order a reader meets them; the last column says where each is taught.

| Term | Plain meaning | Chapter |
| --- | --- | --- |
| CNI (Container Network Interface) | A specification for how a container runtime asks a plugin program to wire a new container's network | 6.1 |
| CNI plugin | The executable (and its config in `/etc/cni/net.d`) that creates a Pod's interface, address and routes | 6.1 |
| Network namespace | A private copy of interfaces, addresses, routes and firewall rules; one per Pod | 6.1 |
| veth pair | Two virtual interfaces joined like a cable; one end sits in the Pod, the other on the node | 6.1 |
| PodCIDR | The slice of the cluster's Pod address range that one node hands out | 6.1 |
| Overlay | A design that wraps Pod packets inside node-to-node packets, for example VXLAN | 6.1 |
| Native routing | A design where nodes route Pod addresses directly, with no wrapper | 6.1 |
| MTU | The largest packet a link carries; an overlay header lowers what a Pod can send | 6.1 |
| eBPF | A way to load small, verified programs into the Linux kernel and attach them to hooks | 6.1 |
| Hook | A point where the kernel offers to run a program, such as a network interface or a socket operation | 6.1 |
| eBPF map | A key-value table in kernel memory shared by eBPF programs and the agent | 6.1 |
| Socket-LB | Cilium's way of choosing a Service backend when the application calls `connect()` | 6.1 |
| kube-proxy | The component that turns Service addresses into Pod addresses with iptables, IPVS or nftables rules | 6.1 |
| Security identity | A number Cilium derives from a Pod's labels; policy is enforced on identities, not IP addresses | 6.1 |
| Hubble | Cilium's flow-visibility layer; shows each flow and its verdict | 6.1 |
| Verdict | The decision recorded for a flow: forwarded, dropped, and so on | 6.1 |
| NetworkPolicy | A Kubernetes object that restricts which Pods may talk to which; enforced only by a supporting plugin | 6.1 |
| Default deny | A policy that selects every Pod and allows nothing, so only explicit allow rules pass | 6.1 |
| North-south traffic | Traffic entering or leaving the cluster | 6.2 |
| East-west traffic | Traffic between services inside the cluster | 6.2 |
| Ingress | The older API for HTTP routing into a cluster; frozen, with no new features | 6.2 |
| Gateway API | The successor to Ingress: `GatewayClass`, `Gateway`, `HTTPRoute` and related CRDs | 6.2 |
| GatewayClass | Names the controller that implements Gateways | 6.2 |
| Gateway | A point of access with listeners (port, protocol, hostname) | 6.2 |
| HTTPRoute | Rules that match a request's host and path and send it to Services | 6.2 |
| Envoy | A programmable L7 proxy configured dynamically over xDS | 6.2 |
| xDS | Envoy's discovery APIs: LDS (listeners), RDS (routes), CDS (clusters), EDS (endpoints), SDS (secrets) | 6.2 |
| Service mesh | Proxies on every service-to-service call that supply encryption, identity, retries and metrics | 6.2 |
| Sidecar | A proxy container added to every Pod | 6.2 |
| Ambient mode | Istio's mesh mode with a per-node proxy (ztunnel) and optional waypoint proxies | 6.2 |
| mTLS | Mutual TLS: both ends present certificates, so each proves its identity | 6.2 |
| Admission control | Checks that run after authorization and before an object is stored; can mutate or reject | 6.3 |
| Admission webhook | An admission check implemented as a service the API server calls | 6.3 |
| ValidatingAdmissionPolicy | A built-in admission rule written in CEL, run inside the API server | 6.3 |
| CEL | Common Expression Language, used for admission rules | 6.3 |
| Pod Security Standards | Three Pod hardening levels: privileged, baseline, restricted | 6.3 |
| Pod Security Admission | The built-in admission controller that applies those levels through namespace labels | 6.3 |
| RBAC | Role-based access control: roles hold rules, bindings attach roles to subjects; rights only add | 6.3 |
| Image digest | A hash of an image's content; unlike a tag it cannot be moved | 6.3 |
| Image signature | Proof, stored in the registry, of who published a digest | 6.3 |
| Keyless signing | Signing with a short-lived certificate tied to an identity instead of a long-lived key | 6.3 |
| SBOM | Software bill of materials: the list of packages inside an image | 6.3 |
| Runtime detection | Watching running containers for forbidden behaviour, for example with Falco | 6.3 |
| Encryption at rest | The API server encrypts Secrets before writing them to etcd; off by default | 6.3 |
| SealedSecret | A Secret encrypted with a cluster's public key, safe to commit; only the in-cluster controller can decrypt it | 6.3 |
| ExternalSecret | A reference to a value in an external store; the External Secrets Operator copies it into a Secret | 6.3 |
| SOPS | A tool that edits files whose values stay encrypted with age, PGP or a cloud KMS | 6.3 |

## References and versions tested

Every claim of this volume that carries a number, a version or a quotation comes from one of these pages, opened while writing (project maturity levels were checked on 2026-11-16 at cncf.io/projects). Lab versions are in the Overview and at the top of each lab; they were run on 2026-11-17.

| Source | Supports | Chapter |
| --- | --- | --- |
| [CNI specification](https://github.com/containernetworking/cni/blob/main/SPEC.md) | The ADD, DEL, CHECK, VERSION contract and the result format | 6.1 |
| [Kubernetes, Services, load balancing and networking](https://kubernetes.io/docs/concepts/services-networking/) | The network model and its guarantees | 6.1 |
| [Kubernetes, Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) | Selecting, additive rules, AND versus OR selectors | 6.1 |
| [Kubernetes, Virtual IPs and service proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/) | What kube-proxy does and its scaling limits | 6.1 |
| [Cilium, Kubernetes without kube-proxy](https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/) | Socket-LB and the required Helm values | 6.1 |
| [Cilium, Routing](https://docs.cilium.io/en/stable/network/concepts/routing/) | VXLAN on port 8472 versus native routing | 6.1 |
| [Cilium, Gateway API support](https://docs.cilium.io/en/v1.20/network/servicemesh/gateway-api/gateway-api/) | Gateway API v1.6.3 CRDs, kube-proxy replacement as a prerequisite, host-network option | 6.2 |
| [Gateway API documentation](https://gateway-api.sigs.k8s.io/docs) | GatewayClass, Gateway, HTTPRoute and the role model | 6.2 |
| [Envoy, dynamic configuration (xDS)](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/dynamic_configuration) | LDS, RDS, CDS, EDS, SDS | 6.2 |
| [Linkerd, Installing with Helm](https://linkerd.io/2-edge/tasks/install-helm/) | The two charts, trust anchor, issuer, CNI flag | 6.2 |
| [Linkerd, Cluster configuration (Cilium)](https://linkerd.io/2-edge/reference/cluster-configuration/#cilium) | Turning off socket-level load balancing for Pods; `cni.exclusive=false` | 6.2 |
| [Linkerd, Automatic mTLS](https://linkerd.io/2-edge/features/automatic-mtls/) | Which traffic is mTLS, certificate lifetimes | 6.2 |
| [Kubernetes, Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) and [Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/) | The three levels and the enforce, audit, warn modes | 6.3 |
| [Kubernetes, RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) | Additive rights, escalate and bind | 6.3 |
| [Kyverno, ValidatingPolicy](https://kyverno.io/docs/policy-types/validating-policy/) and [ImageValidatingPolicy](https://kyverno.io/docs/policy-types/image-validating-policy/) | CEL policies and `verifyImageSignatures` | 6.3 |
| [Kyverno, Installation](https://kyverno.io/docs/installation/) | Controllers and high availability | 6.3 |
| [Sigstore, cosign signing overview](https://docs.sigstore.dev/cosign/signing/overview/) | Key and keyless signing | 6.3 |
| [Falco documentation](https://falco.org/docs/) and [kernel event source](https://falco.org/docs/concepts/event-sources/kernel/) | Rules, drivers, BTF needs | 6.3 |
| [Kubernetes, Good practices for Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/) | Encryption at rest, least privilege | 6.3 |
| [CNCF projects](https://www.cncf.io/projects/) | Maturity levels and dates on every project card | all |

Two facts rest on your own test, not on a page: the measured `iptables-save` line counts in Lab 6.1 (data file `data/vol6-iptables-lines-vs-services-2026-11-17.csv`) and the Falco driver loading on the WSL2 kernel in Lab 6.3.
