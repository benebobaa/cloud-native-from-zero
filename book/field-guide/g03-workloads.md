# 3 · Workloads

## How the workload cards fit together

{{diagram g03-workloads-01.jsx | Choosing a workload resource · 5 needs, 5 resources}}
Pick the row that matches what the Pods must do; every resource on the right edge ends in Pods, which the kubelet runs. This is the CKAD "choose a workload resource" decision.

| Card | Teaches | Chapter | Exam domain |
| --- | --- | --- | --- |
| Pod | The unit of scheduling and execution | 5.2 | KCNA Kubernetes Fundamentals |
| Pod lifecycle and probes | Phases, restarts, health checks | 5.2 | CKA Workloads and Scheduling: self-healing primitives; CKAD Application Observability and Maintenance: probes and health checks |
| Init and sidecar containers | Start-up order and helper containers | 5.2 | CKAD Application Design and Build: multi-container Pod patterns |
| ReplicaSet | Keeping N replicas running | 5.2 | KCNA Kubernetes Fundamentals |
| Deployment | Rolling updates, rollback, canary and blue/green | 5.2 | CKA Workloads and Scheduling: rolling updates and rollbacks, self-healing; CKAD Application Deployment: rolling updates, blue/green and canary |
| StatefulSet | Stable identity and per-Pod storage | 5.2 | KCNA Kubernetes Fundamentals |
| DaemonSet | One Pod per node | 5.2 | KCNA Kubernetes Fundamentals |
| Job; CronJob | Run-to-completion and scheduled work | 5.2 | KCNA Kubernetes Fundamentals |
| ControllerRevision and PodTemplate | History records and stored templates | 5.2 | KCNA Kubernetes Fundamentals |
| ReplicationController (legacy) | The original replica controller | 5.2 | KCNA Kubernetes Fundamentals |

Choosing the right workload resource is itself a CKAD competency (Application Design and Build).
