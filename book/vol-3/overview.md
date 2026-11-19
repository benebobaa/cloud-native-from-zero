# Cloud Native from Zero · Vol 3: Distributed Systems

Volume 3 takes three weeks. It teaches why distributed systems are hard and how consensus and control loops tame them; these are the ideas Kubernetes is built on.

## Outcomes

After three weeks you can explain why a cluster of machines fails differently from one machine, and you can run, break and measure the two mechanisms Kubernetes uses to cope: a consensus store and control loops.

1. Name the eight fallacies of distributed computing and say which one a given outage violated.
2. Explain why a slow machine and a dead machine look identical from the outside, and what that forces every protocol to do.
3. State CAP as Gilbert and Lynch proved it, add PACELC, and place a real system on both with evidence.
4. Draw Raft leader election and log replication from memory, and compute quorum sizes for any cluster.
5. Run a real three-node etcd cluster, kill its leader and measure the election time against the election timeout.
6. Explain level-triggered versus edge-triggered control, and why Kubernetes chose level-triggered.
7. Write a reconcile loop that keeps N wallet processes alive, and defend it in a written partition analysis built from your own measurements.

## Chapter map

Chapter 3.1 explains what can go wrong, Chapter 3.2 shows how a cluster agrees despite that, and Chapter 3.3 shows how Kubernetes-style loops use the agreed state to repair the system.

{{diagram overview-01.jsx | Vol 3 chapter map · 3 chapters, 1 milestone}}

## Prerequisites and versions

You need Vol 1 (processes, signals, exit codes), Vol 2 (IP addresses, ports, TCP, DNS) and a working Docker from Lab 0.1.

Docker is only a lab tool here: it gives you cheap throwaway machines that share a virtual network. You will use five commands (`docker run`, `exec`, `kill`, `logs`, `rm`), each taught in Chapter 3.1. Vol 4 explains how containers really work.

**Versions tested** (2026-11-16, Docker Desktop on WSL2, Ubuntu 26.04 host): Docker Engine 29.9.2, etcd v3.7.3 (`quay.io/coreos/etcd:v3.7.3`), Postgres 17, wallet image `wallet:v1` (built from `wallet/`), Alpine 3.21 with iproute2 6.11.0 (`tc`) and nftables 1.1.1 (`nft`), Python 3.14.4 for the lab scripts. The scripts use only the Python standard library, so Python 3.12 on Ubuntu 24.04 runs them too; that exact combination was not run.

**Versions targeted:** Ubuntu 24.04 LTS with Docker Engine from Docker's apt repository. Kubernetes 1.37 itself depends on etcd 3.7.0 ([build/dependencies.yaml](https://raw.githubusercontent.com/kubernetes/kubernetes/v1.37.1/build/dependencies.yaml)), so the etcd you run in Lab 3.2 is the same major version a 1.37 cluster uses.

**Machine note.** The labs run up to ten small containers at once (three etcd members, Postgres, the wallet and a few helpers). Stop other Docker projects first: election-timing results are noisier on a busy laptop.
