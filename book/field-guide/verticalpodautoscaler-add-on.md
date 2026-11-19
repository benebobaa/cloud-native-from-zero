# VerticalPodAutoscaler (add-on)

## What and why

The VerticalPodAutoscaler (VPA) is an add-on that sets container CPU and memory requests from observed use, so Pods are neither starved nor oversized. It installs custom resources and three controllers; Kubernetes does not ship it.

**Acts on it:** the VPA recommender, updater and admission controller (see the diagram). The kubelet only sees the new requests on the replacement Pod.

## Diagram

{{diagram verticalpodautoscaler-add-on-01.jsx | VPA recommend, evict, mutate · 5 steps}}

Three separate components share one VPA object; install all three for automatic resizing.

## Minimal example

Tested on kind v0.33.0 (2 nodes), node image `kindest/node:v1.37.0`, kubectl v1.37.1, metrics-server v0.9.1, VPA 1.8.1 (images `registry.k8s.io/autoscaling/vpa-{recommender,updater,admission-controller}:1.8.1`) installed from the `vertical-pod-autoscaler/deploy` manifests of [kubernetes/autoscaler](https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler) at commit d46c3d7 (2026-11-17). The admission controller needs a TLS Secret that the repository's `gencerts.sh` normally makes; here it was made with `openssl` (CA plus a server certificate for `vpa-webhook.kube-system.svc`) and stored as Secret `vpa-tls-certs`.

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata: {name: hamster}
spec:
  targetRef: {apiVersion: apps/v1, kind: Deployment, name: hamster}
  updatePolicy: {updateMode: "Off"}      # recommend only; later "Initial"
  resourcePolicy:
    containerPolicies:
    - containerName: hamster
      minAllowed: {cpu: 20m, memory: 16Mi}
      maxAllowed: {cpu: 1, memory: 256Mi}
```

The target is a 2-replica Deployment that burns CPU, with `requests: {cpu: 50m, memory: 16Mi}` and `limits: {cpu: 300m, memory: 64Mi}`.

```text
$ kubectl -n vpa-demo get vpa hamster          # about 2.5 minutes after creation
NAME      MODE   CPU    MEM     PROVIDED   AGE
hamster   Off    350m   250Mi   True       2m30s
$ kubectl -n vpa-demo describe vpa hamster | sed -n '/Recommendation/,/Events/p'
  Recommendation:
    Container Recommendations:
      Container Name:  hamster
      Lower Bound:    Cpu: 62m   Memory: 250Mi
      Target:         Cpu: 350m  Memory: 250Mi
      Uncapped Target: Cpu: 350m Memory: 250Mi
      Upper Bound:    Cpu: 1     Memory: 256Mi
$ kubectl -n vpa-demo get pod -l app=hamster -o jsonpath='{.items[0].spec.containers[0].resources}'
{"limits":{"cpu":"300m","memory":"64Mi"},"requests":{"cpu":"50m","memory":"16Mi"}}
```

In `Off` mode nothing changes in the Pods. After `updateMode: Initial` and deleting the two Pods, the replacements were created with the recommended size:

```text
$ kubectl -n vpa-demo get pods -l app=hamster -o custom-columns=NAME:.metadata.name,REQ:.spec.containers[0].resources.requests,LIM:.spec.containers[0].resources.limits
hamster-586db6f46-777kd   map[cpu:350m memory:250Mi]   map[cpu:2100m memory:1000Mi]
hamster-586db6f46-9rpv7   map[cpu:350m memory:250Mi]   map[cpu:2100m memory:1000Mi]
```

The annotation `vpaUpdates: Pod resources updated by hamster: container 0: cpu request, memory request, cpu limit, memory limit` marks a Pod the admission controller changed. The limits grew with the requests: 300m/50m = 6 and 64Mi/16Mi = 4 are kept as ratios (see the third failure below).

## Key fields

Fields, enums and defaults are from `kubectl explain vpa` on the test cluster (CRD installed from the 1.8.1 manifests).

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.targetRef` | The workload whose Pods are sized (`apiVersion`, `kind`, `name`) | required |
| `spec.updatePolicy.updateMode` | `Off`, `Initial`, `Recreate`, `InPlaceOrRecreate`, `InPlace` or `Auto`: what the VPA does with its recommendation | `Recreate` |
| `spec.updatePolicy.minReplicas` | Replicas that must be alive before the updater evicts a Pod; overrides the updater's `--min-replicas` | updater flag |
| `spec.updatePolicy.evictionRequirements` | Extra conditions before an eviction | none |
| `spec.resourcePolicy.containerPolicies[].containerName` | Container the policy applies to; `*` means all | all |
| `...mode` | `Auto` or `Off` for that container | `Auto` |
| `...minAllowed`, `...maxAllowed` | Floor and ceiling for the recommendation, per resource | none |
| `...controlledResources` | Which resources it manages (`cpu`, `memory`) | cpu and memory |
| `...controlledValues` | `RequestsAndLimits` or `RequestsOnly` | `RequestsAndLimits` |
| `status.recommendation.containerRecommendations[]` | `target`, `lowerBound`, `upperBound`, `uncappedTarget` per container | set by the recommender |
| `status.conditions[]` | `RecommendationProvided`, `NoPodsMatched`, `ConfigUnsupported` and others | set by the recommender |

The CRDs are not part of Kubernetes: `verticalpodautoscalers` and `verticalpodautoscalercheckpoints` in group `autoscaling.k8s.io/v1` appear only after the add-on is installed. See the [VPA README](https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler). Three controllers run: the recommender computes values, the updater evicts Pods, the admission controller rewrites new Pods. `InPlaceOrRecreate` and `InPlace` appear in the 1.8.1 enum; they were not run here.

## kubectl

```bash
kubectl api-resources --api-group=autoscaling.k8s.io        # empty until the add-on is installed
kubectl apply -f vpa.yaml
kubectl get vpa -n vpa-demo                                 # MODE, CPU, MEM, PROVIDED
kubectl describe vpa hamster -n vpa-demo                    # Recommendation, Conditions
kubectl get vpa hamster -n vpa-demo -o jsonpath='{.status.recommendation}'
kubectl get vpa hamster -n vpa-demo -o jsonpath='{.status.conditions}'
kubectl explain vpa.spec.updatePolicy.updateMode            # enums and defaults for the installed version
kubectl -n kube-system get pods | grep vpa                  # recommender, updater, admission-controller
kubectl -n kube-system logs deploy/vpa-recommender
kubectl get pod <pod> -o jsonpath='{.metadata.annotations.vpaUpdates}'   # was this Pod resized?
kubectl get mutatingwebhookconfiguration vpa-webhook-config # registered by the admission controller
```

## How it fails

The first two rows were reproduced on the test cluster. The third is behaviour that was observed (the ratios) combined with the project's documented limits.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `vpa-admission-controller` stays `ContainerCreating`; event `MountVolume.SetUp failed for volume "tls-certs" : secret "vpa-tls-certs" not found`; no `vpa-webhook-config` exists, so new Pods are never resized | The admission controller needs its serving certificate in a Secret first | Create `vpa-tls-certs` (keys `caKey.pem`, `caCert.pem`, `serverKey.pem`, `serverCert.pem`) with the repository's `gencerts.sh`; the log then ends `Self registration as MutatingWebhook succeeded.` |
| `kubectl get vpa` shows `PROVIDED False` and no CPU or MEM; conditions `ConfigUnsupported: Cannot read targetRef. Reason: Deployment vpa-demo/ghost does not exist` and `NoPodsMatched: No pods match this VPA object` | `targetRef` names a Deployment that does not exist (or its selector matches no Pods) | Correct `targetRef` (kind, name, apiVersion) and namespace; the VPA must live in the same namespace as its target |
| After `Initial` or `Recreate`, a Pod has `cpu: 2100m` limit while the app asked for 300m; or Pods restart at unexpected times | With `controlledValues: RequestsAndLimits` the VPA keeps the limit-to-request ratio (here 6 and 4); the project says a resize recreates the Pod, and that VPA should not be used with the HPA on the same resource metric | Set `controlledValues: RequestsOnly` if limits are managed by hand; cap with `maxAllowed`; run the HPA on a different metric, or keep VPA in `Off` mode and apply values yourself; keep a PodDisruptionBudget |

See [known limitations](https://github.com/kubernetes/autoscaler/blob/master/vertical-pod-autoscaler/docs/known-limitations.md): a resize recreates the Pod, possibly on another node, and VPA does not update Pods that have no controller.

## Related

- **Cards:** HorizontalPodAutoscaler, Metrics API and metrics-server, Requests, limits and QoS, CustomResourceDefinition.
- **Chapter and lab:** none; card only, add-on.
- **Exam:** not named in the CKA or CKAD v1.37 curriculum PDFs ([cncf/curriculum](https://github.com/cncf/curriculum), 2026-11-17); the CKA line "Configure workload autoscaling" is covered by the HPA card, and whether the exam touches the VPA is not verified; KCNA Cloud Native Architecture.
