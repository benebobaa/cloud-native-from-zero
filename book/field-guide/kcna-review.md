# KCNA review

## Exam format and environment

The KCNA is a 90-minute, 60-question multiple-choice exam taken online under remote proctoring; a score of 75% or more passes. Checked against the Linux Foundation pages on 2026-11-16.

| Item | Value | Source |
| --- | --- | --- |
| Format | Online, proctored, multiple choice | [KCNA exam page](https://training.linuxfoundation.org/certification/kubernetes-and-cloud-native-associate-kcna/) |
| Questions | 60 | [Multiple Choice Exams: Important Instructions](https://docs.linuxfoundation.org/tc-docs/certification/important-instructions-mc) |
| Duration | 90 minutes | Same page and the KCNA exam page |
| Passing score | 75% or above | [Multiple Choice Exams: FAQ](https://docs.linuxfoundation.org/tc-docs/certification/faq-mc) |
| Retake and validity | One retake included; certification valid for 2 years | KCNA exam page |
| Environment | PSI Bridge Secure Browser on your own computer; one monitor; webcam and microphone; no virtual machine; results emailed within 24 hours | Important Instructions page |
| Curriculum | `KCNA_Curriculum.pdf` in [github.com/cncf/curriculum](https://github.com/cncf/curriculum); the file name carries no Kubernetes version | CNCF curriculum repository |

The curriculum lists four domains: Kubernetes Fundamentals 44%, Container Orchestration 28%, Cloud Native Application Delivery 16%, Cloud Native Architecture 12%. The bullets under each domain were read from the PDF's two-column layout; check them against the PDF before the exam.

## Timed tasks by exam domain

A multiple-choice exam has no commands to run, so the timed task is a block of questions per domain; the budget below assumes the questions follow the domain weights, which the exam pages do not promise.

{{diagram kcna-review-01.jsx | KCNA time budget by domain · 90 minutes}}

| Domain | Weight | Questions if proportional (of 60) | Budget | Review these cards first |
| --- | --- | --- | --- | --- |
| Kubernetes Fundamentals | 44% | about 26 | 40 min | Groups 1 to 3 (architecture, API machinery, workloads); 7 · Requests, limits and QoS; Taints, tolerations and affinity |
| Container Orchestration | 28% | about 17 | 25 min | Groups 4, 6, 7 and 9: Service, NetworkPolicy, PersistentVolumeClaim, StorageClass, RBAC, Pod Security Admission |
| Cloud Native Application Delivery | 16% | about 10 | 14 min | 11 · Helm and Kustomize; 11 · Logs, events and kubectl debug |
| Cloud Native Architecture | 12% | about 7 | 11 min | 10 · Operators and custom controllers; Group 8 (autoscaling) |

Pacing suggestion: answer every question once at about one minute each (60 minutes), flag the doubtful ones, and keep the last 30 minutes for them.

## Self-check list

Tick an item only when you can explain it aloud without notes; the cards named in the budget table above teach them.

**Kubernetes Fundamentals**

- [ ] Name each control-plane and node component and say what it does (kube-apiserver, etcd, kube-scheduler, kube-controller-manager, kubelet, kube-proxy, container runtime)
- [ ] Explain spec versus status and how a controller reconciles one into the other
- [ ] Pick Deployment, StatefulSet, DaemonSet, Job or CronJob for a described workload
- [ ] Explain requests versus limits, and how taints, tolerations and affinity change where a Pod lands
- [ ] Say what a container image is, what the runtime does, and what CRI stands for

**Container Orchestration**

- [ ] Trace a client request to a Pod through a Service, its EndpointSlices and kube-proxy
- [ ] Tell ClusterIP, NodePort and LoadBalancer apart, and say what Ingress and Gateway API add
- [ ] State what a NetworkPolicy selects and what happens when no policy exists
- [ ] Describe PersistentVolume, PersistentVolumeClaim and StorageClass and the dynamic provisioning path
- [ ] Say how RBAC, ServiceAccounts, Pod Security Admission and securityContext each limit access or privilege
- [ ] Name the first three commands you run on a Pod that will not start

**Cloud Native Application Delivery**

- [ ] Explain Helm (chart, release, values) and Kustomize (base, overlay) and when to use each
- [ ] Use logs, describe and events to explain why a rollout is stuck

**Cloud Native Architecture**

- [ ] Say what the HPA, the VPA and a node autoscaler each scale
- [ ] Say what a CRD and an operator add to Kubernetes
- [ ] Name the three observability signals (metrics, logs, traces) and one CNCF project for each
- [ ] Name the CNCF project maturity levels (sandbox, incubating, graduated) and say what the CNCF is
