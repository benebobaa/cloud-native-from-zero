# Dynamic Resource Allocation

## What and why

Dynamic Resource Allocation (DRA) lets Pods ask for devices such as GPUs the way volumes ask for storage: through claims and classes instead of a fixed count. It is stable since Kubernetes v1.35; the API group is `resource.k8s.io/v1`. This card covers five kinds:

- `ResourceSlice`: the devices a DRA driver offers on a node or pool.
- `DeviceClass`: an admin-defined category, with CEL selectors.
- `ResourceClaim`: a request for devices; `ResourceClaimTemplate` makes one per Pod.
- `DeviceTaintRule`: an admin taint on selected devices, for example for maintenance.

The **kube-scheduler** matches claims to slices and records the choice in the claim's `status.allocation`. The **kubelet** then asks the node's DRA driver to prepare the device before the container starts.

## Diagram

{{diagram dynamic-resource-allocation-01.jsx | Dynamic Resource Allocation · 8 boxes}}

Drivers publish devices, admins define classes, users claim devices, and the scheduler records the match in the claim.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). `resource.k8s.io/v1` is served by default. **No DRA driver runs on this cluster**, so the driver's jobs were not run: I wrote a ResourceSlice by hand to stand in for what a driver publishes, and nothing prepared a device. What did run is the API and the **scheduler's allocation**.

```yaml
apiVersion: resource.k8s.io/v1
kind: DeviceClass
metadata: {name: example-gpu}
spec:
  selectors: [{cel: {expression: 'device.driver == "gpu.example.com"'}}]
---
apiVersion: resource.k8s.io/v1
kind: ResourceSlice            # normally written by the driver
metadata: {name: worker-gpu.example.com}
spec:
  driver: gpu.example.com
  nodeName: cnlab-worker
  pool: {name: cnlab-worker, generation: 1, resourceSliceCount: 1}
  devices:
  - name: gpu-0
    attributes: {model: {string: m1}}
    capacity: {memory: {value: 8Gi}}
---
apiVersion: resource.k8s.io/v1
kind: ResourceClaim
metadata: {name: gpu-claim}
spec:
  devices:
    requests:
    - name: gpu
      exactly: {deviceClassName: example-gpu, count: 1}
---
apiVersion: v1
kind: Pod
metadata: {name: dra-demo}
spec:
  resourceClaims: [{name: gpu, resourceClaimName: gpu-claim}]
  containers:
  - name: c
    image: alpine:3.21
    command: [sleep, "3600"]
    resources: {claims: [{name: gpu}]}
```

The scheduler matched the claim to `gpu-0` and recorded it; the kubelet then found no driver:

```
$ kubectl get resourceclaim
NAME        STATE                AGE
gpu-claim   allocated,reserved   11s
$ kubectl get resourceclaim gpu-claim -o jsonpath='{.status}'
{"allocation":{"devices":{"results":[{"device":"gpu-0","driver":"gpu.example.com","pool":"cnlab-worker","request":"gpu"}]}, ...},"reservedFor":[{"name":"dra-demo","resource":"pods", ...}]}
$ kubectl get pod dra-demo
NAME       READY   STATUS              RESTARTS   AGE
dra-demo   0/1     ContainerCreating   0          11s
```

A `ResourceClaimTemplate` (same `spec.spec.devices` block) and a `DeviceTaintRule` were created too and accepted:

```
$ kubectl get devicetaintrule
NAME                KEY                       VALUE   EFFECT       TIMEADDED   AGE
gpu-0-maintenance   example.com/maintenance   true    NoSchedule   1s          1s
```

## Key fields

Checked with `kubectl explain` on 1.37.

| Kind and field | Meaning | Default |
| --- | --- | --- |
| DeviceClass `spec.selectors[].cel.expression` | CEL that a device must satisfy to belong to the class | required to be useful |
| ResourceClaim `spec.devices.requests[]` | one request: a `name`, and `exactly` (or `firstAvailable` alternatives) | one of the two is required |
| `exactly.deviceClassName`, `selectors` | which class, plus extra CEL filters | class required |
| `exactly.allocationMode`, `count` | `ExactCount` with a number, or `All` matching devices in a pool | `ExactCount`, count `1` |
| ResourceClaim `spec.devices.constraints[]` | rules across devices, such as `distinctAttribute` | none |
| ResourceClaimTemplate `spec.spec` | the claim spec copied into a new claim for each Pod; immutable | n/a |
| ResourceSlice `spec.driver`, `pool`, `devices[]` | the driver, a pool (`name`, `generation`, `resourceSliceCount`) and the devices with `attributes` and `capacity` | required |
| ResourceSlice location | exactly one of `nodeName` (immutable), `nodeSelector`, `allNodes`, `perDeviceNodeSelection` | required |
| DeviceTaintRule `spec.deviceSelector`, `taint` | which devices (`driver`, `pool`, `device`), and a taint with `key`, `value`, `effect` of `NoSchedule`, `NoExecute` or `None` | an empty selector matches all devices |
| Pod `spec.resourceClaims[]`, `containers[].resources.claims[]` | attach a claim (or a template) to the Pod and a container | none |
| ResourceClaim `status.allocation`, `reservedFor` | the chosen devices and the Pods that use them; written by the scheduler | unset until allocated |

## kubectl

```bash
kubectl api-resources --api-group=resource.k8s.io     # five kinds, all resource.k8s.io/v1
kubectl get deviceclass,resourceslice                 # what the cluster offers
kubectl get resourceclaim                             # STATE: pending or allocated,reserved
kubectl get resourceclaim gpu-claim -o jsonpath='{.status}'
kubectl describe pod dra-demo | sed -n '/^Events/,$p' # scheduler and kubelet messages
kubectl get devicetaintrule
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pod `ContainerCreating`; event `Warning FailedPrepareDynamicResources kubelet Failed to prepare dynamic resources: prepare dynamic resources: DRA driver gpu.example.com is not registered` (the claim itself shows `allocated,reserved`) | The scheduler allocated the device, but no DRA driver plug-in is registered with the kubelet on that node | Install the driver's node plug-in and check that it registered |
| Pod `Pending`; event `0/3 nodes are available: request tpu: device class no-such-class does not exist. preemption: 0/3 nodes are available: 3 Preemption is not helpful for scheduling.` | The claim names a DeviceClass that does not exist | Create the DeviceClass or fix `deviceClassName` |
| A Pod that used to schedule stays `Pending` after a DeviceTaintRule appears (documented, not reproduced) | A `NoSchedule` taint blocks new Pods whose claims do not tolerate it; `NoExecute` also evicts running ones | Remove the rule when maintenance ends, or tolerate the taint in the claim |

## Related

- **Cards:** kube-scheduler, kubelet, PersistentVolumeClaim and StorageClass (the storage design DRA copies), Requests, limits and QoS
- **Chapter and lab:** none: card-only self-study in the coverage matrix
- **Exam:** not named in the [CKA or CKAD v1.37 curriculum](https://github.com/cncf/curriculum) (checked 2026-11-17); KCNA, Container Orchestration (28%)
- **Source:** [Dynamic Resource Allocation](https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/)
