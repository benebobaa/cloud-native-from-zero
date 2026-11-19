# Glossary & References

## Glossary

Every term below is defined where it is first used; this table is for looking one up again. The last column names the Kubernetes Field Guide card with the full reference.

| Term | Meaning | First taught | Field Guide card |
| --- | --- | --- | --- |
| control plane | The components that decide what should run: API server, etcd, scheduler, controller manager. | Ch 5.1 | kube-apiserver |
| node | A machine (or kind container) that runs Pods; it runs a kubelet, a container runtime and kube-proxy. | Ch 5.1 | Node |
| kube-apiserver | The only component that talks to etcd; every read and write goes through its authentication, authorization and admission steps. | Ch 5.1 | kube-apiserver |
| etcd | The key-value store that holds every object; it stays writable while a majority (quorum) of its members agree. | Ch 5.1 | etcd |
| quorum | More than half of the etcd members; 3 members survive 1 failure, 5 survive 2. | Ch 5.1 | etcd |
| object | A record of intent stored by the API: `spec` is what you want, `status` is what the system last observed. | Ch 5.1 | Objects, spec and status |
| admission | The API server step that can change (mutate) or reject (validate) a request after it is authorized. | Ch 5.1 | Admission webhooks |
| resourceVersion | An opaque version string on every object, taken from etcd's revision; clients use it for watches and to detect conflicting writes. | Ch 5.1 | Watch and resourceVersion |
| watch | A long-lived API request that streams ADDED, MODIFIED and DELETED events for a resource. | Ch 5.1 | Watch and resourceVersion |
| controller | A loop that watches objects, compares desired with actual state, and acts to close the gap. | Ch 5.1 | kube-controller-manager and its controllers |
| owner reference | `metadata.ownerReferences`: the link from a child (Pod) to its owner (ReplicaSet); garbage collection deletes orphaned children. | Ch 5.1 | Owner references and garbage collection |
| static Pod | A Pod the kubelet starts from a file in its manifest directory, without the API server; the control plane runs this way under kubeadm. | Ch 5.1 | kubelet |
| mirror Pod | The read-only API copy of a static Pod, so `kubectl get pods` can show it. | Ch 5.1 | kubelet |
| Lease | A small object used for leader election and node heartbeats. | Ch 5.1 | Lease |
| ReplicaSet | Keeps a set number of Pods matching a label selector. | Ch 5.2 | ReplicaSet |
| Deployment | Manages ReplicaSets so a Pod template change rolls out gradually and can be rolled back. | Ch 5.2 | Deployment |
| maxSurge / maxUnavailable | How many Pods a rolling update may add above, or remove below, the desired count at any moment. | Ch 5.2 | Deployment |
| StatefulSet | Runs Pods with stable names (`postgres-0`), ordered start-up and one PersistentVolumeClaim each. | Ch 5.2 | StatefulSet |
| DaemonSet | Runs one Pod on every (matching) node. | Ch 5.2 | DaemonSet |
| Job / CronJob | Run Pods to completion; a CronJob creates Jobs on a schedule. | Ch 5.2 | Job, CronJob |
| Pod phase | The Pod's coarse state: Pending, Running, Succeeded, Failed or Unknown. | Ch 5.2 | Pod lifecycle and probes |
| restartPolicy | What the kubelet does when a container exits: `Always`, `OnFailure` or `Never`. | Ch 5.2 | Pod lifecycle and probes |
| CrashLoopBackOff | A waiting reason, not a phase: the container keeps exiting and the kubelet waits longer before each restart. | Ch 5.2 | Pod lifecycle and probes |
| readiness probe | A check that decides whether a Pod receives Service traffic; failing it removes the Pod from endpoints, no restart. | Ch 5.2 | Pod lifecycle and probes |
| liveness probe | A check that decides whether a container is broken; failing it makes the kubelet restart the container. | Ch 5.2 | Pod lifecycle and probes |
| init container / sidecar | Containers that run before the app (init), or alongside it for the Pod's whole life (sidecar, an init container with `restartPolicy: Always`). | Ch 5.2 | Init and sidecar containers |
| graceful termination | On delete, the kubelet sends SIGTERM, waits `terminationGracePeriodSeconds` (30 s by default), then sends SIGKILL. | Ch 5.2 | Pod lifecycle and probes |
| Service | A stable virtual IP and DNS name in front of the Pods its selector matches. | Ch 5.3 | Service |
| ClusterIP / NodePort / LoadBalancer | Service types: reachable inside the cluster only; also on a port of every node; also through an external load balancer. | Ch 5.3 | Service |
| headless Service | A Service with `clusterIP: None`: DNS returns the Pod IPs directly; StatefulSets use it for names like `postgres-0.postgres`. | Ch 5.3 | Service |
| EndpointSlice | The list of ready and serving Pod IPs behind a Service, written by the EndpointSlice controller. | Ch 5.3 | EndpointSlice |
| kube-proxy | The node agent that turns Services and EndpointSlices into packet rules (iptables in kind). | Ch 5.3 | kube-proxy |
| DNAT | Destination NAT: rewriting a packet's destination address, here from the Service IP to one Pod IP. | Ch 5.3 | kube-proxy |
| conntrack | The kernel's connection table; it remembers each DNAT choice so all packets of a connection reach the same Pod. | Ch 5.3 | kube-proxy |
| CoreDNS | The cluster DNS server; its `kubernetes` plugin answers names of Services and Pods from the API. | Ch 5.3 | CoreDNS and cluster add-ons |
| search list / ndots | `resolv.conf` settings that make short names like `postgres` try `<name>.<namespace>.svc.cluster.local` first. | Ch 5.3 | DNS for Services and Pods |
| ConfigMap | Non-secret configuration, consumed as environment variables or files. | Ch 5.3 | ConfigMap |
| Secret | Configuration for credentials; stored base64-encoded, not encrypted, unless encryption at rest is set up. | Ch 5.3 | Secret |
| downward API | Exposes a Pod's own fields (name, namespace, labels) to its containers. | Ch 5.3 | Downward API and projected volumes |
| volume | A directory a Pod's containers can mount; its type decides how long the data lives. | Ch 5.4 | Volume types |
| PersistentVolume (PV) | A piece of storage in the cluster, with a size, access modes and a reclaim policy. | Ch 5.4 | PersistentVolume |
| PersistentVolumeClaim (PVC) | A request for storage; the PV controller binds it to one PV. | Ch 5.4 | PersistentVolumeClaim |
| StorageClass | Names a provisioner and its settings so a PVC can get a new PV on demand. | Ch 5.4 | StorageClass |
| WaitForFirstConsumer | A binding mode that waits until a Pod using the PVC is scheduled, so the volume is made on that Pod's node. | Ch 5.4 | StorageClass |
| reclaim policy | What happens to a PV after its PVC is deleted: `Delete` or `Retain`. | Ch 5.4 | PersistentVolume |
| access mode | How many nodes may mount a volume and how: `ReadWriteOnce`, `ReadOnlyMany`, `ReadWriteMany`, `ReadWriteOncePod`. | Ch 5.4 | PersistentVolume |
| CSI | Container Storage Interface: the plug-in API that lets any storage system provide volumes. | Ch 5.4 | CNI and CSI plug-ins |
| scheduler (filter, score, bind) | kube-scheduler drops nodes that cannot run the Pod, ranks the rest, then writes `spec.nodeName`. | Ch 5.4 | kube-scheduler |
| requests / limits | Requests reserve CPU and memory for scheduling; limits cap what a container may use. | Ch 5.4 | Requests, limits and QoS |
| taint / toleration | A taint on a node repels Pods; a toleration on a Pod lets it ignore that taint. | Ch 5.4 | Taints, tolerations and affinity |
| node affinity | Pod rules that require or prefer nodes with given labels. | Ch 5.4 | Taints, tolerations and affinity |
| topology spread constraint | A Pod rule that limits how unevenly replicas may sit across nodes or zones. | Ch 5.4 | Topology spread constraints |
| kubeadm | The tool that builds a cluster: certificates, kubeconfig files, static Pod manifests, then add-ons. | Ch 5.5 | kubeadm and cluster bootstrap |
| bootstrap token | A short-lived token a new node uses to join the cluster with `kubeadm join`. | Ch 5.5 | kubeadm and cluster bootstrap |
| certificate authority (CA) | The key pair that signs the cluster's certificates; components trust each other because they trust the CA. | Ch 5.5 | Certificates and trust bundles |
| CRI | Container Runtime Interface: the gRPC API between the kubelet and a runtime such as containerd or CRI-O. | Ch 5.5 | Container runtime (CRI) |
| crictl | The command-line client for any CRI runtime, used on a node when kubectl cannot help. | Ch 5.5 | Container runtime (CRI) |
| Pod sandbox | The shared environment (network namespace, pause container) the runtime creates before a Pod's containers. | Ch 5.5 | Container runtime (CRI) |
| etcd snapshot | A point-in-time copy of the etcd database, taken with `etcdctl snapshot save` and restored with `etcdutl snapshot restore`. | Ch 5.5 | etcd backup and restore |
| cordon / drain | Cordon marks a node unschedulable; drain also evicts its Pods so the node can be serviced. | Ch 5.5 | Node maintenance and eviction |
| eviction | Deleting a Pod through the Eviction API, which honours PodDisruptionBudgets. | Ch 5.5 | Node maintenance and eviction |
| PodDisruptionBudget (PDB) | A floor (`minAvailable`) or ceiling (`maxUnavailable`) on Pods that voluntary evictions may take down at once. | Ch 5.5 | PodDisruptionBudget |

## References

These are the primary sources the chapters quote, all opened on 2026-11-16. Each chapter's Going deeper table adds papers and design documents.

| Source | What it is for | Chapter |
| --- | --- | --- |
| [Kubernetes components](https://kubernetes.io/docs/concepts/overview/components/) | the control-plane and node parts | 5.1 |
| [Objects in Kubernetes](https://kubernetes.io/docs/concepts/overview/working-with-objects/) | spec, status, names, labels | 5.1 |
| [Kubernetes API concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/) | URL layout, watches, resourceVersion | 5.1 |
| [Admission control](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/) | the mutating and validating steps | 5.1 |
| [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/) | the control loop | 5.1, 5.2 |
| [Leases](https://kubernetes.io/docs/concepts/architecture/leases/) | leader election, node heartbeats | 5.1 |
| [Garbage collection](https://kubernetes.io/docs/concepts/architecture/garbage-collection/) | owner references, cascading delete | 5.1, 5.2 |
| [Operating etcd clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) | etcdctl, snapshot, restore | 5.1, 5.5 |
| [etcd FAQ](https://etcd.io/docs/v3.7/faq/) and [etcd disaster recovery](https://etcd.io/docs/v3.7/op-guide/recovery/) | quorum, member counts, restore steps | 5.1, 5.5 |
| [Pod lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) | phases, restarts, probes, termination | 5.2 |
| [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) and [StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/) | rollouts, stable identity | 5.2 |
| [Configure liveness, readiness and startup probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) | probe fields and defaults | 5.2 |
| [Service](https://kubernetes.io/docs/concepts/services-networking/service/) and [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) | Service types, endpoint conditions | 5.3 |
| [Virtual IPs and service proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/) | kube-proxy modes and rules | 5.3 |
| [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) and [CoreDNS kubernetes plugin](https://coredns.io/plugins/kubernetes/) | names, search list, the plugin | 5.3 |
| [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/) and [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) | configuration and credentials | 5.3 |
| [Volumes](https://kubernetes.io/docs/concepts/storage/volumes/), [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/), [Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/) | volume types, binding, reclaim | 5.4 |
| [CSI sidecar containers](https://kubernetes-csi.github.io/docs/sidecar-containers.html) | how a CSI driver is deployed | 5.4 |
| [kube-scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/) and [Scheduling framework](https://kubernetes.io/docs/concepts/scheduling-eviction/scheduling-framework/) | filter, score, bind; plug-ins | 5.4 |
| [Creating a cluster with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/) and [Installing kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/) | Lab 5.5 Parts A and B | 5.5 |
| [Certificate management with kubeadm](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-certs/) | expiry, renewal | 5.5 |
| [Container runtimes](https://kubernetes.io/docs/setup/production-environment/container-runtimes/) | CRI sockets, cgroup driver | 5.5 |
| [Safely drain a node](https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/) and [Disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/) | drain, eviction, PodDisruptionBudgets | 5.5 |
| [Kubernetes glossary](https://kubernetes.io/docs/reference/glossary/) | official definitions of the terms above | all |
| [kind](https://kind.sigs.k8s.io/) | the lab cluster tool | all |

**Versions tested** (2026-11-16): kind v0.33.0 with `kindest/node:v1.37.0`, kubectl v1.37.1, etcd 3.7.0 inside the node, `wallet:v1` and `postgres:17`, on Ubuntu 26.04 (WSL2, Docker Desktop). **Versions targeted:** Kubernetes 1.37 with kubeadm on two Ubuntu 24.04 VMs, and CRI-O for Lab 5.5 Parts A and B; those steps follow the official docs and were not run on the test machine.
