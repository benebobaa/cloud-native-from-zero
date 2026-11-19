# Lab 2.2 · A Router, NAT and Path MTU

## Goal

You will build a small network with one router, watch a packet cross it, make the kernel choose between routes, trigger path MTU discovery, hide a private network behind NAT, and finally break path MTU discovery on purpose and rescue it.

**Versions tested** (2026-11-16, in a privileged `ubuntu:24.04` container, Ubuntu 24.04.5 LTS userland, kernel 6.18.58.1-microsoft-standard-WSL2 on Docker Desktop): iproute2 6.1.0, iputils 20240117 (`ping`, `tracepath`), traceroute 2.1.5, tcpdump 4.99.4, nftables 1.0.9, conntrack-tools 1.4.8, curl 8.5.0, Python 3.12.3. Every output below came from those runs. MAC addresses, ports, IDs, timestamps and timings differ on your machine; the shapes do not. A VM or WSL2 distro running the same commands is **targeted, not run**, and Ubuntu 24.04's own kernel (6.8) was not run either.

**Before you start.** Everything runs as root, inside network namespaces, so nothing touches your real network. The tested route is a throwaway privileged container:

```bash
mkdir -p ~/cn-lab && docker run -it --rm --privileged -v ~/cn-lab:/root/cn-lab --name cnlab-vol2 ubuntu:24.04 bash   # files saved under /root/cn-lab survive --rm
```

Inside it, install the tools. This lab needs `iproute2 tcpdump nftables iputils-ping iputils-tracepath curl python3 conntrack traceroute`; the line below installs the whole Vol 2 set once (`tshark` asks a question, so answer it non-interactively):

```bash
apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y iproute2 tcpdump nftables iputils-ping iputils-arping iputils-tracepath curl python3 openssl nginx dnsmasq dnsutils netcat-openbsd iperf3 conntrack traceroute tshark libfaketime
```

On a VM or WSL2 distro (targeted), run `sudo -i` first and use the same `apt-get` line. Paste each result into your notebook, `~/cn-lab/vol2/lab-2.2.md`, on your own machine.

Start every run from a clean slate. This also stops any `python3` process, which is safe in the throwaway container:

```bash
pkill tcpdump; pkill -x python3
for n in $(ip netns list | awk '{print $1}'); do ip netns del $n; done
```

## What you will build

{{diagram lab-2-2-01.jsx | what you will build in Lab 2.2 · four network namespaces, one router}}
The router `r` joins three networks. Host `net` stands in for the Internet and uses the documentation range `203.0.113.0/24`. It has no default route, so it cannot reach the private networks unless the router translates addresses.

## Part A · Build the network and turn on forwarding (30 min)

You will build the four namespaces with `ip`, read the three routing tables, and see that a router forwards nothing until the kernel is told to.

First create the namespaces. Each `ip link add ... type veth peer name ...` makes a virtual cable with two ends, and `ip link set ... netns ...` plugs each end into a namespace:

```bash
for n in a r b net; do ip netns add $n; ip -n $n link set lo up; done
ip link add a-r type veth peer name r-a;   ip link set a-r netns a;   ip link set r-a netns r
ip link add b-r type veth peer name r-b;   ip link set b-r netns b;   ip link set r-b netns r
ip link add n-r type veth peer name r-n;   ip link set n-r netns net; ip link set r-n netns r
```

Give every interface an address and switch it on, then give the two hosts a default route that points at the router:

```bash
ip -n a addr add 10.1.1.10/24 dev a-r;      ip -n a link set a-r up
ip -n b addr add 10.1.2.10/24 dev b-r;      ip -n b link set b-r up
ip -n net addr add 203.0.113.10/24 dev n-r; ip -n net link set n-r up
ip -n r addr add 10.1.1.1/24 dev r-a;       ip -n r link set r-a up
ip -n r addr add 10.1.2.1/24 dev r-b;       ip -n r link set r-b up
ip -n r addr add 203.0.113.1/24 dev r-n;    ip -n r link set r-n up
ip -n a route add default via 10.1.1.1
ip -n b route add default via 10.1.2.1
```

Read the three tables:

```bash
ip -n a route; ip -n r route; ip -n b route
```

```text
--- a
default via 10.1.1.1 dev a-r
10.1.1.0/24 dev a-r proto kernel scope link src 10.1.1.10
--- r
10.1.1.0/24 dev r-a proto kernel scope link src 10.1.1.1
10.1.2.0/24 dev r-b proto kernel scope link src 10.1.2.1
203.0.113.0/24 dev r-n proto kernel scope link src 203.0.113.1
--- b
default via 10.1.2.1 dev b-r
10.1.2.0/24 dev b-r proto kernel scope link src 10.1.2.10
```

Now the router. Switch forwarding off explicitly (a new namespace copies the host's setting, which is `1` on a machine running Docker and `0` on a clean Ubuntu), then ping from `a` to `b`, switch it on, and ping again:

```bash
ip netns exec r sysctl -w net.ipv4.ip_forward=0
ip netns exec a ping -c 1 -W 1 10.1.2.10
ip netns exec r sysctl -w net.ipv4.ip_forward=1
ip netns exec a ping -c 2 10.1.2.10
```

```text
net.ipv4.ip_forward = 0
PING 10.1.2.10 (10.1.2.10) 56(84) bytes of data.

--- 10.1.2.10 ping statistics ---
1 packets transmitted, 0 received, 100% packet loss, time 0ms

net.ipv4.ip_forward = 1
PING 10.1.2.10 (10.1.2.10) 56(84) bytes of data.
64 bytes from 10.1.2.10: icmp_seq=1 ttl=63 time=0.177 ms
64 bytes from 10.1.2.10: icmp_seq=2 ttl=63 time=0.122 ms

--- 10.1.2.10 ping statistics ---
2 packets transmitted, 2 received, 0% packet loss, time 1001ms
```

With forwarding off there is no error message at all, only silence. Remember that picture: it is the symptom engineers see on a misconfigured router.

1. Nobody ran `ip route add` on `r`. Where did its three routes come from? Which word in the output tells you?
2. With forwarding off, which machine dropped the ping, and why did `ping` receive no error message?
3. The reply says `ttl=63`, but `ping` sent 64. Predict where the missing 1 went before you read Part B.

## Part B · Follow one packet, then pick a route (50 min)

You will capture the same ping on both sides of the router, then ask the kernel which route it would use for two addresses.

**The packet on both sides.** Start one capture on each router interface in the background. The `sleep 1` gives `tcpdump` time to start; `-Z root` keeps root rights so that it can write its file (without it a leftover file can fail silently); `-c 1` stops after one packet:

```bash
ip netns exec r tcpdump -Z root -n -e -v -i r-a -c 1 -w /tmp/ra.pcap "icmp[icmptype]==8" 2>/dev/null &
ip netns exec r tcpdump -Z root -n -e -v -i r-b -c 1 -w /tmp/rb.pcap "icmp[icmptype]==8" 2>/dev/null &
sleep 1
ip netns exec a ping -c 1 10.1.2.10 > /dev/null
sleep 1; pkill tcpdump; sleep 0.5
echo "-- router, side A"; tcpdump -n -e -v -r /tmp/ra.pcap 2>/dev/null | grep -v '^$'
echo "-- router, side B"; tcpdump -n -e -v -r /tmp/rb.pcap 2>/dev/null | grep -v '^$'
```

```text
-- router, side A
07:44:58.040079 6a:da:c3:a4:ff:c3 > 06:ef:5f:95:8e:47, ethertype IPv4 (0x0800), length 98: (tos 0x0, ttl 64, id 12025, offset 0, flags [DF], proto ICMP (1), length 84)
    10.1.1.10 > 10.1.2.10: ICMP echo request, id 3661, seq 1, length 64
-- router, side B
07:44:58.040102 8e:50:b6:54:be:4b > 5e:98:53:87:21:e2, ethertype IPv4 (0x0800), length 98: (tos 0x0, ttl 63, id 12025, offset 0, flags [DF], proto ICMP (1), length 84)
    10.1.1.10 > 10.1.2.10: ICMP echo request, id 3661, seq 1, length 64
```

Now find out whose MAC addresses those are, what `a` knows about the network, and which routers the packet crossed:

```bash
ip -n a -br link show a-r; ip -n r -br link show r-a; ip -n r -br link show r-b; ip -n b -br link show b-r
ip -n a neigh
ip netns exec a traceroute -n -q 1 10.1.2.10
```

```text
a-r@if21         UP             6a:da:c3:a4:ff:c3 <BROADCAST,MULTICAST,UP,LOWER_UP>
r-a@if22         UP             06:ef:5f:95:8e:47 <BROADCAST,MULTICAST,UP,LOWER_UP>
r-b@if24         UP             8e:50:b6:54:be:4b <BROADCAST,MULTICAST,UP,LOWER_UP>
b-r@if23         UP             5e:98:53:87:21:e2 <BROADCAST,MULTICAST,UP,LOWER_UP>
10.1.1.1 dev a-r lladdr 06:ef:5f:95:8e:47 REACHABLE
traceroute to 10.1.2.10 (10.1.2.10), 30 hops max, 60 byte packets
 1  10.1.1.1  9.306 ms
 2  10.1.2.10  8.612 ms
```

1. Match every MAC address in the two captures to an interface. Whose MAC did `a` use as the destination, and why not `b`'s?
2. List what changed between the two captures and what stayed the same. Which of the changes is the router's doing in the Ethernet header, and which in the IP header?
3. `traceroute` found two hops. Which ICMP message revealed hop 1, and why did hop 2 answer differently?

**Choosing a route.** Add two routes to `a` for the same destination network: a `/24` through the real router and a `/25` through `10.1.1.99`, an address nobody owns. Then ask the kernel which one it would use. Write your prediction for each address first.

```bash
ip -n a route add 10.1.2.0/24 via 10.1.1.1
ip -n a route add 10.1.2.0/25 via 10.1.1.99
ip -n a route
ip -n a route get 10.1.2.10
ip -n a route get 10.1.2.200
```

```text
default via 10.1.1.1 dev a-r
10.1.1.0/24 dev a-r proto kernel scope link src 10.1.1.10
10.1.2.0/25 via 10.1.1.99 dev a-r
10.1.2.0/24 via 10.1.1.1 dev a-r
10.1.2.10 via 10.1.1.99 dev a-r src 10.1.1.10 uid 0
    cache
10.1.2.200 via 10.1.1.1 dev a-r src 10.1.1.10 uid 0
    cache
```

Remove both routes, then remove the default route and ask again. With no rule left that matches `203.0.113.10`, the kernel has no answer:

```bash
ip -n a route del 10.1.2.0/25 via 10.1.1.99
ip -n a route del 10.1.2.0/24 via 10.1.1.1
ip -n a route del default
ip -n a route get 203.0.113.10; echo "exit=$?"
ip -n a route get 10.1.1.1
ip -n a route add default via 10.1.1.1
ip -n a route get 203.0.113.10
```

```text
RTNETLINK answers: Network is unreachable
exit=2
10.1.1.1 dev a-r src 10.1.1.10 uid 0
    cache
203.0.113.10 via 10.1.1.1 dev a-r src 10.1.1.10 uid 0
    cache
```

4. Why does `10.1.2.10` go to `10.1.1.99` and `10.1.2.200` to `10.1.1.1`? Which two numbers decide it? Draw the two prefixes as ranges of last-byte values.
5. Leave the `/25` route in place and run `ping -c 1 -W 1 10.1.2.10` from `a`. Predict what `a` will try to resolve with ARP and what the result will be.
6. After the default route is gone, `10.1.1.1` is still reachable but `203.0.113.10` is not. Which route answers for the first one?

## Part C · Path MTU (35 min)

You will make one link of the path smaller than the rest and watch the sender learn the new size from the router.

Lower the MTU of the router's `r-a` interface to 1400. Then ping from `b` to `a` with the DF bit set (`-M do`). A payload of 1372 bytes makes a 1400-byte packet; 1472 bytes makes a 1500-byte packet:

```bash
ip -n r link set r-a mtu 1400
ip -n r link show r-a | head -1
ip netns exec b ping -c 1 -M do -s 1372 10.1.1.10
ip netns exec b ping -c 1 -M do -s 1472 10.1.1.10
```

```text
21: r-a@if22: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1400 qdisc noqueue state UP mode DEFAULT group default qlen 1000
PING 10.1.1.10 (10.1.1.10) 1372(1400) bytes of data.
1380 bytes from 10.1.1.10: icmp_seq=1 ttl=63 time=0.281 ms
PING 10.1.1.10 (10.1.1.10) 1472(1500) bytes of data.
From 10.1.2.1 icmp_seq=1 Frag needed and DF set (mtu = 1400)
```

The error came from `10.1.2.1`, the router's address on `b`'s side. Now see what `b` did with it, and let `tracepath` discover the same number on its own:

```bash
ip -n b route get 10.1.1.10
ip netns exec b tracepath -n 10.1.1.10
```

```text
10.1.1.10 via 10.1.2.1 dev b-r src 10.1.2.10 uid 0
    cache expires 599sec mtu 1400
 1?: [LOCALHOST]                      pmtu 1500
 1:  10.1.2.1                                              0.110ms
 1:  10.1.2.1                                              0.044ms
 2:  10.1.2.1                                              0.043ms pmtu 1400
 2:  10.1.1.10                                             0.044ms reached
     Resume: pmtu 1400 hops 2 back 2
```

The wire shows the exchange. Repeat the big ping while `tcpdump` listens on `r-b` for ICMP, and keep the result for your notebook. First empty b's route cache (the last command of this part explains it); otherwise b already knows 1400 and refuses the ping itself, so nothing reaches the router. This is the real trace of the message in the theory diagram:

```bash
ip netns exec b sh -c "echo 1 > /proc/sys/net/ipv4/route/flush"
ip netns exec r tcpdump -Z root -n -v -i r-b -c 2 -w /tmp/pm.pcap icmp 2>/dev/null &
sleep 1
ip netns exec b ping -c 1 -M do -s 1472 10.1.1.10 > /dev/null
sleep 1; pkill tcpdump; sleep 0.5
tcpdump -n -v -r /tmp/pm.pcap 2>/dev/null | grep -v '^$'
```

```text
07:59:56.576819 IP (tos 0x0, ttl 64, id 0, offset 0, flags [DF], proto ICMP (1), length 1500)
    10.1.2.10 > 10.1.1.10: ICMP echo request, id 4076, seq 1, length 1480
07:59:56.576829 IP (tos 0xc0, ttl 64, id 2147, offset 0, flags [none], proto ICMP (1), length 576)
    10.1.2.1 > 10.1.2.10: ICMP 10.1.1.10 unreachable - need to frag (mtu 1400), length 556
	IP (tos 0x0, ttl 64, id 0, offset 0, flags [DF], proto ICMP (1), length 1500)
    10.1.2.10 > 10.1.1.10: ICMP echo request, id 4076, seq 1, length 1480
```

The router's reply quotes the start of the packet it refused, so the sender can tell which packet failed. Now `b` has learned the limit, and the next oversized ping is refused by `b` itself:

```bash
ip netns exec b ping -c 1 -M do -s 1472 10.1.1.10
```

```text
ping: local error: message too long, mtu=1400
```

Finally clear the remembered size, so that the Break it section starts without it. Leave `r-a` at 1400:

```bash
ip netns exec b sh -c "echo 1 > /proc/sys/net/ipv4/route/flush"
ip -n b route get 10.1.1.10
```

```text
10.1.1.10 via 10.1.2.1 dev b-r src 10.1.2.10 uid 0
    cache
```

1. Why does `-s 1372` make a 1400-byte packet? Add up the three parts.
2. Which machine generated the `Frag needed` message, which machine received it, and which address was the destination of the packet it quotes?
3. Where is the number 1400 stored after the exchange, and what is `expires 599sec` counting down to? What would `b` do afterwards?
4. `tracepath` reports `pmtu 1400` at hop 2, but `pmtu 1500` at the start. Explain both numbers.

## Part D · NAT and a first look at IPv6 (50 min)

You will see a private host fail to reach the "Internet", fix it with one `nft` rule, read the connection-tracking table, and then meet IPv6 on a single link.

**No NAT.** The host `net` has only one route, for its own network. Ping it from `a`, and capture on `n-r` what `net` actually receives:

```bash
ip -n net route
ip netns exec a ping -c 1 -W 1 203.0.113.10
ip netns exec net tcpdump -Z root -n -i n-r -c 2 -w /tmp/net.pcap icmp 2>/dev/null &
sleep 1
ip netns exec a ping -c 1 -W 1 203.0.113.10 > /dev/null
sleep 1; pkill tcpdump; sleep 0.5; tcpdump -n -r /tmp/net.pcap 2>/dev/null
```

```text
203.0.113.0/24 dev n-r proto kernel scope link src 203.0.113.10
PING 203.0.113.10 (203.0.113.10) 56(84) bytes of data.

--- 203.0.113.10 ping statistics ---
1 packets transmitted, 0 received, 100% packet loss, time 0ms

07:45:05.343179 IP 10.1.1.10 > 203.0.113.10: ICMP echo request, id 3703, seq 1, length 64
```

The request arrives, with the private source address. The reply has nowhere to go.

**Masquerade.** Add a `nat` table to the router with a `postrouting` chain, and one rule that rewrites the source of everything leaving through `r-n`:

```bash
ip netns exec r nft add table ip nat
ip netns exec r nft "add chain ip nat post { type nat hook postrouting priority 100 ; }"
ip netns exec r nft add rule ip nat post oifname "r-n" masquerade
ip netns exec r nft list ruleset
```

```text
table ip nat {
	chain post {
		type nat hook postrouting priority srcnat; policy accept;
		oifname "r-n" masquerade
	}
}
```

Ping again, capture what `net` sees, and look at the connection-tracking table on the router:

```bash
ip netns exec net tcpdump -Z root -n -i n-r -c 2 -w /tmp/net2.pcap icmp 2>/dev/null &
sleep 1
ip netns exec a ping -c 2 203.0.113.10
sleep 1; pkill tcpdump; sleep 0.5; tcpdump -n -r /tmp/net2.pcap 2>/dev/null
ip netns exec r conntrack -L
```

```text
64 bytes from 203.0.113.10: icmp_seq=1 ttl=63 time=0.253 ms
64 bytes from 203.0.113.10: icmp_seq=2 ttl=63 time=0.603 ms
07:45:09.575199 IP 203.0.113.1 > 203.0.113.10: ICMP echo request, id 3714, seq 1, length 64
07:45:09.575246 IP 203.0.113.10 > 203.0.113.1: ICMP echo reply, id 3714, seq 1, length 64
conntrack v1.4.8 (conntrack-tools): 1 flow entries have been shown.
icmp     1 28 src=10.1.1.10 dst=203.0.113.10 type=8 code=0 id=3714 src=203.0.113.10 dst=203.0.113.1 type=0 code=0 id=3714 mark=0 use=1
```

The server now sees the router's address, `203.0.113.1`, and the reply finds its way back. Only the first of the two pings is captured, because `-c 2` counts the request and its reply.

**A TCP flow.** Start a small web server on `net`, fetch a file from `a`, and list only the TCP entries (`-p tcp`):

```bash
mkdir -p /tmp/www; echo hello > /tmp/www/hello.txt
ip netns exec net python3 -m http.server 8000 --directory /tmp/www >/dev/null 2>&1 &
sleep 1
ip netns exec a curl -s http://203.0.113.10:8000/hello.txt
ip netns exec r conntrack -L -p tcp
pkill -x python3
```

```text
hello
conntrack v1.4.8 (conntrack-tools): 1 flow entries have been shown.
tcp      6 119 TIME_WAIT src=10.1.1.10 dst=203.0.113.10 sport=33434 dport=8000 src=203.0.113.10 dst=203.0.113.1 sport=8000 dport=33434 [ASSURED] mark=0 use=1
```

**IPv6 on one link.** Give both ends of the `a` to `r` link an IPv6 address, look at what the kernel added by itself, and ping. Then look again and ping a second time:

```bash
ip -n a addr add fd00:1::10/64 dev a-r
ip -n r addr add fd00:1::1/64 dev r-a
ip -n a -6 addr show dev a-r
ip netns exec a ping -6 -c 1 fd00:1::1
ip -n a -6 addr show dev a-r scope global
ip netns exec a ping -6 -c 1 fd00:1::1
ip -n a -6 neigh
```

```text
22: a-r@if21: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default qlen 1000 link-netns r
    inet6 fd00:1::10/64 scope global tentative
       valid_lft forever preferred_lft forever
    inet6 fe80::68da:c3ff:fea4:ffc3/64 scope link
       valid_lft forever preferred_lft forever
64 bytes from fd00:1::1: icmp_seq=1 ttl=64 time=2050 ms
    inet6 fd00:1::10/64 scope global
       valid_lft forever preferred_lft forever
64 bytes from fd00:1::1: icmp_seq=1 ttl=64 time=33.7 ms
fd00:1::1 dev a-r lladdr 06:ef:5f:95:8e:47 REACHABLE
```

1. In the no-NAT run the request reached `net`, yet the ping failed. Which routing table lacks an entry, and what exactly would it need?
2. `postrouting` is the last hook a forwarded packet passes. Why is that the right place to rewrite the source, and why would a `prerouting` chain not work for masquerade?
3. In the `conntrack` line, which address differs between the two directions, and what does that tell you about what the router did?
4. In the TCP entry the source port `33434` is the same on both sides of the translation. Suppose two hosts behind the router both use source port `33434` to reach the same server. What must the router do, and what happens when it runs out of choices?
5. The first IPv6 ping took about 2000 ms and the second 34 ms. What word in the first listing explains it? Which IPv4 object is the last output line the twin of?

## Checkpoint

You are done when all of these hold. Keep the outputs in `~/cn-lab/vol2/lab-2.2.md`.

| Check | Expected |
| --- | --- |
| `ip netns list` | `a`, `b`, `net` and `r`, in any order |
| `ip netns exec r sysctl net.ipv4.ip_forward` | `net.ipv4.ip_forward = 1` |
| `ip netns exec a ping -c 1 10.1.2.10` | a reply with `ttl=63` |
| `ip -n a route add 10.1.2.0/25 via 10.1.1.99`, then `ip -n a route get 10.1.2.10` and `ip -n a route get 10.1.2.200`, then `ip -n a route del 10.1.2.0/25 via 10.1.1.99` | `via 10.1.1.99` for the first, `via 10.1.1.1` for the second |
| `ip netns exec b ping -c 1 -M do -s 1472 10.1.1.10` with `r-a` at 1400 and `b`'s route cache emptied | `Frag needed and DF set (mtu = 1400)` (without emptying the cache: `message too long, mtu=1400`) |
| `ip netns exec a ping -c 1 203.0.113.10` with the masquerade rule in place, then straight away `ip netns exec r conntrack -L` | one `icmp` entry whose second half ends with `dst=203.0.113.1` |
| Break it, ICMP dropped: small page, then `big.bin` | `13 bytes`, then `0 bytes` and `curl exit=28` |
| Break it, after `tcp_mtu_probing=1` | `200000 bytes in` about 6.5 s, `curl exit=0` |
| Notebook | Answers to every numbered question in Parts A to D and Break it, plus the traces: the two router captures, the `Frag needed` capture, the `conntrack` line and the black-hole table |

## Break it: the path MTU black hole

Teams often tighten a firewall by dropping ICMP messages they do not recognise. You will drop one kind on the router, the destination-unreachable errors, and watch big downloads fail while everything small works. Keep `r-a` at 1400 from Part C. Create a test file and a web server on `b`, and empty `b`'s route cache:

```bash
mkdir -p /tmp/www; head -c 200000 /dev/urandom > /tmp/www/big.bin; echo "hello from b" > /tmp/www/index.html
ip netns exec b python3 -m http.server 8000 --directory /tmp/www >/dev/null 2>&1 &
sleep 1
ip netns exec b sh -c "echo 1 > /proc/sys/net/ipv4/route/flush"
```

**The healthy run.** Download the 200 KB file from `a` with ICMP allowed. `curl` prints how many bytes arrived and how long it took:

```bash
ip netns exec a curl -s -o /dev/null -w "%{size_download} bytes in %{time_total}s\n" --max-time 5 http://10.1.2.10:8000/big.bin
ip -n b route get 10.1.1.10
```

```text
200000 bytes in 0.010353s
10.1.1.10 via 10.1.2.1 dev b-r src 10.1.2.10 uid 0
    cache expires 599sec mtu 1400
```

The first big packet was refused, `b` learned 1400, and the rest flowed. **Now break it.** Empty the cache again, and make the router drop the ICMP messages it generates. The router creates them itself, so the rule belongs on its `output` hook:

```bash
ip netns exec b sh -c "echo 1 > /proc/sys/net/ipv4/route/flush"
ip netns exec r nft add table inet lab
ip netns exec r nft "add chain inet lab out { type filter hook output priority 0 ; }"
ip netns exec r nft add rule inet lab out icmp type destination-unreachable drop
ip netns exec r nft list table inet lab
ip netns exec a curl -s -o /dev/null -w "small page: %{size_download} bytes\n" --max-time 5 http://10.1.2.10:8000/
ip netns exec a curl -s -o /dev/null -w "%{size_download} bytes in %{time_total}s\n" --max-time 5 http://10.1.2.10:8000/big.bin; echo "curl exit=$?"
```

```text
table inet lab {
	chain out {
		type filter hook output priority filter; policy accept;
		icmp type destination-unreachable drop
	}
}
small page: 13 bytes
0 bytes in 5.005509s
curl exit=28
```

The small page works. The big file never arrives, and `curl` gives up after its 5-second limit with exit code 28. Nothing is down: the links are up, the routes are right and `ping` works.

**Diagnose it.** Use the tools of this chapter. First, the discovery test from Part C now stays silent, and `b` has learned no `mtu`:

```bash
ip netns exec b ping -c 1 -W 2 -M do -s 1472 10.1.1.10
ip -n b route get 10.1.1.10
```

```text
PING 10.1.1.10 (10.1.1.10) 1472(1500) bytes of data.

--- 10.1.1.10 ping statistics ---
1 packets transmitted, 0 received, 100% packet loss, time 0ms

10.1.1.10 via 10.1.2.1 dev b-r src 10.1.2.10 uid 0
    cache
```

Next, capture the download on both sides of the router. The `short` function only shortens `tcpdump`'s long lines to time, sequence range and byte count; `--local-port` fixes the client's port so that each capture shows just this one connection. Restart the web server first, to drop its leftover connection from the failed run:

```bash
short() { tcpdump -n -tt -r "$1" 2>/dev/null | grep -v 'length 0' | sed -E 's/^([0-9]+\.[0-9]+) IP .* seq ([0-9:]+),.*length ([0-9]+)$/\1 seq \2 length \3/' | awk 'NR==1{t0=$1} {printf "%6.2f s  %s %s %s %s\n", $1-t0, $2,$3,$4,$5}'; }
ip netns exec b sh -c "echo 1 > /proc/sys/net/ipv4/route/flush"
pkill -x python3; sleep 0.5
ip netns exec b python3 -m http.server 8000 --directory /tmp/www >/dev/null 2>&1 &
sleep 1
ip netns exec r tcpdump -Z root -n -tt -i r-b -w /tmp/dbb.pcap "tcp src port 8000 and dst port 50001" 2>/dev/null &
ip netns exec r tcpdump -Z root -n -tt -i r-a -w /tmp/dba.pcap "tcp src port 8000 and dst port 50001" 2>/dev/null &
sleep 1
ip netns exec a curl -s -o /dev/null -w "%{size_download} bytes in %{time_total}s\n" --local-port 50001 --max-time 5 http://10.1.2.10:8000/big.bin; echo "curl exit=$?"
sleep 1; pkill tcpdump; sleep 0.5
echo "-- seen on r-b"; short /tmp/dbb.pcap
echo "-- seen on r-a"; short /tmp/dba.pcap
```

```text
0 bytes in 5.003322s
curl exit=28
-- seen on r-b
  0.00 s  seq 1:205 length 204
  0.00 s  seq 205:7445 length 7240
  0.00 s  seq 7445:14685 length 7240
  0.01 s  seq 14685:16133 length 1448
  0.23 s  seq 205:1653 length 1448
  0.66 s  seq 205:1653 length 1448
  1.50 s  seq 205:1653 length 1448
  3.17 s  seq 205:1653 length 1448
-- seen on r-a
  0.00 s  seq 1:205 length 204
```

Read it. The first reply (204 bytes, the HTTP headers) crossed the router: it appears on both sides. The big segments reach `r-b` but never appear on `r-a`: the router could not forward them, and it was not allowed to say why. The server sends the same segment (bytes 205 to 1653) again after 0.2, 0.4, 0.8 and 1.7 seconds, each wait doubling, always at the same size. Lengths above 1448, such as 7240, are large buffers that `tcpdump` sees before the network card cuts them into packets.

**Fix 1: let TCP probe.** The sender is `b`, so switch on packetization-layer probing there. Restart the server and capture again:

```bash
ip netns exec b sysctl -w net.ipv4.tcp_mtu_probing=1
pkill -x python3; sleep 0.5
ip netns exec b python3 -m http.server 8000 --directory /tmp/www >/dev/null 2>&1 &
sleep 1
ip netns exec r tcpdump -Z root -n -tt -i r-b -w /tmp/bh.pcap "tcp src port 8000 and dst port 50002" 2>/dev/null &
sleep 1
ip netns exec a curl -s -o /dev/null -w "%{size_download} bytes in %{time_total}s\n" --local-port 50002 --max-time 60 http://10.1.2.10:8000/big.bin; echo "curl exit=$?"
sleep 1; pkill tcpdump; sleep 0.5
short /tmp/bh.pcap | head -12
```

```text
net.ipv4.tcp_mtu_probing = 1
200000 bytes in 6.513968s
curl exit=0
  0.00 s  seq 1:205 length 204
  0.00 s  seq 205:7445 length 7240
  0.00 s  seq 7445:14685 length 7240
  0.01 s  seq 14685:16133 length 1448
  0.22 s  seq 205:1653 length 1448
  0.64 s  seq 205:1653 length 1448
  1.48 s  seq 205:1653 length 1448
  3.14 s  seq 205:1653 length 1448
  6.50 s  seq 205:1229 length 1024
  6.50 s  seq 16133:17157 length 1024
  6.50 s  seq 17157:18181 length 1024
  6.50 s  seq 1229:1653 length 424
```

The download completes, but only after the fifth timeout, at about 6.5 seconds, when the kernel concludes that something is eating its big packets, falls back to 1024-byte segments, and the whole transfer then finishes within milliseconds.

**Fix 2: clamp the MSS on the router.** The better fix is to tell the client's side to use smaller segments from the start. The *MSS* (maximum segment size) is announced in the TCP handshake, and the router can rewrite it. 1360 is 1400 minus 40 bytes of IP and TCP headers. Switch probing off again, restart the server, and add the rule (the [nftables wiki](https://wiki.nftables.org/wiki-nftables/index.php/Mangling_packet_headers) shows the same idea with `rt mtu` instead of a fixed number):

```bash
ip netns exec b sysctl -w net.ipv4.tcp_mtu_probing=0
pkill -x python3; sleep 0.5
ip netns exec b python3 -m http.server 8000 --directory /tmp/www >/dev/null 2>&1 &
sleep 1
ip netns exec r nft add table inet mss
ip netns exec r nft "add chain inet mss clamp { type filter hook forward priority mangle ; }"
ip netns exec r nft add rule inet mss clamp iifname "r-a" tcp flags syn tcp option maxseg size set 1360
ip netns exec a curl -s -o /dev/null -w "%{size_download} bytes in %{time_total}s\n" --max-time 5 http://10.1.2.10:8000/big.bin; echo "curl exit=$?"
```

```text
net.ipv4.tcp_mtu_probing = 0
200000 bytes in 0.007299s
curl exit=0
```

**The comparison** (a 200 000-byte download, one run each; across seven runs of fix 1 the time was between 6.5 and 6.7 s):

| Run | Bytes received | Time |
| --- | --- | --- |
| ICMP allowed (healthy) | 200000, `curl` exit 0 | 0.010 s |
| ICMP dropped | 0, `curl` exit 28 | 5.006 s, the time limit |
| ICMP dropped, `tcp_mtu_probing=1` on `b` | 200000, `curl` exit 0 | 6.514 s |
| ICMP dropped, MSS clamped on `r` | 200000, `curl` exit 0 | 0.007 s |

Finally allow ICMP again and check that the healthy run is back, then stop the server:

```bash
ip netns exec r nft delete table inet mss
ip netns exec r nft delete table inet lab
ip netns exec b sh -c "echo 1 > /proc/sys/net/ipv4/route/flush"
ip netns exec a curl -s -o /dev/null -w "%{size_download} bytes in %{time_total}s\n" --max-time 5 http://10.1.2.10:8000/big.bin
pkill -x python3
```

```text
200000 bytes in 0.001872s
```

1. Explain in four sentences why the small page worked and the big file hung, although every link, route and address was correct. Use the words *MTU*, *DF* and *ICMP*.
2. The same segment was sent four times in the capture, with a doubling wait. Which TCP mechanism does that (Ch 2.3)? Why did resending the same size never help?
3. Fix 1 took about 6.5 seconds. What would a user of a web page behind such a network experience, and why would an operator have trouble reproducing it with `ping`?
4. Compare the two fixes: where does each run, what does each need to be allowed to change, and which still works if you do not control the router?
5. In the healthy run the first big packet was refused and then `b` adapted. Why does that adaptation not happen when the router's ICMP messages are dropped? Quote the part of RFC 1191 that the black hole breaks.

## Clean up

Deleting a namespace removes its cable ends and its nftables tables with it; background programs and files in `/tmp` go separately.

```bash
pkill -x tcpdump; pkill -x python3
for n in a r b net; do ip netns del $n; done
rm -rf /tmp/*.pcap /tmp/www
ip netns list; ip -br link
```

The last two commands should print no namespaces and only `lo` and `eth0`. In the throwaway container, `exit` removes everything anyway.
