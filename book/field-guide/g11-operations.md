# 11 · Operations

Operations is the part of Kubernetes you do after the cluster exists: reach it, back it up, change it safely, and find out why it broke.

{{diagram g11-operations-01.jsx | Day-2 operations · 7 cards}}

Read the top row left to right, then the second row right to left.

| Card | Job | Chapter | Exam |
| --- | --- | --- | --- |
| kubeconfig and contexts | Choose cluster and user | 5.5 | CKA and CKAD (every task starts with the right context) |
| Upgrades and version skew | Move to a new minor version | 5.5 | CKA Cluster Architecture (cluster lifecycle) |
| etcd backup and restore | Save and recover cluster state | 5.5 | CKA Cluster Architecture (cluster lifecycle) |
| Node maintenance and eviction | Take a node out of service | 5.5 | CKA Troubleshooting (clusters and nodes) |
| Logs, events and kubectl debug | See what a workload did | 5.2, 5.5 | CKA Troubleshooting (container output); CKAD Observability (logs, debugging) |
| StorageVersionMigration | Rewrite stored objects at the current version | card only | No curriculum line |
| Troubleshooting playbook | Find the failing layer | 5.5 | CKA Troubleshooting (30%) |
| Helm and Kustomize | Install and change workloads | 7.1 | CKA Cluster Architecture; CKAD Application Deployment; KCNA Cloud Native Application Delivery |
