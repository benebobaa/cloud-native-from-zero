# 1 · Architecture

## How the architecture cards fit together

{{diagram g01-architecture-01.jsx | Cluster architecture · control plane, node, add-ons}}
The control plane decides, the node components execute, and everything meets at the API server. Chapters 5.1 (components), 5.4 (scheduler and runtime interfaces), 5.3 (kube-proxy, DNS) and 5.5 (cluster operations) teach these eleven cards.

| Card | One-line job | Chapter | Exam domain |
| --- | --- | --- | --- |
| kube-apiserver | The only front door to cluster state | 5.1, 5.5 | CKA Troubleshooting: cluster components |
| etcd | Consistent store behind the API server | 3.2, 5.5 | CKA Cluster Architecture: highly available control plane, cluster lifecycle |
| kube-scheduler | Chooses a node for each new Pod; its Binding is the object it writes | 5.4 | CKA Troubleshooting: cluster components |
| kube-controller-manager and its controllers | Control loops for built-in objects | 5.1, 5.5 | CKA Troubleshooting: cluster components |
| cloud-controller-manager | Cloud-specific control loops | 5.1, 5.5 | CKA Troubleshooting: cluster components |
| kubelet | Runs Pods on one node | 5.1, 5.5 | CKA Troubleshooting: cluster components, clusters and nodes |
| kube-proxy | Programs Service rules on each node | 5.1, 5.5 | CKA Troubleshooting: cluster components |
| Container runtime (CRI) | Starts the containers | 4.2, 5.4 | CKA Cluster Architecture: extension interfaces (CNI, CSI, CRI) |
| CNI and CSI plug-ins | Pod network and storage hooks | 2.5, 4.2, 5.4, 6.1 | CKA Cluster Architecture: extension interfaces; Services and Networking: Pod connectivity |
| CoreDNS and cluster add-ons | In-cluster DNS | 5.3 | CKA Services and Networking: CoreDNS |
| kubeadm and cluster bootstrap | Builds and upgrades a cluster | 3.2, 5.5 | CKA Cluster Architecture: prepare infrastructure, kubeadm, highly available control plane |

All eleven cards also fall under the KCNA Kubernetes Fundamentals domain (groups 1 to 3, Vol 5).
