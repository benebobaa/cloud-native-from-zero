# Cloud Native from Zero · Vol 5: Kubernetes Core

Volume 5 takes five weeks. It teaches Kubernetes from its API and control plane to running and repairing a cluster.

## Outcomes

After five weeks you can run the wallet on Kubernetes, explain what each cluster component did to get it there, and repair a cluster when a part breaks.

1. Name every control-plane and node component, and say which one acts, in which order, after `kubectl apply`.
2. Read a Kubernetes object straight out of etcd, and explain `resourceVersion`, watches and the controller loop.
3. Run the wallet with Deployments and a StatefulSet, roll out a new version, and roll a bad one back.
4. Write readiness and liveness probes that tell "not ready yet" apart from "broken".
5. Trace a packet sent to a Service IP through kube-proxy's iptables rules to one Pod, and find why a Service has no endpoints.
6. Give Postgres a PersistentVolume that survives Pod deletion, and explain from the scheduler's events why a Pod is `Pending`.
7. Build a cluster with kubeadm, back up and restore etcd, check certificate expiry, and drain a node without dropping requests.

## Chapter map

Each chapter teaches one layer of Kubernetes and adds objects to the wallet; Milestone 5 grades the finished set.

{{diagram overview-01.jsx | Vol 5 chapter map · 5 chapters, 1 milestone}}

Read each row left to right: the chapter on the left, what its lab adds to the wallet on the right. Ch 5.5 also builds a real cluster with kubeadm, which kind did for you in Ch 5.1 to 5.4.

## Prerequisites and versions

You need Vol 4 finished: Docker working, the `wallet:v1` image built from `wallet/`, and a kind cluster created once in Lab 0.1. Vol 2 (IP addresses, NAT, DNS) and Vol 3 (leader election and quorum) are used in Ch 5.3 and Ch 5.1.

| Item | Version | Where it is used |
| --- | --- | --- |
| Kubernetes | 1.37 ([releases](https://kubernetes.io/releases/)) | all chapters |
| kind / node image | v0.33.0 / `kindest/node:v1.37.0` | Labs 5.1 to 5.5, Milestone 5 |
| kubectl | v1.37.1 | all labs |
| etcd (inside the kind node) | 3.7.0, read from the running static Pod | Labs 5.1 and 5.5 |
| wallet | `wallet:v1` + `postgres:17` | Labs 5.2 to 5.4, Milestone 5 |
| Ubuntu | 24.04 LTS (native, VM or WSL2), 8 GB RAM | all labs |
| 2 small Ubuntu 24.04 VMs | 2 vCPU and 2 GB RAM each, the kubeadm minimum ([kubeadm install](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/)) | Lab 5.5 Part D only |

**Versions tested** (2026-11-16) for every kind step, on Ubuntu 26.04 under WSL2 with Docker Desktop. The kubeadm-on-VMs and CRI-O steps of Lab 5.5 are **versions targeted**: they follow the official docs and were not run on this test machine. Each lab states exactly which of its steps were run.

**One Docker quirk.** `kind load docker-image` can fail with a content-digest error (`content digest ... not found`). On Docker Desktop it failed for every image on the test machine. On plain Docker Engine 29.10.0 from Docker's apt repository (tested 2026-11-19) it worked for `wallet:v1`, which you build yourself, and failed for images Docker pulled, such as `postgres:17`. Each lab therefore uses a pipe that works in every case: `docker save <image> | docker exec -i <node> ctr -n k8s.io images import -`.

**Certification point.** The optional KCNA exam fits after week 22, when this volume ends. CKA and CKAD come after week 28 ([CNCF curriculum](https://github.com/cncf/curriculum)).
