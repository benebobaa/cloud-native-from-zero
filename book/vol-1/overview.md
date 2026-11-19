# Cloud Native from Zero · Vol 1: Linux and the Operating System

Volume 1 takes five weeks. It teaches the Linux that every container and every Kubernetes node is built on, ending with a container you build from raw kernel features.

## Outcomes

After five weeks you can operate a Linux server from a terminal and explain the kernel features that make containers possible.

1. Use the shell, pipes and redirection to answer questions about a system in one line.
2. Read and set file permissions, and explain why a secret file is `0600`.
3. Explain what a process is, what a system call is, and trace one with `strace`.
4. Explain virtual memory and the OOM killer, and predict which process the kernel kills first.
5. Run any program as a systemd service that restarts on failure, and read its logs.
6. Find the cause of a slow machine with the USE method instead of guessing.
7. Build a working container from namespaces, cgroups and `pivot_root`, with no Docker involved.

## Chapter map

Chapters 1.1 to 1.4 each teach one part of Linux; Chapter 1.5 combines them into a container, and the milestone runs the wallet inside it.

{{diagram overview-01.jsx | Vol 1 chapter map · 5 chapters, 1 milestone}}

## Prerequisites and versions

You need only a finished Lab 0.1: Ubuntu running, git set up, and `~/cn-lab` as your notebook.

**Versions targeted** (checked 2026-11-16): Ubuntu 24.04 LTS with its default kernel and cgroup v2, Python 3 from Ubuntu (3.12 on 24.04), bash, coreutils, systemd and strace from Ubuntu's packages. Commands also work on Ubuntu 26.04, which replaces GNU coreutils and sudo with Rust rewrites (uutils coreutils, sudo-rs); an error message may be worded slightly differently.
