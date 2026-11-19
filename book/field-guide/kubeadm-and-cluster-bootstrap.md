# kubeadm and cluster bootstrap

## What and why

Starting a control plane by hand means generating certificates, writing kubeconfigs and static Pod manifests for etcd, the API server, the scheduler and the controller manager, and starting the kubelet that runs them. **kubeadm** automates exactly that and nothing more: `kubeadm init` bootstraps the first control-plane node, `kubeadm join` adds nodes, and `kubeadm upgrade` moves a cluster to the next version. It does not provision machines, install a CNI plug-in or manage the cluster afterwards.

kubeadm acts once and then steps aside: the control plane it creates is a set of static Pods run by the kubelet from `/etc/kubernetes/manifests`. kind uses kubeadm inside each node container, so the lab clusters show the same layout as a kubeadm cluster.

## Diagram

{{diagram kubeadm-and-cluster-bootstrap-01.jsx | kubeadm init phases · 13 steps, then join}}
The phases are the ones `kubeadm init --help` lists; each can also be run alone with `kubeadm init phase <name>`.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0` (kubeadm v1.37.0), kubectl v1.37.1 (2026-11-16). kind runs `kubeadm init` inside the node container, so the result of a real bootstrap can be inspected (`nx` = `docker exec cnlab-control-plane`). A fresh `kubeadm init` on real machines (`sudo kubeadm init`, `kubeadm join ...`) was **not run** here: it needs root and separate machines.

```
$ nx kubeadm version -o short
v1.37.0
$ nx ls /etc/kubernetes /etc/kubernetes/pki | head -12
/etc/kubernetes: admin.conf controller-manager.conf kubelet.conf manifests pki scheduler.conf super-admin.conf
/etc/kubernetes/pki: apiserver-etcd-client.crt ... apiserver.crt apiserver.key ca.crt ca.key etcd front-proxy-ca.crt ... sa.key sa.pub
$ nx cat /kind/kubeadm.conf | sed -n '1,18p'
apiServer: {certSANs: [localhost, 127.0.0.1], extraArgs: [{name: runtime-config, value: ""}]}
apiVersion: kubeadm.k8s.io/v1beta4
clusterName: cnlab
controlPlaneEndpoint: cnlab-control-plane:6443
kind: ClusterConfiguration
kubernetesVersion: v1.37.0
networking: {podSubnet: 10.244.0.0/16, serviceSubnet: 10.96.0.0/16}
$ nx kubeadm certs check-expiration | sed -n '4,7p;16,18p'
CERTIFICATE                EXPIRES                  RESIDUAL TIME   CERTIFICATE AUTHORITY   EXTERNALLY MANAGED
admin.conf                 Nov 16, 2027 08:14 UTC   364d            ca                      no
apiserver                  Nov 16, 2027 08:14 UTC   364d            ca                      no
ca                      Nov 13, 2036 08:14 UTC   9y              no
$ nx kubeadm token list
TOKEN                     TTL   EXPIRES                USAGES                   EXTRA GROUPS
abcdef.0123456789abcdef   23h   2026-11-17T08:15:01Z   authentication,signing   system:bootstrappers:kubeadm:default-node-token
$ kubectl -n kube-system get cm; kubectl -n kube-system get secret
coredns  extension-apiserver-authentication  kube-proxy  kube-root-ca.crt  kubeadm-config  kubelet-config ...
bootstrap-token-abcdef   bootstrap.kubernetes.io/token   6
```

Everything `kubeadm init` produced is visible: certificates in `/etc/kubernetes/pki`, kubeconfigs, the four static Pod manifests, the `kubeadm-config` and `kubelet-config` ConfigMaps, and a bootstrap token Secret (kind uses a fixed token; a real one is random).

## Key fields

The cluster-wide settings live in the `ClusterConfiguration` stored in the `kubeadm-config` ConfigMap (`apiVersion: kubeadm.k8s.io/v1beta4`). Values are from this cluster.

| Field | Meaning | Value in kind |
| --- | --- | --- |
| `kubernetesVersion` | Control-plane version to install | `v1.37.0` |
| `controlPlaneEndpoint` | Stable address of the API server (a load balancer in HA setups) | `cnlab-control-plane:6443` |
| `networking.podSubnet` | Pod network range | `10.244.0.0/16` |
| `networking.serviceSubnet` | ClusterIP range | `10.96.0.0/16` |
| `networking.dnsDomain` | Cluster DNS domain | `cluster.local` |
| `certificatesDir` | Where certificates are written | `/etc/kubernetes/pki` |
| `certificateValidityPeriod`, `caCertificateValidityPeriod` | Lifetime of leaf and CA certificates | `8760h0m0s` (1 year), `87600h0m0s` (10 years) |
| `etcd.local.dataDir` | etcd data directory (a local, stacked etcd) | `/var/lib/etcd` |
| `imageRepository` | Where control-plane images are pulled from | `registry.k8s.io` |
| `apiServer.extraArgs`, `controllerManager.extraArgs` | Extra flags for those components | kind sets `runtime-config` and `enable-hostpath-provisioner` |
| `InitConfiguration.nodeRegistration.criSocket` | Runtime socket for this node | `unix:///run/containerd/containerd.sock` |

## kubectl

kubeadm itself is a command run on the nodes; kubectl inspects what it left behind.

```
kubectl -n kube-system get cm kubeadm-config -o jsonpath='{.data.ClusterConfiguration}'
kubectl -n kube-system get cm kubelet-config -o jsonpath='{.data.kubelet}'
kubectl -n kube-public get cm cluster-info                  # what a joining node first reads
kubectl -n kube-system get secret                           # bootstrap tokens
# on the node, as root:
kubeadm certs check-expiration        kubeadm token list        kubeadm init phase preflight
kubeadm upgrade plan                  # run; its output was cut off after the health checks
kubeadm certs renew all               # not run
kubeadm token create --print-join-command   # not run
```

## How it fails

Row one was reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubeadm init phase preflight` on an already-initialised node: `[preflight] Some fatal errors occurred: [ERROR Port-6443]: Port 6443 is in use` (also 10259, 10257, 10250, 2379, 2380), `[ERROR FileAvailable--etc-kubernetes-manifests-kube-apiserver.yaml]: ... already exists`, `[ERROR DirAvailable--var-lib-etcd]: /var/lib/etcd is not empty` | The node already runs a control plane, so ports and files are taken | Run `kubeadm reset` on a node you want to re-initialise; never run `init` twice on a live node |
| Clients start failing TLS verification about a year after install (not reproduced); `kubeadm certs check-expiration` shows `RESIDUAL TIME` near 0 | Leaf certificates are valid `8760h` (1 year) and kubeadm only renews them during upgrades or on request | Run `kubeadm certs renew all` and restart the control-plane Pods, or upgrade at least yearly |
| `kubeadm join` is refused with an expired token (not reproduced); `kubeadm token list` showed `TTL 23h` for the bootstrap token | Bootstrap tokens expire (24 hours by default) | `kubeadm token create --print-join-command` on a control-plane node |

Sources, checked 2026-11-17: [Certificate management with kubeadm](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-certs/) (leaf certificates 1 year, CA 10 years; kubeadm renews all certificates during a control-plane upgrade unless `--certificate-renewal=false`; `kubeadm certs renew` on every control-plane node, then restart the control-plane Pods; the kubelet client certificate rotates by itself), [kubeadm token](https://kubernetes.io/docs/reference/setup-tools/kubeadm/kubeadm-token/) (`kubeadm init` creates a token with a 24-hour TTL; `--ttl 0` never expires) and [kubeadm init](https://kubernetes.io/docs/reference/setup-tools/kubeadm/kubeadm-init/) (the phase list also ends with `show-join-command`, a fourteenth phase that is not drawn).

## Related

- **Cards:** kubelet; etcd; kube-apiserver; Certificates and trust bundles (group 9); Upgrades and version skew and etcd backup and restore (group 11).
- **Chapter and lab:** Chapters 3.2 and 5.5, Lab 5.5 (Vol 3, 5; Lab 5.5 needs two small VMs, not run in the kind labs).
- **Exam domain:** CKA Cluster Architecture: prepare infrastructure, kubeadm, highly available control plane.
