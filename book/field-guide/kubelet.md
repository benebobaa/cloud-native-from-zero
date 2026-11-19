# kubelet

## What and why

The control plane decides which Pod runs where, but something on each node must actually start the containers and report back. The **kubelet** is that agent: it ensures that Pods are running, including their containers ([components overview](https://kubernetes.io/docs/concepts/overview/components/)). It watches the API server for Pods bound to its node, asks the container runtime (over CRI) to pull images and start containers, runs probes, restarts containers according to `restartPolicy`, and writes Pod and Node status back.

The kubelet also renews a Lease every few seconds as a heartbeat; when that stops, the node lifecycle controller marks the node NotReady. It can run Pods with no API server at all from static Pod files in a local directory, which is how kubeadm starts the control plane.

## Diagram

{{diagram kubelet-01.jsx | kubelet inputs, outputs and reports}}
The kubelet reads Pod specs from the API server and from static files, drives the runtime and probes, and reports node and Pod status back.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0` (kubelet v1.37.0), kubectl v1.37.1 (2026-11-16). The kubelet is a systemd service on the node, not a Pod; in kind the "node" is a container, so `nx` below means `docker exec cnlab-control-plane`.

```
$ nx systemctl is-active kubelet; nx ps -o pid,args -C kubelet | cut -c1-170
active
  PID COMMAND
  763 /usr/bin/kubelet --bootstrap-kubeconfig=/etc/kubernetes/bootstrap-kubelet.conf --kubeconfig=/etc/kubernetes/kubelet.conf --config=/var/lib/kubelet/config.yaml --node-ip=172.21.0.2 ...
$ nx ls /etc/kubernetes/manifests; nx grep staticPodPath /var/lib/kubelet/config.yaml
etcd.yaml  kube-apiserver.yaml  kube-controller-manager.yaml  kube-scheduler.yaml
staticPodPath: /etc/kubernetes/manifests
$ kubectl get --raw /api/v1/nodes/cnlab-control-plane/proxy/healthz
ok
$ kubectl get node cnlab-control-plane -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.reason}{"\n"}{end}'
MemoryPressure=False KubeletHasSufficientMemory
DiskPressure=False KubeletHasNoDiskPressure
PIDPressure=False KubeletHasSufficientPID
Ready=True KubeletReady
```

The four control-plane components are Pods only because the kubelet reads their files from `staticPodPath`; the API server shows them as read-only mirror Pods owned by the Node.

## Key fields

The kubelet reads a KubeletConfiguration file (`--config=/var/lib/kubelet/config.yaml`). Values below were read from this cluster's running kubelet (`/api/v1/nodes/<node>/proxy/configz`).

| Field | Meaning | Value in kind |
| --- | --- | --- |
| `staticPodPath` | Directory of Pod manifests the kubelet runs by itself | `/etc/kubernetes/manifests` |
| `containerRuntimeEndpoint` | CRI socket | `unix:///run/containerd/containerd.sock` |
| `cgroupDriver` | How cgroups are managed (must match the runtime) | `systemd` |
| `nodeStatusUpdateFrequency` | How often node status is checked and reported | 10s |
| `nodeStatusReportFrequency` | Report interval when nothing changed | 5m0s |
| `nodeLeaseDurationSeconds` | Lifetime of the node Lease | 40 |
| `syncFrequency` | Maximum interval between syncs of running containers with config | 1m0s |
| `maxPods` | Pods allowed on this node | 110 |
| `clusterDNS`, `clusterDomain` | Written into each Pod's resolv.conf | `10.96.0.10`, `cluster.local` |
| `containerLogMaxSize`, `containerLogMaxFiles` | Container log rotation | 10Mi, 5 |

## kubectl

```
kubectl get nodes -o wide                                  # status, kubelet version, runtime
kubectl describe node <node>                               # conditions, capacity, Pods on it, Events
kubectl get --raw /api/v1/nodes/<node>/proxy/healthz       # kubelet health through the API server
kubectl get --raw /api/v1/nodes/<node>/proxy/configz       # the live kubelet configuration
kubectl -n kube-node-lease get lease <node>                # heartbeat: renewTime
kubectl get pod -n kube-system etcd-<node> -o jsonpath='{.metadata.ownerReferences[0].kind}'   # mirror Pod: Node
# on the node (kubectl cannot help when the kubelet is down):
systemctl status kubelet        journalctl -u kubelet -f        crictl ps -a
```

`systemctl status` and `journalctl` were not run; `crictl ps` and `systemctl is-active` were.

## How it fails

Row one was reproduced on the test cluster; the API-server row also shows the kubelet's static-Pod behaviour.

| Symptom | Cause | Fix |
| --- | --- | --- |
| After `systemctl stop kubelet` and about 85 seconds: node `NotReady`; conditions `Ready=Unknown NodeStatusUnknown: Kubelet stopped posting node status.`; taints `node.kubernetes.io/unreachable` (`NoSchedule`, `NoExecute`); the node Lease `renewTime` stops advancing | The kubelet no longer posts status or renews its Lease, so the node lifecycle controller marks the node unhealthy after its grace period (50 s by default) | Start the kubelet (`systemctl start kubelet`); after 20 s the node was `Ready` again; read `journalctl -u kubelet` for why it died |
| A static control-plane Pod disappears when its file is moved out of `/etc/kubernetes/manifests` | The kubelet runs exactly what is in `staticPodPath` | Put the file back (seen in the kube-apiserver card) |
| A Pod stays `ContainerCreating` or `ErrImagePull` | The kubelet cannot pull the image or set up the sandbox (see the Container runtime and CNI cards) | `kubectl describe pod` and the kubelet log on the node |

## Related

- **Cards:** Pod; Pod lifecycle and probes; Container runtime (CRI); CNI and CSI plug-ins; Node and Node maintenance and eviction (groups 7, 11); Lease (group 2); kubeadm and cluster bootstrap.
- **Chapter and lab:** Chapters 5.1 and 5.5, Lab 5.1 (Vol 5).
- **Exam domain:** CKA Troubleshooting: cluster components, clusters and nodes.
