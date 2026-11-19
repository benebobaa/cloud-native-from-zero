# 8 · Autoscaling

Autoscaling adds capacity at three levels: the number of Pods (HPA), the size of each Pod (VPA) and the number of nodes (Cluster Autoscaler or Karpenter), all driven by the Metrics API or by Pending Pods.

{{diagram g08-autoscaling-01.jsx | Autoscaling levels · Pods, Pod size, nodes}}

Read it left to right: metrics in, Pod changes in the middle, node changes at the end.

| Card | Scales | Ships with Kubernetes | Chapter | Exam |
| --- | --- | --- | --- | --- |
| Metrics API and metrics-server | Supplies the numbers | The API group is built in; the server is an add-on | 7.2 | CKA Troubleshooting (monitor resource usage); CKAD Observability (built-in CLI monitoring) |
| HorizontalPodAutoscaler | Pod count | Yes (autoscaling/v2) | 7.3 | CKA Workloads and Scheduling (workload autoscaling) |
| VerticalPodAutoscaler (add-on) | Requests per Pod | No (CRDs and three controllers) | card only | KCNA Cloud Native Architecture |
| Cluster Autoscaler and Karpenter (add-on) | Node count | No (cloud-specific) | card only | KCNA Cloud Native Architecture |
