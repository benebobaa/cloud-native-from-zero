# Glossary & References

## Glossary

Terms are listed in the order you meet them. The last column says where each is taught.

| Term | Meaning | Where |
| --- | --- | --- |
| Image | A stack of layers, a config and a manifest that together describe a container's files and start command | Ch 4.1 |
| Layer | A tar archive of the filesystem changes made by one build step | Ch 4.1 |
| Manifest, config, image index | The manifest lists the config and the layers by digest; the config holds the start command and user; the index lists one manifest per platform | Ch 4.1 |
| Digest | The SHA-256 hash of a blob's bytes, written `sha256:` and 64 hexadecimal characters | Ch 4.1 |
| Content addressing | Naming a blob by its hash, so identical content is stored and sent once and cannot change unnoticed | Ch 4.1 |
| Tag | A movable name that points at an image; not part of the image | Ch 4.1 |
| Registry | A web server that stores and serves blobs and manifests under the OCI distribution API | Ch 4.1 |
| OCI | The Open Container Initiative: three specifications for the image, its distribution and its runtime | Ch 4.1 |
| Multi-stage build | A Dockerfile with several `FROM` steps, where only the last stage's files are shipped | Ch 4.1 |
| Build cache | Reuse of a layer when its instruction and inputs are unchanged | Ch 4.1 |
| Distroless | An image with only the application and its runtime, no shell and no package manager | Ch 4.1 |
| Writable layer | The container's own top layer; deleted with the container | Ch 4.1 |
| Bundle | A directory with a root filesystem and a `config.json`: the input of an OCI runtime | Ch 4.2 |
| runc | The reference OCI runtime: it turns a bundle into a process | Ch 4.2 |
| containerd | A high-level runtime daemon that stores images and manages container state; serves the CRI | Ch 4.2 |
| CRI-O | A runtime built for the CRI | Ch 4.2 |
| CRI | The Container Runtime Interface: the gRPC API between the kubelet and a runtime | Ch 4.2 |
| Shim | A small process, one per Pod, that stays as the parent of the container's processes so the daemon can restart | Ch 4.2 |
| Pod sandbox | The shared environment a Pod's containers run in; a `/pause` process in this lab | Ch 4.2 |
| Snapshotter | The containerd part that turns layers into directories, one snapshot per layer | Ch 4.2 |
| containerd namespace | A label that separates users of one containerd; Kubernetes uses `k8s.io` | Ch 4.2 |
| Runtime handler, RuntimeClass | The name of a runtime configured on a node; the Kubernetes object that lets a Pod choose one | Ch 4.2 |
| gVisor, Sentry | A runtime (`runsc`) built around a kernel written in Go that runs in user space | Ch 4.2 |
| Kata Containers | A runtime that runs each Pod in a lightweight virtual machine | Ch 4.2 |
| Rootless | Running a container runtime without root privileges, with user namespaces | Ch 4.2 |
| User-defined bridge | A Docker network with automatic DNS by container name | Ch 4.3 |
| Published port | A container port opened on the host with `-p` or `ports:` | Ch 4.3 |
| Internal network | A Compose network with no route to the outside | Ch 4.3 |
| Named volume, bind mount, `tmpfs` | Storage outside the container's layers: managed by Docker, a host path, or memory | Ch 4.3 |
| `memory.max`, OOM kill | The cgroup memory limit, and the kernel killing a process that crosses it (exit status 137) | Ch 4.3 |
| `cpu.max`, throttling | The cgroup CPU limit, and the kernel pausing a process that exceeds it | Ch 4.3 |
| Health check | A command Docker runs inside a container on a timer; statuses `starting`, `healthy`, `unhealthy` | Ch 4.3 |
| Restart policy | A rule that starts a container again when it exits by itself | Ch 4.3 |
| `depends_on` with `service_healthy` | Compose waits for a dependency's health check before it starts a service | Ch 4.3 |
| Least privilege | Giving a process only the rights it needs: non-root user, read-only root, no capabilities, no new privileges | Ch 4.3 |

## References and versions tested

**Versions tested** (2026-11-16 and 2026-11-17, Docker Desktop on WSL2, Ubuntu 26.04): Docker Engine 29.9.2 with the containerd image store, Compose v5.6.1, `kindest/node:v1.37.0` with runc 1.4.3, containerd v2.3.4 and crictl v1.36.0, nerdctl v2.4.2 (built from source), gVisor release-20261109.0, `python:3.12-slim`, `python:3.12-alpine`, `gcr.io/distroless/python3-debian13:nonroot`, `postgres:17`, `registry:2`. Not run: Kata Containers, a native Docker or containerd install with `apt`, a kubelet-driven cluster. Measured data is in `reference/`: `vol4-runtime-bench-2026-11-17.csv`, `vol4-oom-64m-2026-11-17.csv`, `vol4-cpu-limit-2026-11-17.csv`.

| Source | Used for | Checked |
| --- | --- | --- |
| [OCI image spec](https://github.com/opencontainers/image-spec), [distribution spec](https://github.com/opencontainers/distribution-spec), [runtime spec](https://github.com/opencontainers/runtime-spec/blob/main/runtime.md) | Image layout, the registry API, and the container states | 2026-11-17 |
| [opencontainers.org](https://opencontainers.org/about/overview/) and [runc README](https://github.com/opencontainers/runc) | The OCI's role, runc, bundles and rootless mode | 2026-11-17 |
| [Kubernetes: CRI](https://kubernetes.io/docs/concepts/architecture/cri/), [Container runtimes](https://kubernetes.io/docs/setup/production-environment/container-runtimes/), [RuntimeClass](https://kubernetes.io/docs/concepts/containers/runtime-class/), [Images](https://kubernetes.io/docs/concepts/containers/images/), [Garbage collection](https://kubernetes.io/docs/concepts/architecture/garbage-collection/), [dockershim removal](https://kubernetes.io/blog/2022/02/17/dockershim-faq/) | The CRI, the cgroup driver rule, RuntimeClass, image pull and cleanup, and the dockershim | 2026-11-17 |
| [containerd](https://containerd.io/) and [getting started](https://github.com/containerd/containerd/blob/main/docs/getting-started.md), [CRI-O](https://cri-o.io/), [cri-tools: crictl](https://github.com/kubernetes-sigs/cri-tools/blob/master/docs/crictl.md) | The runtimes, containerd namespaces, and which client tool does what | 2026-11-17 |
| [gVisor](https://gvisor.dev/docs/), [Kata Containers](https://katacontainers.io/) | The Sentry and Gofer; Kata's VM-per-Pod design | 2026-11-17 |
| CNCF: [containerd](https://www.cncf.io/projects/containerd/), [CRI-O](https://www.cncf.io/projects/cri-o/), [Harbor](https://www.cncf.io/projects/harbor/), [projects list](https://www.cncf.io/projects/), [sandbox list](https://www.cncf.io/sandbox-projects/) | Maturity levels and dates in the project cards | 2026-11-17 |
| [NVD: CVE-2019-5736](https://nvd.nist.gov/vuln/detail/CVE-2019-5736) | The runc escape quoted in Ch 4.2's production table | 2026-11-17 |
| [Docker: build cache](https://docs.docker.com/build/cache/), [multi-stage builds](https://docs.docker.com/build/building/multi-stage/), [Docker Hub pull limits](https://docs.docker.com/docker-hub/usage/pulls/) | Image building and registry limits | 2026-11-16 |
| [Docker: bridge networks](https://docs.docker.com/engine/network/drivers/bridge/), [resource constraints](https://docs.docker.com/engine/containers/resource_constraints/), [restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/), [Dockerfile HEALTHCHECK](https://docs.docker.com/reference/dockerfile/), [Compose services](https://docs.docker.com/reference/compose-file/services/), [Compose networks](https://docs.docker.com/reference/compose-file/networks/) | Ch 4.3's networks, limits, health checks, restart policies and Compose keys | 2026-11-17 |
| [Linux kernel: cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html), [seccomp filter](https://www.kernel.org/doc/html/latest/userspace-api/seccomp_filter.html) | `memory.max`, `cpu.max`, and the system call filter | 2026-11-17 |
