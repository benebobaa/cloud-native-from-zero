# CSIDriver, CSINode and CSIStorageCapacity

## What and why

CSI (Container Storage Interface) is the standard way a storage vendor plugs a driver into Kubernetes. Three API objects describe it. `CSIDriver` is cluster-wide: how Kubernetes should treat the driver (`attachRequired`, `podInfoOnMount`, `storageCapacity`, `fsGroupPolicy` and more). `CSINode` is one per node and lists the drivers registered there. `CSIStorageCapacity` reports free space per topology segment, which the scheduler can use for volumes that wait for the first consumer.

The driver itself is ordinary Pods: a controller Deployment with sidecars (external-provisioner, external-attacher, external-resizer) and a node DaemonSet. The node plug-in registers with the **kubelet**, which creates the `CSINode` entry.

## Diagram

{{diagram csidriver-csinode-and-csistoragecapacity-01.jsx | CSI objects · 6 boxes}}

CSIDriver and CSINode are API records; the driver Pods and node plug-in do the work.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). kind runs no CSI driver, so only the **API objects were run**; no driver, attach or mount step was. A `CSIDriver` object for a made-up driver, with the defaults the API server filled in:

```yaml
apiVersion: storage.k8s.io/v1
kind: CSIDriver
metadata: {name: fake.csi.example.com}
spec:
  attachRequired: true
  podInfoOnMount: false
  storageCapacity: false
  volumeLifecycleModes: [Persistent]
```

```
$ kubectl get csidriver; kubectl get csinode; kubectl get csistoragecapacities -A
NAME                   ATTACHREQUIRED   PODINFOONMOUNT   STORAGECAPACITY   TOKENREQUESTS   REQUIRESREPUBLISH   MODES
fake.csi.example.com   true             false            false             <unset>         false               Persistent
NAME                      DRIVERS   AGE
cnlab-control-plane       0         4m54s
cnlab-worker              0         4m38s
cnlab-worker2             0         4m38s
No resources found

$ kubectl get csidriver fake.csi.example.com -o yaml    # defaults added by the API server
spec:
  attachRequired: true
  fsGroupPolicy: ReadWriteOnceWithFSType
  podInfoOnMount: false
  preventPodSchedulingIfMissing: false
  requiresRepublish: false
  seLinuxMount: false
  storageCapacity: false
  volumeLifecycleModes: [Persistent]
```

Every node already has a `CSINode` (here with `DRIVERS 0`, owned by the Node); a registered driver would appear in its `spec.drivers`. There are no `CSIStorageCapacity` objects because no provisioner publishes them.

## Key fields

Checked with `kubectl explain csidriver.spec` on 1.37 and the object listed above.

| Field | Meaning | Default |
| --- | --- | --- |
| CSIDriver `attachRequired` | whether a VolumeAttachment step is needed; immutable | `true` if unset in the manifest (it was set here) |
| `podInfoOnMount` | pass Pod name and namespace to the driver on mount | `false` |
| `storageCapacity` | the scheduler should use CSIStorageCapacity for this driver | `false` |
| `fsGroupPolicy` | whether Kubernetes changes ownership and permissions before mounting | `ReadWriteOnceWithFSType` |
| `volumeLifecycleModes` | `Persistent` and or `Ephemeral` | `Persistent` |
| `requiresRepublish`, `seLinuxMount` | republish volumes periodically; mount with SELinux context | `false` |
| `tokenRequests` | service account tokens the kubelet passes to the driver | none |
| CSINode `spec.drivers[]` | per node: driver `name`, `nodeID`, topology keys, allocatable volume count | empty until a driver registers |
| CSIStorageCapacity | free `capacity` for one StorageClass in one topology segment; written by the driver's provisioner | none |

## kubectl

```bash
kubectl get csidriver                         # ATTACHREQUIRED, PODINFOONMOUNT, MODES
kubectl get csinode                           # DRIVERS registered per node
kubectl get csinode cnlab-worker -o yaml  # spec.drivers
kubectl get csistoragecapacities -A           # free space per topology, if the driver publishes it
kubectl get pods -A | grep -i csi             # are the driver Pods running?
kubectl describe pvc csi-claim                # events from the provisioner
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `The CSIDriver "fake.csi.example.com" is invalid: spec.attachedRequired: Invalid value: false: field is immutable` (while patching `podInfoOnMount` worked) | `attachRequired` cannot change after creation | Recreate the CSIDriver object when no volumes depend on it |
| Claim of a class with `provisioner: fake.csi.example.com` stays `Pending`; event `Waiting for a volume to be created either by the external provisioner 'fake.csi.example.com' or manually by the system administrator. If volume creation is delayed, please verify that the provisioner is running and correctly registered.` | The driver's controller Pods (external-provisioner) are not running; a CSIDriver object alone installs nothing | Install the driver; run kubectl get pods -A and look for its Pods |
| `kubectl get csinode` shows `DRIVERS 0` | The node plug-in did not register with the kubelet (not installed, or not running on that node) | Check the driver DaemonSet Pod on the node and the kubelet logs |

## Related

- **Cards:** CNI and CSI plug-ins (group 1), StorageClass, VolumeAttachment, kube-scheduler, kubelet
- **Chapter and lab:** Ch 5.4 and Lab 5.4
- **Exam:** CKA, Cluster Architecture, Installation and Configuration (25%): extension interfaces (CNI, CSI, CRI)
- **Source:** [Storage Capacity](https://kubernetes.io/docs/concepts/storage/storage-capacity/), [Kubernetes CSI documentation](https://kubernetes-csi.github.io/docs/)
