# Glossary & References

## Glossary

Every term below is defined where it first appears; the chapter column says where.

| Term | Definition | Chapter |
| --- | --- | --- |
| 5-tuple | Protocol, source IP, source port, destination IP, destination port: the key that names one connection | 2.3 |
| ACME | Protocol (RFC 8555) that lets a CA check that you control a domain and issue a certificate automatically | 2.4 |
| ADD, DEL, CHECK, VERSION, GC | The CNI commands: attach a container, detach it, check the attachment, list spec versions, clean up stale resources | 2.5 |
| Ageing time | How long a bridge keeps a learned MAC address without seeing it again | 2.1 |
| ALPN | TLS extension in which client and server agree on the application protocol, such as `h2` | 2.4 |
| ARP | Address Resolution Protocol: asks "who has this IPv4 address?" on a link and learns the owner's MAC | 2.1 |
| Authoritative server | DNS server that holds a zone's records and answers for them | 2.4 |
| Autonomous system (AS) | A network under one administration that exchanges routes with others using BGP | 2.2 |
| Bandwidth-delay product (BDP) | Bandwidth times round-trip time: the data that must be in flight to keep a path full | 2.3 |
| Base chain | nftables chain attached to a netfilter hook with a priority | 2.5 |
| BGP | Border Gateway Protocol: exchanges routes between autonomous systems | 2.2 |
| Bridge (Linux) | A switch in software: learns MACs and forwards frames between its ports | 2.1, 2.5 |
| Broadcast | A frame sent to `ff:ff:ff:ff:ff:ff`, which every card on the link receives | 2.1 |
| Broadcast domain | The set of hosts one broadcast reaches; a VLAN is one broadcast domain | 2.1 |
| Certificate (X.509) | Signed document that binds a public key to names and a validity period | 2.4 |
| Certificate authority (CA) | Party that signs certificates; a client trusts a certificate that chains to a root in its trust store | 2.4 |
| Certificate signing request (CSR) | The request, carrying a public key and a name, that a CA signs into a certificate | 2.4 |
| CIDR | Prefix notation such as `10.1.2.0/24`; the number after the slash counts the network bits | 2.2 |
| CLOSE\_WAIT | TCP state: the peer has closed, your program has not called `close` yet | 2.3 |
| CNI | Container Network Interface: the runtime executes a plugin binary with a command and a JSON configuration | 2.5 |
| Congestion window (cwnd) | The sender's estimate of how much unacknowledged data the path can carry | 2.3 |
| Connection tracking (conntrack) | Kernel table of flows; it remembers connection state and every NAT translation | 2.2, 2.3, 2.5 |
| CUBIC | The default congestion control algorithm of Linux | 2.3 |
| Default route | `0.0.0.0/0`: matches every destination, so it is used when nothing more specific does | 2.2 |
| DF (Don't Fragment) | IPv4 header flag that forbids routers to split the packet | 2.2 |
| DNS | Distributed database that turns names into records such as IP addresses | 2.4 |
| Dual-stack | A host or cluster that runs IPv4 and IPv6 side by side | 2.2 |
| eBPF | Small sandboxed programs that the Linux kernel runs at hook points | 2.5 |
| Encapsulation | Each layer wraps the data of the layer above in its own header | 2.1 |
| Ephemeral port | Client port the kernel picks from `ip_local_port_range` | 2.3 |
| EtherType | Two-byte frame field naming the payload: `0x0800` IPv4, `0x0806` ARP, `0x8100` VLAN tag | 2.1 |
| Fast retransmit | Resending a segment after duplicate acknowledgements, before the timer expires | 2.3 |
| Forwarding database (FDB) | A bridge's MAC table: which MAC sits behind which port | 2.1 |
| Frame | The unit of the link layer, for example one Ethernet frame | 2.1 |
| Gateway | The router a host sends packets to when the destination is not on its link | 2.2 |
| gRPC | Remote procedure call framework that runs over HTTP/2 | 2.4 |
| HTTP/2 | HTTP version that multiplexes many streams over one connection | 2.4 |
| HTTP/3 | HTTP over QUIC, which runs on UDP | 2.4 |
| ICMP | Internet Control Message Protocol: echo, destination unreachable, time exceeded, fragmentation needed | 2.2 |
| IPAM | IP address management: the CNI plugin that hands out pod addresses | 2.5 |
| Keep-alive | Reusing one TCP connection for several HTTP requests | 2.4 |
| kube-proxy | Node agent that makes Service virtual IPs work by programming netfilter (iptables, ipvs or nftables mode) | 2.5 |
| L4 / L7 load balancing | Balancing by connection (TCP or UDP) versus by request (HTTP, gRPC) | 2.4 |
| Link-local address | IPv6 address in `fe80::/10`, valid only on one link | 2.2 |
| Listening socket | Socket bound to a port that waits for connections; `accept` returns a new accepted socket per connection | 2.3 |
| Longest prefix match | When several routes match, the one with the longest prefix wins | 2.2 |
| MAC address | 48-bit address of a network card, written as six bytes in hex | 2.1 |
| Masquerade | Source NAT that rewrites the source to the address of the outgoing interface | 2.2, 2.5 |
| MSS | Maximum segment size: the largest TCP payload a side will accept; routers can clamp it | 2.2, 2.3 |
| MTU | Maximum transmission unit: the largest IP packet a link carries, 1500 bytes on Ethernet | 2.1, 2.2 |
| Mutual TLS (mTLS) | TLS in which the client also presents a certificate | 2.4 |
| NAT | Network address translation: rewriting addresses of packets that cross a router | 2.2 |
| ndots | `resolv.conf` option: a name with fewer dots than this is tried with the search domains first | 2.4 |
| Neighbour cache | Linux's table of IP-to-MAC answers, with states such as REACHABLE, STALE and FAILED | 2.1 |
| Neighbor Discovery (NDP) | IPv6's replacement for ARP | 2.2 |
| netem | Queueing discipline that adds delay or loss to an interface | 2.3 |
| Netfilter hooks | The five points where the kernel can run rules on a packet: prerouting, input, forward, output, postrouting | 2.5 |
| Network namespace | A private copy of the network stack: interfaces, routes, firewall rules and ports | 2.1, 2.5 |
| nftables | Linux packet filtering framework of tables, chains and rules | 2.2, 2.5 |
| Overlay network | Pod traffic wrapped in packets between node addresses, so the physical network needs no pod routes | 2.5 |
| Packet | The unit of the IP layer | 2.1 |
| Path MTU discovery (PMTUD) | A sender learns the smallest MTU on a path from ICMP "fragmentation needed" messages | 2.1, 2.2 |
| PMTU black hole | Big packets vanish because the ICMP message that would report the size is dropped | 2.1, 2.2, 2.5 |
| Policy routing | Choosing a routing table by rules such as source address | 2.2 |
| Port | 16-bit number that picks one program's socket on a host | 2.3 |
| Port unreachable | ICMP reply when no program listens on a UDP port | 2.3 |
| Protocol | An agreement on message format and order between two parties | 2.1 |
| QUIC | Encrypted, multiplexed transport on UDP (RFC 9000); the base of HTTP/3 | 2.3, 2.4 |
| Receive window | How many more bytes the receiver can take, sent in every acknowledgement | 2.3 |
| Recursive resolver | DNS server that follows referrals from the root down for its clients and caches the answers | 2.4 |
| Retransmission timeout (RTO) | Timer after which TCP resends an unacknowledged segment; it doubles on each timeout | 2.3 |
| Routed design | Pod subnets reach other nodes as plain routes, with no wrapping | 2.5 |
| Routing table | List of prefixes and where to send packets for each | 2.2 |
| Segment | The unit of the TCP layer | 2.1, 2.3 |
| SNI | Server Name Indication: the name the client asks for, sent in the TLS Client Hello | 2.4 |
| Socket | A kernel endpoint for network I/O, named by its 5-tuple | 2.3 |
| Stub resolver | The small DNS client in each program's C library; it asks the server in `resolv.conf` | 2.4 |
| subjectAltName (SAN) | The certificate field that lists the names it is valid for | 2.4 |
| Switch | Device that joins hosts on one link and forwards frames by MAC | 2.1 |
| Three-way handshake | SYN, SYN-ACK, ACK: how TCP opens a connection | 2.3 |
| TIME\_WAIT | TCP state the closing side holds for a while so late packets cannot reach a new connection | 2.3 |
| TLS | Transport Layer Security: encrypts a byte stream and proves the server's identity | 2.4 |
| Trust store | The set of root certificates a client accepts | 2.4 |
| TTL (DNS) | Seconds a resolver may cache a record | 2.4 |
| TTL (IP) | Hop limit; each router lowers it by one and drops the packet at zero | 2.2 |
| UDP | User Datagram Protocol: ports and a checksum on top of IP, nothing more | 2.3 |
| Unknown-unicast flooding | A switch sends a frame for a MAC it has not learned to every port | 2.1 |
| veth pair | Two virtual Ethernet devices joined like a cable: what one sends, the other receives | 2.1, 2.5 |
| VLAN | Virtual LAN: a 4-byte 802.1Q tag with a 12-bit ID splits one switch into separate broadcast domains | 2.1 |
| VNI | VXLAN network identifier, 24 bits | 2.5 |
| VTEP | VXLAN tunnel endpoint: wraps and unwraps frames on each node | 2.5 |
| VXLAN | Ethernet frames carried in UDP, port 4789 (RFC 7348) | 2.5 |
| XDP | eBPF hook that runs on a packet in the network driver, before the rest of the stack | 2.5 |

## References

These are the primary sources the chapters cite, grouped by topic. Each chapter's Going deeper table says what to read first.

| Topic | Sources | Chapter |
| --- | --- | --- |
| Ethernet, ARP, VLAN | [RFC 826](https://www.rfc-editor.org/rfc/rfc826.txt) (ARP), [RFC 894](https://www.rfc-editor.org/rfc/rfc894.txt) (IP over Ethernet), [RFC 5227](https://www.rfc-editor.org/rfc/rfc5227.txt) (address conflict detection), [IEEE 802.1Q-2022](https://standards.ieee.org/ieee/802.1Q/10323/) (paywalled), [Wireshark wiki: Ethernet](https://wiki.wireshark.org/Ethernet), [Wireshark wiki: VLAN](https://wiki.wireshark.org/VLAN) | 2.1 |
| IP, routing, ICMP | [RFC 791](https://www.rfc-editor.org/rfc/rfc791.html) (IPv4), [RFC 792](https://www.rfc-editor.org/rfc/rfc792.html) (ICMP), [RFC 4632](https://www.rfc-editor.org/rfc/rfc4632.html) (CIDR), [RFC 1918](https://www.rfc-editor.org/rfc/rfc1918.html) (private ranges), [RFC 5737](https://www.rfc-editor.org/rfc/rfc5737.html) (documentation ranges), [RFC 4271](https://www.rfc-editor.org/rfc/rfc4271.html) (BGP-4) | 2.2 |
| MTU and path MTU | [RFC 1191](https://www.rfc-editor.org/rfc/rfc1191.html) (PMTUD), [RFC 2923](https://www.rfc-editor.org/rfc/rfc2923.html) (black holes), [RFC 4821](https://www.rfc-editor.org/rfc/rfc4821.html) (packetization-layer PMTUD) | 2.1, 2.2 |
| IPv6 | [RFC 4291](https://www.rfc-editor.org/rfc/rfc4291.html) (addressing), [RFC 4861](https://www.rfc-editor.org/rfc/rfc4861.html) (Neighbor Discovery) | 2.2 |
| TCP and UDP | [RFC 9293](https://www.rfc-editor.org/rfc/rfc9293.html) (TCP), [RFC 5681](https://www.rfc-editor.org/rfc/rfc5681.html) (congestion control), [RFC 6298](https://www.rfc-editor.org/rfc/rfc6298.html) (retransmission timer), [RFC 7323](https://www.rfc-editor.org/rfc/rfc7323.html) (window scale, timestamps), [RFC 9438](https://www.rfc-editor.org/rfc/rfc9438.html) (CUBIC), [BBR Internet-Draft](https://datatracker.ietf.org/doc/html/draft-ietf-ccwg-bbr), [RFC 768](https://www.rfc-editor.org/rfc/rfc768.html) (UDP), [RFC 9000](https://www.rfc-editor.org/rfc/rfc9000.html) (QUIC) | 2.3 |
| DNS | [RFC 1034](https://www.rfc-editor.org/rfc/rfc1034.html), [RFC 1035](https://www.rfc-editor.org/rfc/rfc1035.html), [RFC 2308](https://www.rfc-editor.org/rfc/rfc2308.html) (negative caching), [resolv.conf(5)](https://man7.org/linux/man-pages/man5/resolv.conf.5.html), [Kubernetes: DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) | 2.4 |
| HTTP | [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html) (semantics), [RFC 9112](https://www.rfc-editor.org/rfc/rfc9112.html) (HTTP/1.1), [RFC 9113](https://www.rfc-editor.org/rfc/rfc9113.html) (HTTP/2), [RFC 9114](https://www.rfc-editor.org/rfc/rfc9114.html) (HTTP/3), [RFC 7301](https://www.rfc-editor.org/rfc/rfc7301.html) (ALPN), [gRPC load balancing](https://grpc.io/blog/grpc-load-balancing/) | 2.4 |
| TLS and certificates | [RFC 8446](https://www.rfc-editor.org/rfc/rfc8446.html) (TLS 1.3), [RFC 5280](https://www.rfc-editor.org/rfc/rfc5280.html) (X.509), [RFC 9525](https://www.rfc-editor.org/rfc/rfc9525.html) (service identity), [RFC 8555](https://www.rfc-editor.org/rfc/rfc8555.html) (ACME), [OpenSSL s\_client](https://docs.openssl.org/3.0/man1/openssl-s_client/), [curl man page](https://curl.se/docs/manpage.html) | 2.4 |
| Linux namespaces, veth, bridge | [network\_namespaces(7)](https://man7.org/linux/man-pages/man7/network_namespaces.7.html), [veth(4)](https://man7.org/linux/man-pages/man4/veth.4.html), [Linux kernel: bridge](https://docs.kernel.org/networking/bridge.html), [Linux kernel: VXLAN](https://docs.kernel.org/networking/vxlan.html), [RFC 7348](https://www.rfc-editor.org/rfc/rfc7348.html) (VXLAN) | 2.1, 2.5 |
| Netfilter, NAT, conntrack | [nftables wiki: Netfilter hooks](https://wiki.nftables.org/wiki-nftables/index.php/Netfilter_hooks), [nftables wiki: NAT](<https://wiki.nftables.org/wiki-nftables/index.php/Performing_Network_Address_Translation_(NAT)>), [nftables wiki: Mangling packet headers](https://wiki.nftables.org/wiki-nftables/index.php/Mangling_packet_headers), [Linux kernel: nf\_conntrack sysctl](https://docs.kernel.org/networking/nf_conntrack-sysctl.html) | 2.2, 2.3, 2.5 |
| Kernel tunables | [Linux kernel: ip-sysctl](https://docs.kernel.org/networking/ip-sysctl.html) (`ip_forward`, `tcp_mtu_probing`, `ip_local_port_range`, ARP knobs) | 2.1 to 2.5 |
| Command reference | [ip-link(8)](https://man7.org/linux/man-pages/man8/ip-link.8.html), [ip-route(8)](https://man7.org/linux/man-pages/man8/ip-route.8.html), [ip-rule(8)](https://man7.org/linux/man-pages/man8/ip-rule.8.html), [ip-neighbour(8)](https://man7.org/linux/man-pages/man8/ip-neighbour.8.html), [bridge(8)](https://man7.org/linux/man-pages/man8/bridge.8.html), [arp(7)](https://man7.org/linux/man-pages/man7/arp.7.html), [tcp(7)](https://man7.org/linux/man-pages/man7/tcp.7.html), [listen(2)](https://man7.org/linux/man-pages/man2/listen.2.html), [ping(8)](https://manpages.ubuntu.com/manpages/noble/man8/ping.8.html), [tracepath(8)](https://man7.org/linux/man-pages/man8/tracepath.8.html), [traceroute(8)](https://man7.org/linux/man-pages/man8/traceroute.8.html) | all |
| CNI, eBPF, Kubernetes networking | [CNI specification](https://github.com/containernetworking/cni/blob/main/SPEC.md), [ebpf.io: What is eBPF](https://ebpf.io/what-is-ebpf/), [Cilium: BPF and XDP reference guide](https://docs.cilium.io/en/stable/reference-guides/bpf/progtypes/), [Cilium: routing](https://docs.cilium.io/en/stable/network/concepts/routing/), [Cilium: kube-proxy-free](https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/), [Kubernetes network model](https://kubernetes.io/docs/concepts/services-networking/), [Kubernetes: Virtual IPs and Service proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/) | 2.5 |
| CNCF projects | [cncf.io/projects](https://www.cncf.io/projects/) (maturity levels checked 2026-11-16) | 2.4, 2.5 |

**Versions tested** (2026-11-16): a privileged `ubuntu:24.04` container on Docker Desktop with WSL2, kernel 6.18.58.1-microsoft-standard-WSL2. Tools from Ubuntu 24.04's own packages: iproute2 6.1.0, tcpdump 4.99.4, nftables 1.0.9, nginx 1.24.0, dnsmasq 2.91, OpenSSL 3.0.13, Python 3.12.3, curl 8.5.0, iperf3 3.16, tshark 4.2.2, conntrack-tools 1.4.8, dig 9.18.39, reference CNI plugins 1.1.1.

**Versions targeted:** Ubuntu 24.04 LTS with its default 6.8 kernel (not run).
