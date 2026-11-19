# Cloud Native from Zero · Vol 4: Containers

Volume 4 takes three weeks. It turns the hand-built container from Ch 1.5 into industry-standard images and runtimes.

## Outcomes

After three chapters you can build, inspect, run and defend a container image, and you know which program does what between `docker run` and a Kubernetes node.

1. **Open an image.** Explain an image as a stack of content-addressed layers plus a manifest and a config, and find each of them in a `docker save` archive and in a registry's HTTP API.
2. **Shrink an image with evidence.** Cut the wallet image from 209 MB to 102 MB on disk (51.6 MB to 25.4 MB to pull) and say what each step cost, from numbers you measured yourself.
3. **Run a container without Docker.** Start the wallet's image from a bare OCI bundle with runc, then with containerd and nerdctl, and name the Linux features from Ch 1.5 that each one set up.
4. **Name the chain.** Describe what the kubelet, the CRI, containerd or CRI-O, and an OCI runtime (runc, gVisor, Kata Containers) each do, and look at a node's containers with `crictl`.
5. **Compose an application.** Run the wallet as three services with health checks, memory and CPU limits, a restart policy, a private network and a volume, and show that each of them works by breaking it.
6. **Choose a runtime.** Pick between a shared-kernel runtime, a user-space kernel and a micro-VM for a given risk, and say what you pay for it.
7. **Read the symptoms.** Explain exit code `137`, `OOMKilled`, an `unhealthy` container and a 10-second shutdown from what the kernel and the runtime did.

## Chapter map

Chapter 4.1 opens the image, 4.2 opens the program that starts it, and 4.3 joins several containers into one application; Milestone 4 grades the result on the wallet.

{{diagram overview-01.jsx | Vol 4 chapter map · 3 chapters, 1 milestone}}
Each chapter reuses the one before: the layers from 4.1 are what containerd unpacks in 4.2, and the runtime from 4.2 is what Compose and, later, the kubelet ask to start your containers in 4.3.

## Prerequisites and versions tested

You need Vol 1 (above all Ch 1.5, namespaces and cgroups), the wallet v1 from Vol 3 (`wallet/`: API, worker, Postgres), and Docker with Compose v2 on your Ubuntu 24.04 machine or WSL2. About 6 GB of free disk and 8 GB of RAM are enough; every lab removes what it creates.

**Versions tested** (2026-11-16, Docker Desktop 4.96.3 on WSL2, Ubuntu 26.04): Docker Engine 29.9.2 with the containerd image store and Compose v5.6.1; `python:3.12-slim` (Python 3.12.16, Debian 13); Postgres 17.11; runc 1.4.3, containerd v2.3.4 and crictl v1.36.0 as shipped in `kindest/node:v1.37.0`; nerdctl v2.4.2; crane v0.22.1; gVisor `runsc` release-20261109.0. **Not run:** Kata Containers (a micro-VM runtime needs its own hypervisor, guest kernel and containerd shim, and its release files could not be downloaded on the test network), Docker Engine installed natively with apt, and any step that needs `sudo`. Image sizes depend on the Docker version: Docker 29 with the containerd image store reports the compressed blobs plus the unpacked layers as `DISK USAGE`, so your numbers for the same Dockerfile can differ by a few MB.
