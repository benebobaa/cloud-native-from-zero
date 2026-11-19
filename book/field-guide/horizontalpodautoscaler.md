# HorizontalPodAutoscaler

## What and why

The HorizontalPodAutoscaler (HPA) changes the replica count of a workload to match load. A fixed Pod count is too small at peak and wasteful at night, and nobody wants to resize by hand.

**Acts on it:** the HPA controller inside kube-controller-manager reads the Metrics API on a timer and writes the target's `scale` subresource. The Deployment or StatefulSet controller then adds or removes Pods.

## Diagram

{{diagram horizontalpodautoscaler-01.jsx | HPA control loop · 5 steps}}

The HPA never touches Pods; it only writes the replica count and lets the Deployment do the rest.

## Minimal example

Tested on kind v0.33.0 (2 nodes), node image `kindest/node:v1.37.0`, kubectl v1.37.1, metrics-server v0.9.1 started with `--kubelet-insecure-tls` (2026-11-17). The Deployment burns CPU in a loop, capped at 200m, so each Pod runs at 200% of its 100m request.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: {name: burn}
spec:
  replicas: 1
  selector: {matchLabels: {app: burn}}
  template:
    metadata: {labels: {app: burn}}
    spec:
      containers:
      - name: burn
        image: alpine:3.21
        command: ["sh","-c","while true; do :; done"]
        resources:
          requests: {cpu: 100m, memory: 16Mi}
          limits: {cpu: 200m, memory: 32Mi}
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: {name: burn}
spec:
  scaleTargetRef: {apiVersion: apps/v1, kind: Deployment, name: burn}
  minReplicas: 1
  maxReplicas: 4
  metrics:
  - type: Resource
    resource: {name: cpu, target: {type: Utilization, averageUtilization: 50}}
  behavior:
    scaleDown: {stabilizationWindowSeconds: 30}
```

```text
$ kubectl -n hpa-demo get hpa burn
NAME   REFERENCE         TARGETS         MINPODS   MAXPODS   REPLICAS   AGE
burn   Deployment/burn   cpu: 200%/50%   1         4         4          3m40s
$ kubectl -n hpa-demo get events --field-selector involvedObject.kind=HorizontalPodAutoscaler | tail -1
2m44s   Normal   SuccessfulRescale   horizontalpodautoscaler/burn   New size: 4; reason: cpu resource utilization (percentage of request) above target
```

The HPA went from 1 to 4 Pods in one step because the default scale-up policy allows doubling or +4 Pods per 15 s. After the load was replaced by `sleep` the table showed `cpu: 0%/50%` with 4 replicas, then 1 replica about 40 s later (the 30 s window set above; the default is 300 s).

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.scaleTargetRef` | The object to scale (`apiVersion`, `kind`, `name`); it must have a `scale` subresource | required |
| `spec.minReplicas` | Lowest replica count the HPA sets | 1 |
| `spec.maxReplicas` | Highest replica count the HPA sets; not less than `minReplicas` | required |
| `spec.metrics[].type` | `Resource`, `ContainerResource`, `Pods`, `Object` or `External` | required per metric |
| `spec.metrics[].resource.target.type` | `Utilization` (percent of the request), `AverageValue` or `Value` | required |
| `spec.metrics[].resource.target.averageUtilization` | Target average use as a percentage of the Pods' requests; only valid for `Resource` metrics | none |
| `spec.behavior.scaleUp.stabilizationWindowSeconds` | Seconds of past recommendations considered before scaling up (0 to 3600) | 0 |
| `spec.behavior.scaleDown.stabilizationWindowSeconds` | Seconds of past recommendations considered before scaling down | 300 |
| `spec.behavior.*.policies[]` | Speed limits: `type` (`Pods` or `Percent`), `value`, `periodSeconds` | up: double or +4 Pods per 15 s; down: all Pods per 15 s |
| `spec.behavior.*.tolerance` | Ratio change ignored before scaling (0.1 = 10%) | cluster-wide, 10% |
| `status.currentMetrics`, `status.desiredReplicas`, `status.conditions` | What the controller measured, wants, and why it can or cannot scale | set by the controller |

Fields and defaults are from the Kubernetes v1.37.0 OpenAPI spec ([source](https://github.com/kubernetes/kubernetes/tree/v1.37.0/api/openapi-spec/v3)); several metrics are allowed and the largest replica count wins.

## kubectl

```
kubectl autoscale deployment web --min=1 --max=5 --cpu=50%      # imperative; 50% = utilization of the request
kubectl autoscale deployment web --max=5 --cpu=500m              # a quantity (or a bare number) = average value, not percent
kubectl apply -f hpa.yaml                                        # autoscaling/v2 with behavior
kubectl get hpa web                                              # TARGETS current/target, REPLICAS
kubectl get hpa web -w                                           # watch it react to load
kubectl describe hpa web                                         # metrics, Conditions (AbleToScale, ScalingActive, ScalingLimited), Events
kubectl get hpa web -o jsonpath='{.status.conditions}'
kubectl top pods -n hpa-demo                                     # the same numbers the HPA reads
kubectl get events -n hpa-demo --field-selector involvedObject.kind=HorizontalPodAutoscaler
kubectl delete hpa web                                           # replicas stay where the HPA left them
```

## How it fails

All three were reproduced on the test cluster; the first two share the symptom `<unknown>` but have different causes.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `TARGETS cpu: <unknown>/50%`; condition `ScalingActive False FailedGetResourceMetric`: `unable to fetch metrics from resource metrics API: the server could not find the requested resource (get pods.metrics.k8s.io)`; `kubectl top nodes` says `error: Metrics API not available` | No metrics-server, so nothing serves `metrics.k8s.io` | Install metrics-server; check `kubectl get apiservice v1beta1.metrics.k8s.io` shows `True` |
| `TARGETS cpu: <unknown>/50%`; `failed to get cpu utilization: missing request for cpu in container alpine of Pod norequest-858886b59c-rqr7s` | Utilization is a percentage of the Pod's CPU request; this container has none | Add `resources.requests.cpu` to every container of the Pod, or use `type: AverageValue` |
| `TARGETS cpu: 200%/50%` but `REPLICAS` stays at 4; `ScalingLimited True TooManyReplicas: the desired replica count is more than the maximum replica count` | The HPA wants more Pods than `maxReplicas`; it is working, just capped (after the load ends the same condition reads `TooFewReplicas` at `minReplicas`) | Raise `maxReplicas`, lower per-Pod load, or accept the cap; check node capacity too |

If you delete the HPA, the Deployment keeps the last replica count; a `replicas:` field in the applied manifest fights the HPA on every `kubectl apply`, so leave it out once an HPA owns the count.

## Related

- **Cards:** Metrics API and metrics-server (the data source), Deployment and StatefulSet (the targets, group 3), Requests, limits and QoS (utilization is relative to requests), VerticalPodAutoscaler (add-on), Cluster Autoscaler and Karpenter (add-on).
- **Chapter and lab:** 7.3.
- **Exam:** CKA Workloads and Scheduling (15%): configure workload autoscaling.
