# Upgrades and version skew

## What and why

Upgrading moves a cluster to a new Kubernetes version without downtime, in an order that respects the version skew limits. With kubeadm that means the control plane first, then each node in turn.

**Acts on it:** kubeadm replaces the static Pod manifests of the control plane components; on each node you upgrade the kubelet package and restart the kubelet.

## Diagram

{{diagram upgrades-and-version-skew-01.jsx | kubeadm upgrade order · 6 steps}}

Source: [Version Skew Policy](https://kubernetes.io/releases/version-skew-policy/) and [Upgrading kubeadm clusters](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-upgrade/), both opened 2026-11-16.

## Minimal example

Tested on kind v0.33.0 (1 control-plane node), node image `kindest/node:v1.37.0`, kubeadm v1.37.0 inside the node, kubectl v1.37.1 (2026-11-17). **The upgrade itself was not run**: it needs a newer kubeadm binary and packages that a kind node does not install. What was run is everything before it: the version check, the read-only plan, the certificate check, and the guard rails. The procedure that follows is from the [kubeadm upgrade page](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-upgrade/) (opened 2026-11-17) and is marked as such.

```text
$ kubectl version
Client Version: v1.37.1
Kustomize Version: v5.8.1
Server Version: v1.37.0
$ docker exec cnlab-control-plane kubeadm version -o short; docker exec ... kubelet --version
v1.37.0
Kubernetes v1.37.0
$ docker exec cnlab-control-plane kubeadm upgrade plan
[upgrade/versions] Cluster version: 1.37.0
[upgrade/versions] kubeadm version: v1.37.0
[upgrade/versions] Target version: v1.37.2
[upgrade/versions] Latest version in the v1.37 series: v1.37.2
Components that must be upgraded manually after you have upgraded the control plane with 'kubeadm upgrade apply':
COMPONENT   NODE                         CURRENT   TARGET
kubelet     cnlab-control-plane          v1.37.0   v1.37.2
Upgrade to the latest version in the v1.37 series:
COMPONENT                 NODE                         CURRENT   TARGET
kube-apiserver            cnlab-control-plane          v1.37.0   v1.37.2
kube-controller-manager   cnlab-control-plane          v1.37.0   v1.37.2
kube-scheduler            cnlab-control-plane          v1.37.0   v1.37.2
kube-proxy                                             1.37.0    v1.37.2
CoreDNS                                                v1.14.6   v1.14.6
etcd                      cnlab-control-plane          3.7.0-0   3.7.0-0
You can now apply the upgrade by executing the following command:
	kubeadm upgrade apply v1.37.2
Note: Before you can perform this upgrade, you have to update kubeadm to v1.37.2.
```

The documented order for a patch or minor upgrade (not run): back up etcd, upgrade the `kubeadm` package on the first control-plane node, `kubeadm upgrade plan`, `kubeadm upgrade apply v1.37.x`; then for every node in turn `kubectl drain <node> --ignore-daemonsets`, upgrade the `kubelet` and `kubectl` packages, restart the kubelet, `kubectl uncordon <node>`; other control-plane nodes and workers use `kubeadm upgrade node`. Minor versions are never skipped.

## Key fields

Skew limits are from the [Version Skew Policy](https://kubernetes.io/docs/releases/version-skew-policy/) (opened 2026-11-17), relative to the newest kube-apiserver; the kubeadm facts are from the commands above.

| Component | Allowed version relative to kube-apiserver | Upgrade order |
| --- | --- | --- |
| kube-apiserver (HA) | Instances within 1 minor version of each other | 1st |
| kube-controller-manager, kube-scheduler, cloud-controller-manager | Not newer; should match, may be 1 minor older | 2nd, any order |
| kubelet | Not newer; up to 3 minor versions older | 3rd (drain the node first) |
| kube-proxy | Not newer; up to 3 minor versions older | 4th, optional |
| kubectl | 1 minor older or newer | any time |
| `kubeadm upgrade plan` | Read-only: lists targets and what must be upgraded by hand | no changes |
| `kubeadm upgrade apply <version>` | Upgrades the first control-plane node's static Pods and add-ons | one version up at most |
| `kubeadm upgrade node` | Upgrades another control-plane node or a worker | per node |
| `kubeadm certs check-expiration` | Residual time of each kubeadm certificate (`364d` on the new cluster) |  |
| `--dry-run`, `--force` | Simulate; or bypass the version checks | off |

In an HA cluster with API servers at two versions, the older one limits every other component. Before the minor upgrade, make sure admission webhooks cope with the new API versions (the policy suggests `matchPolicy: Equivalent`).

## kubectl

```bash
kubectl version                                         # client and server versions
kubectl get nodes -o wide                               # kubelet version per node
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name} {.status.nodeInfo.kubeletVersion}{"\n"}{end}'
kubectl -n kube-system get pods -o custom-columns=NAME:.metadata.name,IMAGE:.spec.containers[0].image
kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis   # APIs in use that will be removed
# on the first control-plane node (root):
kubeadm version -o short
kubeadm upgrade plan
kubeadm upgrade apply v1.37.2        # after upgrading the kubeadm package
kubeadm certs check-expiration
# per node, from a machine with kubectl:
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data
kubectl uncordon <node>
```

## How it fails

Rows 1 and 2 were reproduced with `kubeadm upgrade apply --dry-run` on the test cluster; row 3 is from the Version Skew Policy and was not reproduced.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubeadm upgrade apply v1.39.0 --dry-run` ends with `Specified version to upgrade to "v1.39.0" is too high; kubeadm can upgrade only 1 minor version at a time` and `... is at least one minor release higher than the kubeadm minor release (39 > 37). Such an upgrade is not supported` | A minor version was skipped | Go one minor at a time: install the next minor's kubeadm, upgrade, repeat |
| `kubeadm upgrade apply v1.36.0 --dry-run`: `Kubeadm version v1.37.0 can only be used to upgrade to Kubernetes version 1.37` and `Can be bypassed if you pass the --force flag` | The target is older than the kubeadm binary: downgrades are not supported | Use the kubeadm package that matches the target version; do not use `--force` to downgrade |
| After upgrading the control plane first, a node with a kubelet more than 3 minor versions behind, or a kubelet newer than the API server, stops working as expected | The skew limits (kubelet not newer than the API server; at most 3 minor versions older) were broken | Upgrade in the documented order, and do not leave kubelets more than 3 minor versions behind before the control plane moves |

The plan output also tells you what it will not do: the kubelet is listed under `Components that must be upgraded manually`, which means the node-by-node drain, package upgrade and restart remain your work.

## Related

- **Cards:** kubeadm and cluster bootstrap (group 1), etcd backup and restore, Node maintenance and eviction, kubelet (group 1), StorageVersionMigration.
- **Chapter and lab:** 5.5.
- **Exam:** CKA Cluster Architecture, Installation and Configuration (25%): manage the lifecycle of Kubernetes clusters.
