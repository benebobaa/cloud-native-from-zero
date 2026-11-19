# Cloud Native from Zero · Vol 2: Networking

Volume 2 takes five weeks. It teaches networking from Ethernet frames to TLS, ending with a container network you wire by hand from Linux primitives.

## Outcomes

After five weeks you can follow one request from your terminal to the wallet, name every layer it crosses, and rebuild the network that carries it from Linux parts.

1. Name the layers a wallet request passes through (Ethernet, IP, TCP, TLS, HTTP) and say which header each one adds.
2. Read a `tcpdump` capture and point at the ARP exchange, the TCP handshake, a DNS query and a TLS Client Hello.
3. Plan subnets with CIDR, and predict which route the kernel picks (longest prefix wins).
4. Explain NAT and connection tracking, and tell "connection refused" from "timed out" from "hangs on large responses" (a path-MTU black hole).
5. Explain why one TCP stream slows down with distance and with packet loss, using numbers you measured.
6. Run your own certificate authority and serve the wallet at `https://wallet.lab.test`, resolved by a DNS server you configured.
7. Build a container network from network namespaces, veth pairs, a bridge, nftables and a VXLAN overlay, and call the same plugin interface (CNI) that Kubernetes uses.
8. Find where a packet disappears by capturing at each hop, instead of guessing.

## Chapter map

Chapters 2.1 to 2.4 each teach one layer, from the wire up to the application; Chapter 2.5 turns them into Linux objects you wire by hand, and the milestone serves the wallet over HTTPS through them.

{{diagram overview-01.jsx | Vol 2 chapter map · 5 chapters, 1 milestone}}
## Prerequisites and versions

You need a finished Volume 1 (above all Ch 1.5, namespaces) and the wallet v0 file from Lab 1.1 in `~/cn-lab`. Every lab runs as root, in one of two places:

| Where | How | Status in this book |
| --- | --- | --- |
| A throwaway privileged container (recommended, nothing touches your real network) | `mkdir -p ~/cn-lab && docker run -it --rm --privileged -v ~/cn-lab:/root/cn-lab --name cnlab-vol2 ubuntu:24.04 bash`, then `apt-get update` and install the tools each lab lists. The option -v keeps your \~/cn-lab folder (notebooks, wallet, certificates, scripts) on your own machine, so that it survives the container | Tested |
| An Ubuntu 24.04 VM, a WSL2 distribution or a native install | the same commands after `sudo -i` | Targeted, same commands, not run |

Lab 2.5 uses two "hosts": two containers on one Docker network, or two VMs. Docker itself is taught in Vol 4; here it is only a disposable room for root.

**Versions tested** (2026-11-16): a privileged `ubuntu:24.04` container on Docker Desktop with WSL2, kernel 6.18.58.1-microsoft-standard-WSL2. Tools from Ubuntu 24.04's own packages: iproute2 6.1.0, tcpdump 4.99.4, nftables 1.0.9, nginx 1.24.0, dnsmasq 2.91, OpenSSL 3.0.13, Python 3.12.3, curl 8.5.0, iperf3 3.16, tshark 4.2.2, conntrack-tools 1.4.8, dig 9.18.39, reference CNI plugins 1.1.1.

**Versions targeted:** Ubuntu 24.04 LTS with its default 6.8 kernel (not run). Commands also work on Ubuntu 26.04, which ships Rust rewrites of sudo and coreutils; messages may be worded slightly differently. MAC addresses, PIDs, ports and timings in the outputs will differ on your machine; the shapes will not. Throughput numbers come from virtual links inside one VM: only their shape transfers to your laptop.
