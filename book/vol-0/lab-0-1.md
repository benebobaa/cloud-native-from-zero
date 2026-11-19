# Lab 0.1 · Build Your Lab

## Goal

By the end of this lab you have a Linux machine, a terminal you are comfortable opening, git, and a Kubernetes cluster you can create and destroy in under two minutes.

This lab is mostly installation. It is still the most important lab of the book: every later lab assumes it works.

**Versions tested** (2026-11-16): Ubuntu 24.04 LTS, Docker Engine from Docker's apt repository, kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1. Step 3 and the Checkpoint were run on 2026-11-16 on WSL2 with Docker Desktop: the three-node cluster was Ready in under two minutes.

- [ ] Ubuntu 24.04 is running and you can open a terminal
- [ ] git is installed and knows your name
- [ ] `docker run hello-world` works without `sudo`
- [ ] kubectl and kind are installed
- [ ] A kind cluster starts, shows a Ready node, and is deleted again

### What you will build

{{diagram lab-0-1-01.jsx | what you will build in Lab 0.1}}

## Step 1 · Get Ubuntu 24.04

Everyone in this course works on the same Linux, so instructions and outputs match. Pick the row that matches your laptop.

| Your laptop | Do this | Notes |
| --- | --- | --- |
| Windows 10/11 | WSL2, in PowerShell as Administrator: `wsl --install -d Ubuntu-24.04`, then reboot | Fastest option; Linux runs beside Windows |
| macOS | An Ubuntu 24.04 VM with [Multipass](https://canonical.com/multipass) or UTM | On Apple Silicon you get arm64; use the arm64 downloads below |
| Linux already | Use it if it is Ubuntu 24.04 or 26.04 | Other distributions work, but package commands differ |

**Minimum hardware:** 8 GB RAM, 2 CPU cores, 30 GB free disk. Close your browser tabs during cluster labs.

Open the Ubuntu terminal and check what you are running:

```bash
cat /etc/os-release | head -2
uname -m          # x86_64 means amd64; aarch64 means arm64
ps -p 1 -o comm=  # the first process the system started
```

The last command must print `systemd`. On WSL2, if it prints `init`, enable systemd and restart WSL:

```bash
printf '[boot]\nsystemd=true\n' | sudo tee /etc/wsl.conf
# then, in PowerShell:  wsl --shutdown   and reopen Ubuntu
```

You will learn what process 1 and systemd are in Ch 1.2 and 1.3. For now, it only has to be there.

## Step 2 · Terminal, git and an editor

You will spend most of this course in a terminal, so learn five things now and the rest in Ch 1.1.

| Keys or command | What it does |
| --- | --- |
| `Tab` | Completes a command or file name; press twice to list options |
| `Up` arrow | Brings back the previous command |
| `Ctrl+C` | Stops the running command |
| `Ctrl+R` | Searches your command history |
| `man <command>` | Opens the manual page; press `q` to quit |

Update the system and install git:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
mkdir -p ~/cn-lab && cd ~/cn-lab && git init
```

`~/cn-lab` is your lab notebook for the whole course. Commit your notes, scripts and YAML there after every lab.

**Editor.** Use any editor you like. On Windows, VS Code with the WSL extension edits files inside Ubuntu directly. Also learn the basics of one terminal editor (`nano` is easiest, `vim` is everywhere); you will need it on servers that have no graphical screen.

## Step 3 · Docker, kubectl, kind and your first cluster

kind ("Kubernetes in Docker") runs every Kubernetes node as a Docker container, so a full multi-node cluster fits on one laptop.

**3a. Docker Engine.** Follow Docker's official [Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/) page, apt-repository method. It installs `docker-ce`, `containerd.io` and the buildx and compose plug-ins. Then let your user run Docker without `sudo`:

```bash
sudo usermod -aG docker $USER
newgrp docker            # or log out and back in
docker run hello-world
```

Being in the `docker` group is equivalent to having root on this machine. That is fine on a lab laptop and never acceptable on a shared server; Ch 6.3 explains why.

**3b. kubectl and kind.** Both are single binaries. `ARCH` picks amd64 or arm64 for you.

```bash
ARCH=$(dpkg --print-architecture)
curl -LO "https://dl.k8s.io/release/v1.37.1/bin/linux/${ARCH}/kubectl"
curl -LO "https://dl.k8s.io/release/v1.37.1/bin/linux/${ARCH}/kubectl.sha256"
echo "$(cat kubectl.sha256)  kubectl" | sha256sum --check   # must print: kubectl: OK
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

curl -Lo kind "https://kind.sigs.k8s.io/dl/v0.33.0/kind-linux-${ARCH}"
sudo install -o root -g root -m 0755 kind /usr/local/bin/kind
rm kubectl kubectl.sha256 kind
```

The checksum step proves the file you downloaded is the file the Kubernetes project published. Ch 6.3 builds on this idea for container images.

**3c. A three-node cluster.** Save this as `~/cn-lab/kind-3node.yaml`:

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
  - role: worker
```

Then create the cluster:

```bash
kind create cluster --name lab --image kindest/node:v1.37.0 --config ~/cn-lab/kind-3node.yaml
kubectl get nodes
```

After about a minute, all three nodes report `Ready`:

```text
NAME                STATUS   ROLES           AGE   VERSION
lab-control-plane   Ready    control-plane   60s   v1.37.0
lab-worker          Ready    <none>          40s   v1.37.0
lab-worker2         Ready    <none>          40s   v1.37.0
```

**What just happened.** Run `docker ps`. Each "node" is a container, and inside each one a kubelet and a container runtime run as if it were a real machine. You have used containers to build a fake data centre. By Ch 5.1 you will be able to explain every part of it.

## Checkpoint

You are done when every command below gives the output shown. Paste the outputs into `~/cn-lab/lab-0.1.md` and commit it.

| Command | Expected output contains |
| --- | --- |
| `docker run --rm hello-world` | `Hello from Docker!` |
| `kubectl version --client` | `Client Version: v1.37.1` |
| `kind version` | `kind v0.33.0` |
| `kubectl get nodes` | three nodes, all `Ready` |
| `kubectl get pods -n kube-system` | Pods whose names start with `etcd`, `kube-apiserver`, `kube-scheduler`, `kube-controller-manager`, `coredns`, `kube-proxy`, all `Running` |
| `kind delete cluster --name lab` | `Deleting cluster "lab" ...` |

Look at the `kube-system` Pod names: the control-plane parts from the stack map are running there as Pods. Write one line in your notebook on what you think each one does. You will also see kindnet Pods, one per node: that is kind's own simple network plug-in (a CNI). You will check your guesses in Ch 5.1.

## Break it

Create the cluster again, then stop Docker and ask Kubernetes for its nodes:

```bash
sudo systemctl stop docker docker.socket
kubectl get nodes
```

1. Read the whole error message. Which address and port is kubectl trying to reach? Find the same address in `~/.kube/config`.
2. Explain, using the stack map, why stopping Docker breaks Kubernetes here. Which layer did you remove?
3. Start Docker again with `sudo systemctl start docker`. Does the cluster come back by itself? Record what you see; Ch 5.5 explains it.

## Troubleshooting

Most setup problems are one of these. Fix the first that matches, then rerun the step that failed.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pods fail with `too many open files` on a multi-node kind cluster | Ubuntu's default inotify limits (128 instances) are too low for several nodes ([kind known issues](https://kind.sigs.k8s.io/docs/user/known-issues/)) | `sudo sysctl fs.inotify.max_user_watches=524288` and `sudo sysctl fs.inotify.max_user_instances=512`; add both lines to `/etc/sysctl.conf` to keep them after a reboot |
| Cluster is slow or nodes are killed on WSL2 | WSL2 gives Linux only part of the host's memory by default | Create `C:\Users\<you>\.wslconfig` with `[wsl2]` and `memory=6GB`, then `wsl --shutdown` in PowerShell |
| kind fails on WSL2 with `error adding pid ... to cgroups` | Some WSL2 kernels set up cgroups differently from a normal Linux | Follow the fix kind links to ([wsl-cgroupsv2](https://github.com/spurin/wsl-cgroupsv2)); the kind team cannot support WSL itself |
| macOS VM too small | Multipass creates a small VM by default | `multipass launch 24.04 --name cn-lab --cpus 2 --memory 6G --disk 30G` |
| `permission denied` on `/var/run/docker.sock` in a new terminal | `newgrp docker` only affects the terminal you ran it in | Log out and back in (on WSL2: `wsl --shutdown`, reopen Ubuntu) |
| `apt upgrade` stops on a screen about restarting services | Ubuntu's `needrestart` asks which services to restart | Press Enter to accept the defaults |
| `curl` cannot resolve `release-assets.githubusercontent.com` when downloading kind | A campus or company network blocks GitHub's download host | Install with Go instead: `go install sigs.k8s.io/kind@v0.33.0`, or download on another network |
| You already use Docker Desktop on Windows | Not a problem | Enable WSL integration for your Ubuntu in Docker Desktop → Settings → Resources; this lab was tested that way |
