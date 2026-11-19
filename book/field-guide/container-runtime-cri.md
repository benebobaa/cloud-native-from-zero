# Container runtime (CRI)

## What and why

Kubernetes does not start containers itself; a **container runtime** does ([components overview](https://kubernetes.io/docs/concepts/overview/components/)). The **Container Runtime Interface (CRI)** is the gRPC API between the kubelet and the runtime, so the kubelet works the same with containerd or CRI-O. Through CRI the kubelet creates Pod sandboxes (the shared namespaces), pulls images, and starts, stops and inspects containers.

The runtime in turn calls a low-level OCI runtime such as runc to create the Linux process with its namespaces and cgroups (Vol 4 chapter 4.2). Only the kubelet talks CRI; you debug it with `crictl` on the node, which speaks the same API.

## Diagram

{{diagram container-runtime-cri-01.jsx | CRI layers · kubelet to kernel}}
CRI is the interface between the kubelet and the runtime, so Kubernetes can use containerd or CRI-O without knowing how either one starts a process.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0` (containerd 2.3.4, runc 1.4.3, crictl 1.36.0), kubectl v1.37.1 (2026-11-16). `nx` means `docker exec cnlab-control-plane`; on a real node run the commands directly as root.

```
$ kubectl get node -o jsonpath='{.items[0].status.nodeInfo.containerRuntimeVersion}'
containerd://2.3.4
$ nx crictl version
RuntimeName:  containerd
RuntimeVersion:  v2.3.4
RuntimeApiVersion:  v1
$ nx crictl ps | head -3
CONTAINER      IMAGE          CREATED       STATE     NAME                      ATTEMPT   POD ID         POD                                               NAMESPACE
1f79481579de9  d6a28daf3e6b0  20 seconds ago  Running  kube-proxy               0         f59864c05e517  kube-proxy-p8vs8                                  kube-system
ac4ddead3b6bb  364b3c3d9ec19  3 minutes ago   Running  kube-controller-manager  0         3cf4a231cc0b3  kube-controller-manager-cnlab-control-plane       kube-system
$ nx crictl pods | head -2
POD ID         CREATED          STATE   NAME              NAMESPACE     ATTEMPT   RUNTIME
f59864c05e517  21 seconds ago   Ready   kube-proxy-p8vs8  kube-system   0         (default)
$ nx crictl images | head -3
IMAGE                                    TAG                   IMAGE ID       SIZE
docker.io/kindest/kindnetd               v20260820-69b56db7    4626fe10df5b9  39.7MB
docker.io/kindest/local-path-helper      v20260131-7181c60a    19aa6a21b42cb  2.87MB
```

`crictl` talks the same CRI API as the kubelet and shows what Kubernetes cannot: sandboxes (`pods`), containers including the control plane's, and the images on the node.

## Key fields

The kubelet picks its runtime with one setting; the runtime has its own config. Values are from this cluster.

| Setting | Meaning | Value in kind |
| --- | --- | --- |
| kubelet `containerRuntimeEndpoint` | The CRI socket the kubelet talks to | `unix:///run/containerd/containerd.sock` |
| `/etc/crictl.yaml` `runtime-endpoint` | Socket `crictl` uses | the same containerd socket |
| containerd `runtime_type` | Which low-level runtime shim runs containers | `io.containerd.runc.v2` (runc) |
| containerd `SystemdCgroup` | Manage cgroups through systemd; must match the kubelet's `cgroupDriver` | `true` (kubelet: `systemd`) |
| containerd `sandbox_image` | The "pause" image that holds a Pod's shared namespaces | `registry.k8s.io/pause:3.10` |
| `Pod.spec.runtimeClassName` | Pick a different runtime configuration for one Pod (RuntimeClass card) | unset (default runtime) |
| `Node.status.nodeInfo.containerRuntimeVersion` | Which runtime a node reports | `containerd://2.3.4` |

## kubectl

The runtime is managed on the node, so most of the debugging is `crictl` there. kubectl shows the result.

```
kubectl get nodes -o wide                                  # CONTAINER-RUNTIME column
kubectl describe pod <pod>                                 # Events: Pulling, Pulled, Created, Started, Failed
kubectl get node <node> -o jsonpath='{.status.nodeInfo.containerRuntimeVersion}'
kubectl get runtimeclass                                   # alternative runtime configurations
# on the node:
crictl ps -a        crictl pods        crictl images        crictl logs <container-id>
crictl --runtime-endpoint unix:///run/containerd/containerd.sock info    # not run
```

## How it fails

Rows one and two were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ErrImagePull` then `ImagePullBackOff`; event: `Failed to pull image "registry.invalid/nope:1": failed to pull and unpack image ...: failed to resolve reference ...: failed to do request: Head "https://registry.invalid/v2/nope/manifests/1": dial tcp: lookup registry.invalid on 192.168.65.254:53: no such host` | The runtime could not reach the registry: a wrong host name here (the same row would read `not found` for a missing tag, `unauthorized` for missing credentials) | Fix the image reference, DNS or network, or add `imagePullSecrets` |
| `crictl --runtime-endpoint unix:///run/nope.sock ps` fails with `validate CRI v1 runtime API for endpoint ... rpc error: code = Unavailable desc = connection error ... dial unix /run/nope.sock: connect: no such file or directory` | The socket path is wrong or the runtime is not running; the kubelet fails the same way when `containerRuntimeEndpoint` is wrong | Use the real socket (`/run/containerd/containerd.sock`); check `systemctl status containerd` |
| `kubectl get runtimeclass` prints `No resources found`, yet a Pod with `runtimeClassName: x` is rejected (second part not run) | A RuntimeClass is a cluster object you must create; on kind none exists by default | Create the RuntimeClass and configure the matching handler in the runtime |

## Related

- **Cards:** kubelet; Pod; RuntimeClass (group 7: choose a runtime per Pod); CNI and CSI plug-ins; Logs, events and kubectl debug (group 11).
- **Chapter and lab:** Chapter 4.2 (Vol 4) and Chapter 5.4 with Lab 5.4 (Vol 5).
- **Exam domain:** CKA Cluster Architecture: extension interfaces (CNI, CSI, CRI).
