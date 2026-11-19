# Glossary & References

## Glossary

Every term below is defined where it first appears in Vol 1; the last column says where. Terms are in alphabetical order.

| Term | Meaning | Chapter |
| --- | --- | --- |
| `apt` and `dpkg` | `apt` finds packages in repositories and resolves dependencies; `dpkg` unpacks one `.deb` file and records what it installed | 1.4 |
| bounding set | The capabilities a process can never get back, not even by running a program as root | 1.5 |
| capability | One named slice of root's power, such as `CAP_NET_BIND_SERVICE`; a process carries a set of them | 1.5 |
| cgroup (control group) | A directory in `/sys/fs/cgroup` with limit and counter files for a group of processes | 1.5 |
| `chroot` | Changes where `/` starts for one process; it is not a security boundary | 1.5 |
| container | An ordinary process in its own namespaces and cgroup, with fewer capabilities and an unpacked image as `/` | 1.5 |
| cron | A scheduler that runs the lines of a crontab at fixed times | 1.3 |
| exit code | The number a program returns when it ends; `0` means success | 1.1 |
| file descriptor | A numbered channel for reading or writing; 0 is stdin, 1 is stdout, 2 is stderr | 1.1 |
| hard link and symbolic link | Two names for one inode, and a small file that holds another file's path | 1.3 |
| host key and fingerprint | The server's key that proves its identity to SSH clients, and the short hash of it you compare | 1.4 |
| inode | The record of a file's owner, mode, size and data location; directory entries point to inodes | 1.3 |
| journal | systemd's log store, read with `journalctl` | 1.3 |
| kernel | The part of the operating system that manages hardware and enforces isolation; programs ask it through system calls | 1.2 |
| load average | The average number of tasks running or waiting, including tasks waiting for disk on Linux | 1.4 |
| mount | Attaching a filesystem at a directory of the one file tree | 1.1, 1.3 |
| namespace | A wrapper that gives a process its own copy of one global resource, such as process IDs or the hostname | 1.5 |
| `no_new_privs` | A flag that makes running a program never add privileges, so setuid programs lose their effect | 1.5 |
| OOM killer | The kernel's last resort: it kills a process when memory runs out, in the whole machine or inside one cgroup | 1.2, 1.5 |
| `OOMKilled` | The Kubernetes status of a container whose cgroup hit `memory.max` and lost a process to the OOM killer | 1.5 |
| OverlayFS | A filesystem that shows read-only lower layers and one writable upper layer as one merged directory | 1.3 |
| package and repository | An archive of files with metadata, and a signed server that offers packages | 1.4 |
| path | The name of a place in the file tree; absolute paths start at `/` | 1.1 |
| permission bits | The nine `rwx` bits for owner, group and others on every file | 1.1 |
| PID 1 | The first process of a system or of a PID namespace; it acts as `init` and gets no default signal handlers | 1.2, 1.5 |
| pipe | A connection from one program's stdout to the next program's stdin | 1.1 |
| `pivot_root` | Swaps the whole mount tree of a mount namespace, so the old root can be unmounted | 1.5 |
| process | A running program with its own memory, process ID and open files | 1.2 |
| PSI (pressure stall information) | Kernel counters in `/proc/pressure` for the time tasks stall waiting for CPU, memory or I/O | 1.4 |
| public and private key | A key pair: the private half proves who you are and never leaves your machine; the public half goes to servers | 1.4 |
| root filesystem | The directory a container uses as `/`, for example an unpacked Alpine image | 1.5 |
| rootless container | A container whose runtime runs as an ordinary user and uses a user namespace for root inside | 1.5 |
| saturation | Work that waits because a resource is full; the S of USE | 1.4 |
| seccomp | A filter on system calls that the kernel runs for every call; a call not on the list fails | 1.5 |
| `set -euo pipefail` | Bash settings that stop a script at the first error, at an unset variable and at a failure inside a pipe | 1.4 |
| signal | A message to a process: `SIGTERM` asks it to stop and can be handled, `SIGKILL` cannot | 1.2 |
| sticky bit | On a directory such as `/tmp`: each user may delete only their own files | 1.1 |
| system call | A request from a program to the kernel, such as `open`, `fork` or `write` | 1.2 |
| systemd and unit | The first process (PID 1) of a Linux machine, and the file that describes one thing it manages | 1.3 |
| throttling | How `cpu.max` limits a cgroup: once the quota of a period is used, its processes wait | 1.5 |
| UID and GID | The numbers by which the kernel knows users and groups; UID 0 is root | 1.1 |
| USE method | Check every resource for Utilization, Saturation and Errors before you guess | 1.4 |
| user namespace | A namespace with its own table of user IDs, linked to the outside by a map; root inside can be an ordinary user outside | 1.5 |
| virtual memory | The address space each process sees; the kernel maps its pages to real memory or disk | 1.2 |
| whiteout | A character device in the upper layer of an overlay that hides a file of a lower layer | 1.3 |
| zombie | A finished process whose parent has not yet collected its exit code | 1.2 |

## References and versions

The full reading list of each chapter is its Going deeper table. These are the sources the facts of Vol 1 rest on, by chapter.

| Chapter | Source | What it backs |
| --- | --- | --- |
| 1.1 | Ritchie and Thompson, [The UNIX Time-Sharing System](https://dl.acm.org/doi/10.1145/361011.361061); [Filesystem Hierarchy Standard 3.0](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html) | Files, directories, the top-level layout |
| 1.4 | [The USE Method](https://www.brendangregg.com/usemethod.html) and its [Linux checklist](https://www.brendangregg.com/USEmethod/use-linux.html); [Pressure Stall Information](https://docs.kernel.org/accounting/psi.html); [BashFAQ/105](https://mywiki.wooledge.org/BashFAQ/105); [sources.list(5)](https://manpages.debian.org/trixie/apt/sources.list.5.en.html) | USE, PSI, why `set -e` has holes, the deb822 repository format |
| 1.5 | [namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html), [user\_namespaces(7)](https://man7.org/linux/man-pages/man7/user_namespaces.7.html), [pid\_namespaces(7)](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html), [capabilities(7)](https://man7.org/linux/man-pages/man7/capabilities.7.html) | The eight namespaces, the user ID map, PID 1 rules, capability sets |
| 1.5 | [Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html); [chroot(2)](https://man7.org/linux/man-pages/man2/chroot.2.html); [pivot\_root(2)](https://man7.org/linux/man-pages/man2/pivot_root.2.html); [seccomp(2)](https://man7.org/linux/man-pages/man2/seccomp.2.html) | `memory.max`, `cpu.max`, why `pivot_root` is the safe one, system call filters |
| 1.5 and Milestone | [systemd.exec(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), [systemd.resource-control(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html); Kubernetes [cgroup v2](https://kubernetes.io/docs/concepts/architecture/cgroups/) and [user namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/) | Every sandbox and limit setting of the hardened wallet, and where the same features appear in Pods |

**Versions tested.** Each lab states its own versions line. Summary of the test machine (Ubuntu 26.04 on WSL2, kernel 6.18, cgroup v2, systemd 259), 2026-11-16 and 2026-11-17:

| Lab | Tools tested |
| --- | --- |
| 1.1, 1.2 | See the Versions line of each lab |
| 1.3 | systemd 259; cron from Ubuntu (the cron line was not run) |
| 1.4 | bash 5.3.9, OpenSSH 10.2p1, sysstat 12.7.7, procps-ng 4.0.4, iproute2 6.19, ShellCheck 0.11.0, lsof 4.99.4, Python 3.14 |
| 1.5 and Milestone 1 | util-linux 2.41.3, libcap2-bin 2.75, bash 5.3, Docker 29.9.2 (Docker Desktop), Alpine 3.21.10 with BusyBox 1.37.0, Python 3.12.16 in `python:3.12-alpine` |

**Not run in Vol 1:** the Ubuntu 24.04 AppArmor setting for user namespaces (Lab 1.5 Part 0), a native Docker Engine, `sar` (Lab 1.4), and every `sudo` step. Ubuntu 24.04 LTS is the target; the test machine runs 26.04, where `coreutils` and `sudo` are Rust rewrites and a few messages are worded differently.
