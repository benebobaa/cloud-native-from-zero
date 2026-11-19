# Cloud Native from Zero · Kubernetes Field Guide

This guide gives every built-in Kubernetes 1.37 object, component and API mechanism its own card; the coverage matrix proves nothing is missing.

## How to use this guide

Use the chapters to learn Kubernetes in order; use this guide to look up one object, component or mechanism and see everything about it on one page.

The guide has 12 groups and one card per topic. Every card has the same seven parts:

1. **What and why**: what it is, the problem it solves, and which controller or component acts on it.
2. **Diagram**: its lifecycle, or how it relates to other objects.
3. **Minimal example**: YAML or commands, tested on kind with Kubernetes 1.37.0.
4. **Key fields**: field, meaning, default.
5. **kubectl**: commands to create, inspect and debug it.
6. **How it fails**: three common failures, each with symptom, cause and fix.
7. **Related**: other cards, the chapter and lab that teach it, and the exam domain.

**When cards are written.** Each card is written together with the chapter that teaches it, using the same tested YAML, so the two never disagree. A card that still shows grey placeholders is not written yet.

**Exam use.** Group 12 holds timed drills for the CKA and CKAD and a review for the KCNA. Practise them after week 28.

## Coverage matrix

All 71 API resources on a default Kubernetes 1.37 cluster have a card; 61 are also taught in a chapter, and 10 newer or advanced ones are card-only self-study.

**Source.** `kubectl api-resources` on a kind cluster running `kindest/node:v1.37.0`, captured 2026-11-16 (saved as [`data/k8s-1.37-api-resources.txt`](https://github.com/benebobaa/cloud-native-from-zero/blob/main/data/k8s-1.37-api-resources.txt) in the book repo). Components and API mechanisms have one card each in groups 1 and 2, so they are not repeated here. Exam competencies are mapped in the next table.

### API resources

| # | Kind | API group/version | Namespaced | Card | Chapter |
| --- | --- | --- | --- | --- | --- |
| 1 | APIService | `apiregistration.k8s.io/v1` | no | 10 · APIService and aggregation | 7.3 |
| 2 | Binding | `v1` | yes | 1 · kube-scheduler | 5.4 |
| 3 | CertificateSigningRequest | `certificates.k8s.io/v1` | no | 9 · Certificates and trust bundles | 5.5 |
| 4 | ClusterRoleBinding | `rbac.authorization.k8s.io/v1` | no | 9 · RBAC | 5.5 |
| 5 | ClusterRole | `rbac.authorization.k8s.io/v1` | no | 9 · RBAC | 5.5 |
| 6 | ClusterTrustBundle | `certificates.k8s.io/v1` | no | 9 · Certificates and trust bundles | card only |
| 7 | ComponentStatus | `v1` | no | 11 · Troubleshooting playbook (deprecated API) | 5.5 |
| 8 | ConfigMap | `v1` | yes | 5 · ConfigMap | 5.3 |
| 9 | ControllerRevision | `apps/v1` | yes | 3 · ControllerRevision and PodTemplate | 5.2 |
| 10 | CronJob | `batch/v1` | yes | 3 · CronJob | 5.2 |
| 11 | CSIDriver | `storage.k8s.io/v1` | no | 6 · CSIDriver, CSINode and CSIStorageCapacity | 5.4 |
| 12 | CSINode | `storage.k8s.io/v1` | no | 6 · CSIDriver, CSINode and CSIStorageCapacity | 5.4 |
| 13 | CSIStorageCapacity | `storage.k8s.io/v1` | yes | 6 · CSIDriver, CSINode and CSIStorageCapacity | 5.4 |
| 14 | CustomResourceDefinition | `apiextensions.k8s.io/v1` | no | 10 · CustomResourceDefinition | 7.3 |
| 15 | DaemonSet | `apps/v1` | yes | 3 · DaemonSet | 5.2 |
| 16 | Deployment | `apps/v1` | yes | 3 · Deployment | 5.2 |
| 17 | DeviceClass | `resource.k8s.io/v1` | no | 7 · Dynamic Resource Allocation | card only |
| 18 | DeviceTaintRule | `resource.k8s.io/v1` | no | 7 · Dynamic Resource Allocation | card only |
| 19 | Endpoints | `v1` | yes | 4 · Endpoints (deprecated) | 5.3 |
| 20 | EndpointSlice | `discovery.k8s.io/v1` | yes | 4 · EndpointSlice | 5.3 |
| 21 | Event | `v1` | yes | 2 · Event | 5.1 |
| 22 | Event | `events.k8s.io/v1` | yes | 2 · Event | 5.1 |
| 23 | FlowSchema | `flowcontrol.apiserver.k8s.io/v1` | no | 2 · API Priority and Fairness | card only |
| 24 | HorizontalPodAutoscaler | `autoscaling/v2` | yes | 8 · HorizontalPodAutoscaler | 7.3 |
| 25 | IngressClass | `networking.k8s.io/v1` | no | 4 · Ingress and IngressClass | 6.2 |
| 26 | Ingress | `networking.k8s.io/v1` | yes | 4 · Ingress and IngressClass | 6.2 |
| 27 | IPAddress | `networking.k8s.io/v1` | no | 4 · ServiceCIDR and IPAddress | 5.3 |
| 28 | Job | `batch/v1` | yes | 3 · Job | 5.2 |
| 29 | Lease | `coordination.k8s.io/v1` | yes | 2 · Lease | 5.1 |
| 30 | LimitRange | `v1` | yes | 7 · LimitRange | 5.4 |
| 31 | LocalSubjectAccessReview | `authorization.k8s.io/v1` | yes | 9 · Access reviews | 5.5 |
| 32 | MutatingAdmissionPolicy | `admissionregistration.k8s.io/v1` | no | 9 · MutatingAdmissionPolicy | 6.3 |
| 33 | MutatingAdmissionPolicyBinding | `admissionregistration.k8s.io/v1` | no | 9 · MutatingAdmissionPolicy | 6.3 |
| 34 | MutatingWebhookConfiguration | `admissionregistration.k8s.io/v1` | no | 9 · Admission webhooks | 6.3 |
| 35 | Namespace | `v1` | no | 2 · Namespace | 5.1 |
| 36 | NetworkPolicy | `networking.k8s.io/v1` | yes | 4 · NetworkPolicy | 6.1 |
| 37 | Node | `v1` | no | 7 · Node | 5.1 |
| 38 | PersistentVolumeClaim | `v1` | yes | 6 · PersistentVolumeClaim | 5.4 |
| 39 | PersistentVolume | `v1` | no | 6 · PersistentVolume | 5.4 |
| 40 | PodCertificateRequest | `certificates.k8s.io/v1` | yes | 9 · Certificates and trust bundles | card only |
| 41 | PodDisruptionBudget | `policy/v1` | yes | 7 · PodDisruptionBudget | 5.5 |
| 42 | Pod | `v1` | yes | 3 · Pod | 5.2 |
| 43 | PodTemplate | `v1` | yes | 3 · ControllerRevision and PodTemplate | 5.2 |
| 44 | PriorityClass | `scheduling.k8s.io/v1` | no | 7 · PriorityClass and preemption | 5.4 |
| 45 | PriorityLevelConfiguration | `flowcontrol.apiserver.k8s.io/v1` | no | 2 · API Priority and Fairness | card only |
| 46 | ReplicaSet | `apps/v1` | yes | 3 · ReplicaSet | 5.2 |
| 47 | ReplicationController | `v1` | yes | 3 · ReplicationController (legacy) | 5.2 |
| 48 | ResourceClaim | `resource.k8s.io/v1` | yes | 7 · Dynamic Resource Allocation | card only |
| 49 | ResourceClaimTemplate | `resource.k8s.io/v1` | yes | 7 · Dynamic Resource Allocation | card only |
| 50 | ResourceQuota | `v1` | yes | 7 · ResourceQuota | 5.4 |
| 51 | ResourceSlice | `resource.k8s.io/v1` | no | 7 · Dynamic Resource Allocation | card only |
| 52 | RoleBinding | `rbac.authorization.k8s.io/v1` | yes | 9 · RBAC | 5.5 |
| 53 | Role | `rbac.authorization.k8s.io/v1` | yes | 9 · RBAC | 5.5 |
| 54 | RuntimeClass | `node.k8s.io/v1` | no | 7 · RuntimeClass | 4.2, 5.4 |
| 55 | Secret | `v1` | yes | 5 · Secret | 5.3 |
| 56 | SelfSubjectAccessReview | `authorization.k8s.io/v1` | no | 9 · Access reviews | 5.5 |
| 57 | SelfSubjectReview | `authentication.k8s.io/v1` | no | 9 · Authentication | 5.5 |
| 58 | SelfSubjectRulesReview | `authorization.k8s.io/v1` | no | 9 · Access reviews | 5.5 |
| 59 | ServiceAccount | `v1` | yes | 9 · ServiceAccount | 5.5 |
| 60 | ServiceCIDR | `networking.k8s.io/v1` | no | 4 · ServiceCIDR and IPAddress | 5.3 |
| 61 | Service | `v1` | yes | 4 · Service | 5.3 |
| 62 | StatefulSet | `apps/v1` | yes | 3 · StatefulSet | 5.2 |
| 63 | StorageClass | `storage.k8s.io/v1` | no | 6 · StorageClass | 5.4 |
| 64 | StorageVersionMigration | `storagemigration.k8s.io/v1` | no | 11 · StorageVersionMigration | card only |
| 65 | SubjectAccessReview | `authorization.k8s.io/v1` | no | 9 · Access reviews | 5.5 |
| 66 | TokenReview | `authentication.k8s.io/v1` | no | 9 · Authentication | 5.5 |
| 67 | ValidatingAdmissionPolicy | `admissionregistration.k8s.io/v1` | no | 9 · ValidatingAdmissionPolicy | 6.3 |
| 68 | ValidatingAdmissionPolicyBinding | `admissionregistration.k8s.io/v1` | no | 9 · ValidatingAdmissionPolicy | 6.3 |
| 69 | ValidatingWebhookConfiguration | `admissionregistration.k8s.io/v1` | no | 9 · Admission webhooks | 6.3 |
| 70 | VolumeAttachment | `storage.k8s.io/v1` | no | 6 · VolumeAttachment | 5.4 |
| 71 | VolumeAttributesClass | `storage.k8s.io/v1` | no | 6 · VolumeAttributesClass | 5.4 |

### Exam competencies

Every competency in the CKA v1.37 and CKAD v1.37 curricula, and every KCNA domain, maps to at least one card and one chapter ([CNCF curriculum](https://github.com/cncf/curriculum), checked 2026-11-16). Weights are the exam's own.

| Exam | Domain (weight) | Competency | Cards | Chapter |
| --- | --- | --- | --- | --- |
| CKA | Storage (10%) | Storage classes and dynamic provisioning | 6 · StorageClass | 5.4 |
| CKA | Storage (10%) | Volume types, access modes, reclaim policies | 6 · Volume types; PersistentVolume | 5.4 |
| CKA | Storage (10%) | Persistent volumes and claims | 6 · PersistentVolume; PersistentVolumeClaim | 5.4 |
| CKA | Troubleshooting (30%) | Clusters and nodes | 11 · Troubleshooting playbook; 7 · Node | 5.5 |
| CKA | Troubleshooting (30%) | Cluster components | Group 1 cards | 5.1, 5.5 |
| CKA | Troubleshooting (30%) | Monitor resource usage | 8 · Metrics API and metrics-server | 7.2 |
| CKA | Troubleshooting (30%) | Container output streams | 11 · Logs, events and kubectl debug | 5.2 |
| CKA | Troubleshooting (30%) | Services and networking | 4 · Service; DNS for Services and Pods | 5.3, 6.1 |
| CKA | Workloads and Scheduling (15%) | Rolling updates and rollbacks | 3 · Deployment | 5.2 |
| CKA | Workloads and Scheduling (15%) | ConfigMaps and Secrets | 5 · ConfigMap; Secret | 5.3 |
| CKA | Workloads and Scheduling (15%) | Workload autoscaling | 8 · HorizontalPodAutoscaler | 7.3 |
| CKA | Workloads and Scheduling (15%) | Self-healing primitives | 3 · Deployment; Pod lifecycle and probes | 5.2 |
| CKA | Workloads and Scheduling (15%) | Pod admission and scheduling | 7 · Requests, limits and QoS; Taints, tolerations and affinity | 5.4 |
| CKA | Cluster Architecture, Installation and Configuration (25%) | RBAC | 9 · RBAC | 5.5 |
| CKA | Cluster Architecture, Installation and Configuration (25%) | Prepare infrastructure; kubeadm | 1 · kubeadm and cluster bootstrap | 5.5 |
| CKA | Cluster Architecture, Installation and Configuration (25%) | Cluster lifecycle | 11 · Upgrades and version skew; etcd backup and restore | 5.5 |
| CKA | Cluster Architecture, Installation and Configuration (25%) | Highly available control plane | 1 · kubeadm and cluster bootstrap; etcd | 3.2, 5.5 |
| CKA | Cluster Architecture, Installation and Configuration (25%) | Helm and Kustomize | 11 · Helm and Kustomize | 7.1 |
| CKA | Cluster Architecture, Installation and Configuration (25%) | Extension interfaces (CNI, CSI, CRI) | 1 · Container runtime (CRI); CNI and CSI plug-ins | 4.2, 5.4, 6.1 |
| CKA | Cluster Architecture, Installation and Configuration (25%) | CRDs and operators | 10 · CustomResourceDefinition; Operators and custom controllers | 7.3 |
| CKA | Services and Networking (20%) | Pod connectivity | 1 · CNI and CSI plug-ins | 2.5, 6.1 |
| CKA | Services and Networking (20%) | Network policies | 4 · NetworkPolicy | 6.1 |
| CKA | Services and Networking (20%) | ClusterIP, NodePort, LoadBalancer, endpoints | 4 · Service; EndpointSlice | 5.3 |
| CKA | Services and Networking (20%) | Gateway API | 4 · Gateway API | 6.2 |
| CKA | Services and Networking (20%) | Ingress controllers and resources | 4 · Ingress and IngressClass | 6.2 |
| CKA | Services and Networking (20%) | CoreDNS | 1 · CoreDNS and cluster add-ons; 4 · DNS for Services and Pods | 5.3 |
| CKAD | Application Design and Build (20%) | Container images | — (not a Kubernetes object) | 4.1 |
| CKAD | Application Design and Build (20%) | Choose a workload resource | Group 3 overview | 5.2 |
| CKAD | Application Design and Build (20%) | Multi-container Pod patterns | 3 · Init and sidecar containers | 5.2 |
| CKAD | Application Design and Build (20%) | Persistent and ephemeral volumes | 6 · Volume types; PersistentVolumeClaim | 5.4 |
| CKAD | Application Deployment (20%) | Blue/green and canary deployments | 3 · Deployment | 5.2, 7.1 |
| CKAD | Application Deployment (20%) | Rolling updates | 3 · Deployment | 5.2 |
| CKAD | Application Deployment (20%) | Helm; Kustomize | 11 · Helm and Kustomize | 7.1 |
| CKAD | Application Observability and Maintenance (15%) | API deprecations | 2 · API groups, versions and deprecation | 5.1 |
| CKAD | Application Observability and Maintenance (15%) | Probes and health checks | 3 · Pod lifecycle and probes | 5.2 |
| CKAD | Application Observability and Maintenance (15%) | Built-in CLI monitoring | 8 · Metrics API and metrics-server | 7.2 |
| CKAD | Application Observability and Maintenance (15%) | Container logs; debugging | 11 · Logs, events and kubectl debug | 5.2, 5.5 |
| CKAD | Application Environment, Configuration and Security (25%) | CRDs and operators | 10 · CustomResourceDefinition; Operators and custom controllers | 7.3 |
| CKAD | Application Environment, Configuration and Security (25%) | Authentication, authorization, admission | 9 · Authentication; RBAC; Admission webhooks | 5.5, 6.3 |
| CKAD | Application Environment, Configuration and Security (25%) | Requests, limits, quotas | 7 · Requests, limits and QoS; ResourceQuota; LimitRange | 5.4 |
| CKAD | Application Environment, Configuration and Security (25%) | ConfigMaps; Secrets | 5 · ConfigMap; Secret | 5.3 |
| CKAD | Application Environment, Configuration and Security (25%) | ServiceAccounts | 9 · ServiceAccount | 5.5 |
| CKAD | Application Environment, Configuration and Security (25%) | SecurityContexts and capabilities | 9 · SecurityContext and capabilities | 1.5, 6.3 |
| CKAD | Services and Networking (20%) | NetworkPolicies | 4 · NetworkPolicy | 6.1 |
| CKAD | Services and Networking (20%) | Services | 4 · Service | 5.3 |
| CKAD | Services and Networking (20%) | Ingress | 4 · Ingress and IngressClass | 6.2 |
| KCNA | Kubernetes Fundamentals (44%) | Whole domain | Groups 1–3 | Vol 5 |
| KCNA | Container Orchestration (28%) | Whole domain | Groups 4, 6, 7, 9 | Vol 4–6 |
| KCNA | Cloud Native Application Delivery (16%) | Whole domain | 11 · Helm and Kustomize | 7.1 |
| KCNA | Cloud Native Architecture (12%) | Whole domain | 10 · Operators and custom controllers; 8 · Autoscaling | 0.1, 3.3, 7.3 |

The CKA and CKAD bullet-to-domain grouping was read from the curriculum PDFs' layout; check against the PDFs before an exam.

### Other topics covered

These topics are not rows in the tables above, because they are not API resources by themselves. Each has a card or a section of a card.

| Topic | Card (group) | Chapter and lab |
| --- | --- | --- |
| Gateway API (the Gateway, GatewayClass and HTTPRoute CRDs, installed separately from Kubernetes) | Gateway API (4 · Service networking) | Ch 6.2 and Lab 6.2 |
| Downward API and projected volumes | Downward API and projected volumes (5 · Configuration) | Not a separate row; closest is Ch 5.3 and Lab 5.3 |
| Topology spread constraints (a Pod spec field, not a resource) | Topology spread constraints (7 · Scheduling and capacity) | Not a separate row; the scheduling chapter is Ch 5.4 |
| VolumeSnapshot (add-on: the CRDs and snapshot controller are installed separately) | VolumeSnapshot (add-on) (6 · Storage) | None in the coverage matrix |
| PodDisruptionBudget lab (drain blocked by a budget, then unblocked) | PodDisruptionBudget (7 · Scheduling and capacity) | Ch 5.5 and Lab 5.5 |

## Not covered on purpose

These APIs exist in Kubernetes 1.37 but are not served on a default cluster (they are absent from the `kubectl api-resources` capture above), so they get one line here instead of a card. Stability comes from the [feature gates reference](https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/), checked 2026-11-16.

| Kind | API group/version | Stability | What it is for |
| --- | --- | --- | --- |
| Workload, PodGroup | `scheduling.k8s.io/v1beta1` | Beta, off by default (`GenericWorkload`) | Gang scheduling: start a group of Pods together or not at all |
| CompositePodGroup | `scheduling.k8s.io/v1alpha3` | Alpha, off | A group of Pod groups |
| LeaseCandidate | `coordination.k8s.io/v1beta1` | Beta, off (`CoordinatedLeaderElection`) | Coordinated leader election across control-plane versions |
| ResourcePoolStatusRequest | `resource.k8s.io/v1alpha3` | Alpha, off (`DRAResourcePoolStatus`) | One-off query of device pool status |
| StorageVersion | `internal.apiserver.k8s.io/v1alpha1` | Alpha, off (`StorageVersionAPI`) | Tracks which version each API server stores |
| EvictionRequest | `lifecycle.k8s.io/v1alpha1` | Alpha, off (gate name not yet verified) | Coordinated, graceful Pod eviction |

If one of these becomes stable in a later release, it gets a card and a row in the coverage matrix.
