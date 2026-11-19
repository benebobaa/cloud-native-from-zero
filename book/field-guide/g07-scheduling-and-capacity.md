# 7 · Scheduling and capacity

## How the cards fit together

{{diagram g07-scheduling-and-capacity-01.jsx | group 7 · from admission to a running Pod}}

Admission objects shape the Pod first, scheduling objects choose its Node, and a PodDisruptionBudget guards it afterward.

## Cards and where they are taught

| Card | Covers | Chapter | Exam domain |
| --- | --- | --- | --- |
| Node | conditions, capacity, Lease, cordon | Ch 5.1 | CKA: Troubleshooting (30%), clusters and nodes |
| Requests, limits and QoS | fit, enforcement, eviction order | Ch 5.4 | CKA: Workloads and Scheduling (15%); CKAD: Application Environment (25%) |
| ResourceQuota | namespace totals | Ch 5.4 | CKAD: requests, limits, quotas |
| LimitRange | per-container defaults, min and max | Ch 5.4 | CKAD: requests, limits, quotas |
| PriorityClass and preemption | queue order, evicting lower priority | Ch 5.4 | CKA: Workloads and Scheduling |
| Taints, tolerations and affinity | where a Pod may or must run | Ch 5.4 | CKA: Workloads and Scheduling, Pod admission and scheduling |
| Topology spread constraints | even spread across zones or nodes | not a separate matrix row; closest is Ch 5.4 | CKA: Workloads and Scheduling |
| PodDisruptionBudget | limit voluntary evictions | Ch 5.5 | CKA: Workloads and Scheduling |
| RuntimeClass | choose a container runtime handler | Ch 4.2, Ch 5.4 | not named in the CKA or CKAD curriculum |
| Dynamic Resource Allocation | devices such as GPUs (DeviceClass, ResourceClaim, ResourceSlice, DeviceTaintRule) | card only (self-study) | not named in the CKA or CKAD curriculum |

All ten also belong to the KCNA domain Container Orchestration (28%). Chapter numbers come from the coverage matrix on the How to use tab.
