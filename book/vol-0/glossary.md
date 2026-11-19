# Glossary & References

## Glossary

| Term | Meaning in one line | Taught in depth |
| --- | --- | --- |
| Cloud native | Building software that expects failure and recovers automatically, on dynamic infrastructure | Vol 0 |
| CNCF | Cloud Native Computing Foundation, a Linux Foundation body that hosts open-source cloud-native projects | Vol 0 |
| Maturity level | A CNCF project's stage: sandbox, incubating or graduated | Vol 0 |
| Container | A process isolated with kernel features, packaged with its own files | Ch 1.5, Vol 4 |
| Virtual machine (VM) | A full computer, including its own kernel, emulated on top of a hypervisor | Ch 0.1 |
| Hypervisor | Software that runs and isolates VMs | Ch 0.1 |
| Orchestrator | Software that decides where containers run and keeps them running across many machines | Vol 5 |
| Desired state | What you declare should be true, for example "three copies running" | Ch 3.3 |
| Control loop | A program that repeatedly compares desired and actual state and acts on the difference | Ch 3.3 |
| Node | One machine (real or virtual) in a Kubernetes cluster | Ch 5.1 |
| Pod | The smallest unit Kubernetes runs: one or more containers sharing a network address | Ch 5.2 |
| kubelet | The Kubernetes agent on every node; starts and watches Pods | Ch 5.1 |
| API server | The front door of a Kubernetes cluster; every change goes through it | Ch 5.1 |
| etcd | The consistent key-value database that stores all cluster state | Ch 3.2 |
| CRI | Container Runtime Interface: how the kubelet talks to a runtime | Ch 4.2 |
| CNI | Container Network Interface: how Pods get network addresses | Ch 2.5, 6.1 |
| CSI | Container Storage Interface: how Pods get disks | Ch 5.4 |
| kind | "Kubernetes in Docker": runs a whole cluster as containers on one machine | Lab 0.1 |
| kubectl | The command-line client for the Kubernetes API | Lab 0.1, Vol 5 |
| Kernel | The core of the operating system; controls the hardware and shares it among processes | Ch 0.1, Vol 1 |
| Process | One running program, kept apart from other processes by the kernel | Ch 1.2 |

## References and versions

**Versions targeted** (checked 2026-11-16): Ubuntu 24.04 LTS; Kubernetes 1.37 (latest patch 1.37.1); kind v0.33.0 with `kindest/node:v1.37.0`; kubectl v1.37.1; Docker Engine from Docker's apt repository.

Sources opened for this volume:

- [Kubernetes releases](https://kubernetes.io/releases/): supported versions and end-of-life dates
- [kind releases](https://github.com/kubernetes-sigs/kind/releases): kind version and node images
- [Install and set up kubectl on Linux](https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/)
- [Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [CNCF projects](https://www.cncf.io/projects/): maturity levels
- [CNCF project metrics](https://www.cncf.io/project-metrics/): what each maturity level means
- [CNCF cloud native definition](https://github.com/cncf/toc/blob/main/DEFINITION.md)
- [10 years of Kubernetes](https://kubernetes.io/blog/2024/06/06/10-years-of-kubernetes/): first commit date
- [Borg paper](https://research.google/pubs/pub43438/), EuroSys 2015
