# Syllabus

## 28-week schedule

Two semesters of 14 weeks, one chapter per week, about 6–8 hours of student work per week. Milestones are due the week after their volume ends.

| Week | Ch | Theory | Lab | Due |
| --- | --- | --- | --- | --- |
| 1 | 0.1 | The journey, the stack, the CNCF | Lab setup, first kind cluster | — |
| 2 | 1.1 | Shell, files, permissions | Pipes, permissions, run the wallet | — |
| 3 | 1.2 | Processes, syscalls, memory | strace, signals, the OOM killer | — |
| 4 | 1.3 | Filesystems, boot, systemd | systemd unit, OverlayFS by hand | — |
| 5 | 1.4 | Ops toolkit, performance | Safe scripts, SSH, four injected faults | — |
| 6 | 1.5 | Namespaces, cgroups, capabilities | Container from scratch | — |
| 7 | 2.1 | Models, Ethernet, ARP | ARP in tcpdump | Vol 1 milestone |
| 8 | 2.2 | IP, subnets, routing, NAT | A router, NAT and path MTU | — |
| 9 | 2.3 | TCP and UDP | Capture a handshake | — |
| 10 | 2.4 | DNS, HTTP, TLS | Your own CA and certificate | — |
| 11 | 2.5 | Linux networking internals | A CNI by hand | — |
| 12 | 3.1 | Failure, clocks, CAP | Partition the wallet | Vol 2 milestone |
| 13 | 3.2 | Replication and Raft | 3-node etcd, kill the leader | — |
| 14 | 3.3 | Declarative design, control loops | A reconcile loop on etcd | — |
| 15 | 4.1 | Images and OCI | Containerise the wallet | Vol 3 milestone |
| 16 | 4.2 | Runtimes and the CRI | runc, nerdctl, crictl, gVisor | — |
| 17 | 4.3 | Multi-container apps | Wallet in Compose | — |
| 18 | 5.1 | Kubernetes architecture and API | Read objects from etcd | Vol 4 milestone |
| 19 | 5.2 | Workloads | Deploy, roll out, break probes | — |
| 20 | 5.3 | Services, DNS, config | Trace a packet through a Service | — |
| 21 | 5.4 | Storage and scheduling | Postgres StatefulSet | — |
| 22 | 5.5 | Cluster operations, kubeadm, certificates, etcd backup | kubeadm, etcd restore, drain (CRI-O swap on 2 VMs: targeted, not run) | — |
| 23 | 6.1 | Cluster networking, CNI, eBPF | Cilium, Hubble, NetworkPolicy | Vol 5 milestone |
| 24 | 6.2 | Gateway API, service mesh | Gateway, Linkerd mTLS | — |
| 25 | 6.3 | Security, RBAC and supply chain | Kyverno, cosign, Falco | — |
| 26 | 7.1 | Helm, Kustomize and GitOps | Argo CD deploys the wallet | Vol 6 milestone |
| 27 | 7.2 | Observability and SRE | Prometheus, OpenTelemetry, Jaeger | — |
| 28 | 7.3 | Operators, autoscaling, platforms | Tiny operator, KEDA | Capstone (exam period) |

Optional certification points: KCNA after week 22, once Vol 5 has taught Kubernetes itself. CKA and CKAD after week 28, after practising the timed drills in the Kubernetes Field Guide; both 1.37 curricula include Helm, Kustomize, CRDs and operators, which Vol 7 teaches ([CNCF curriculum](https://github.com/cncf/curriculum)).

## Assessment

Grades reward operating real systems, not memorising YAML; 60% of the grade comes from the wallet milestones and the capstone.

| Component | Weight | How it is checked |
| --- | --- | --- |
| Lab checkpoints (28) | 25% | Checkpoint outputs committed to the student's `cn-lab` git repository |
| Chapter reviews (28) | 15% | Short written answers; lecturers may sample a few per week |
| Volume milestones (6, Vol 1–6) | 30% | The wallet's next step works, plus a one-page design note |
| Capstone (Vol 7) | 30% | Live demo, chaos test, and a written postmortem |

**The capstone.** Deploy the wallet to a fresh cluster with Argo CD from git, with metrics, traces, network policies and signed images in place. The lecturer then breaks something without warning (a node, a policy, a certificate, a database volume). Students restore service and write a blameless postmortem: timeline, root cause, what detected it, what fixed it, and what will prevent it next time.

**Why a postmortem is graded.** Writing a clear postmortem is one of the most valued skills for engineers who run production systems, and it is the hardest one to fake.
