# CNI and CSI plug-ins

## What and why

Kubernetes defines what must happen for a Pod's network and storage but leaves how to plug-ins, so each environment can choose. **CNI** (Container Network Interface) plug-ins give a new Pod sandbox its network: when the runtime creates the sandbox it runs the CNI plug-in executable, which creates the interface, assigns an IP address and sets up routes. Kubernetes itself ships no Pod network; without a working CNI plug-in, Pods cannot start.

**CSI** (Container Storage Interface) drivers do the same for volumes: a controller part provisions and attaches volumes, a node part mounts them for the kubelet. The CSIDriver, CSINode and VolumeAttachment objects (group 6) record what is installed. The kubelet and the runtime call the plug-ins; no Kubernetes controller does the work itself.

## Diagram

{{diagram cni-and-csi-plug-ins-01.jsx | CNI and CSI · two plug-in lanes}}
Both are plug-in interfaces: Kubernetes defines when to call them, and the installed plug-in decides how the network or volume is actually built.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). kind installs the **kindnet** CNI plug-in as a DaemonSet. `nx` means `docker exec cnlab-control-plane`.

```
$ nx ls /etc/cni/net.d; nx ls /opt/cni/bin
10-kindnet.conflist
host-local  loopback  portmap  ptp
$ nx cat /etc/cni/net.d/10-kindnet.conflist | grep -E '"type"|subnet'
"type": "ptp",  "type": "host-local",  [ { "subnet": "10.244.0.0/24" } ],  "type": "portmap"
$ kubectl -n kube-system get ds kindnet
NAME      DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR            AGE
kindnet   1         1         1       1            1           kubernetes.io/os=linux   11m
$ kubectl run cnipod --image=alpine:3.21 --command -- sleep 3600; kubectl get pod cnipod -o jsonpath='{.status.podIP}'; kubectl get node -o jsonpath='{.items[0].spec.podCIDR}'
10.244.0.82
10.244.0.0/24
$ kubectl exec cnipod -- ip route
default via 10.244.0.1 dev eth0
10.244.0.0/24 via 10.244.0.1 dev eth0  src 10.244.0.82
10.244.0.1 dev eth0 scope link  src 10.244.0.82
```

CSI on the same cluster: no CSI driver is installed. The default StorageClass uses the `rancher.io/local-path` provisioner:

```
$ kubectl get csidrivers; kubectl get csinodes; kubectl get storageclass
No resources found
NAME                      DRIVERS   AGE
cnlab-control-plane       0         11m
NAME                 PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE      ALLOWVOLUMEEXPANSION   AGE
standard (default)   rancher.io/local-path   Delete          WaitForFirstConsumer   false                  11m
```

## Key fields

| Item | Meaning | Value in kind |
| --- | --- | --- |
| `/etc/cni/net.d/*.conflist` | CNI configuration the runtime reads; the first file in name order wins | `10-kindnet.conflist` |
| `/opt/cni/bin/` | Plug-in executables the config names | `host-local`, `loopback`, `portmap`, `ptp` |
| `Node.spec.podCIDR` | Pod address range given to the node | `10.244.0.0/24` |
| controller-manager `--cluster-cidr` | Whole Pod network range | `10.244.0.0/16` |
| `CSIDriver` object | Declares an installed CSI driver and its behaviour | none installed |
| `CSINode` object | Drivers registered on each node | `DRIVERS 0` |
| `StorageClass.provisioner` | Which driver or provisioner creates volumes | `rancher.io/local-path` (not a CSI driver) |

Values are from this cluster. "The first file in name order wins" is the CNI convention and was not tested here.

## kubectl

```
kubectl -n kube-system get ds,pods -o wide                    # the CNI DaemonSet and its Pods (name varies: kindnet, calico-node, cilium ...)
kubectl get node <node> -o jsonpath='{.spec.podCIDR}'        # range for this node
kubectl get pod <pod> -o jsonpath='{.status.podIP}'
kubectl exec <pod> -- ip addr show eth0                      # the interface the plug-in created
kubectl exec <pod> -- ip route
kubectl get csidrivers,csinodes,volumeattachments            # CSI state
kubectl get node <node> -o jsonpath='{.status.conditions[?(@.type=="Ready")]}'   # NetworkPluginNotReady shows here
# on the node:
ls /etc/cni/net.d /opt/cni/bin
```

## How it fails

Rows one and two were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Node `NotReady`; Ready condition: `False KubeletNotReady: container runtime network not ready: NetworkReady=false reason:NetworkPluginNotReady message:Network plugin returns error: cni plugin not initialized`; a new Pod stays `Pending` (`FailedScheduling: ... 1 node(s) had untolerated taint(s)`) | The CNI config file was moved away (and containerd restarted), so the runtime has no network plug-in; the node lifecycle marks the node unready | Restore or reinstall the CNI plug-in; after the file was put back and containerd restarted, the node was `Ready` and the new Pod `Running` within 25 s |
| A PVC with `storageClassName: gold` stays `Pending`; event `ProvisioningFailed ... storageclass.storage.k8s.io "gold" not found` | The StorageClass does not exist, so no provisioner or CSI driver acts | Create the StorageClass or fix the name (`kubectl get storageclass`) |
| Pods with a CSI volume stay `ContainerCreating` and events mention the driver not being found among registered drivers (not reproduced) | The CSI node plug-in is not running on that node | Check the driver's DaemonSet and `kubectl get csinodes` |

## Related

- **Cards:** Container runtime (CRI); kubelet; kube-proxy; Service and NetworkPolicy (group 4); StorageClass, PersistentVolume, CSIDriver and VolumeAttachment (group 6).
- **Chapter and lab:** Chapters 2.5 (Pod networking), 4.2, 5.4 and 6.1 with Labs 5.4 and 6.1 (Vol 2, 4, 5, 6).
- **Exam domain:** CKA Cluster Architecture: extension interfaces (CNI, CSI, CRI); CKA Services and Networking: Pod connectivity.
