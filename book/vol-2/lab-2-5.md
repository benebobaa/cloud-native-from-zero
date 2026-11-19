# Lab 2.5 · A CNI by Hand

## Goal

You will build a two-node pod network by hand, the way a CNI plugin does: pods as network namespaces on a bridge, NAT out of the node, and a VXLAN tunnel to a pod on a second node. Then you run the real reference CNI plugin through its contract and compare. You finish with a file of five shell functions, `cni.sh`; Milestone 2 uses it and Vol 6 turns it into a real plugin.

**Versions tested** (2026-11-17, two privileged `ubuntu:24.04` containers on one Docker network `172.29.0.0/24`; Docker Desktop, kernel 6.18.58.1-microsoft-standard-WSL2): iproute2 6.1.0, tcpdump 4.99.4, nftables 1.0.9, conntrack-tools 1.4.8, iptables 1.8.10 (nf\_tables), iperf3 3.16, containernetworking-plugins 1.1.1 (Ubuntu package `1.1.1+ds1-3ubuntu0.24.04.3`), Python 3.12.3. **Targeted, not run:** two Ubuntu 24.04 VMs (kernel 6.8) on one host-only network; the commands are the same once `DEV` names the VM's network card (Part A explains). MAC addresses, interface numbers, ICMP ids and timings differ on your machine.

**Before you start.** You need two Linux machines that can reach each other, and root on both. Two privileged containers on one Docker network are the cheapest pair and the route that was tested; all addresses below assume it. On your laptop:

```bash
docker network create --subnet 172.29.0.0/24 cnlab-net
docker run -d --privileged --name node-a --hostname node-a --network cnlab-net --ip 172.29.0.2 ubuntu:24.04 sleep infinity
docker run -d --privileged --name node-b --hostname node-b --network cnlab-net --ip 172.29.0.3 ubuntu:24.04 sleep infinity
```

Open two terminals: `docker exec -it node-a bash` in one, `docker exec -it node-b bash` in the other. Every code block below starts with a comment that says which node it runs on. In both terminals, install the tools and make the lab folder:

```bash
# on node A and on node B
apt-get update && apt-get install -y iproute2 tcpdump nftables iputils-ping conntrack iperf3 containernetworking-plugins iptables python3
mkdir -p ~/cn-lab/vol2/cni && cd ~/cn-lab/vol2/cni
ip -br addr show eth0
```

```text
eth0@if853       UP             172.29.0.2/24
```

Node B prints `172.29.0.3/24`. A privileged container can change its own network namespace freely and nothing leaks to your laptop's network. On two VMs, run `sudo -i` first and use the VMs' own addresses wherever this lab writes `172.29.0.2` and `172.29.0.3`.

### What you will build

{{diagram lab-2-5-01.jsx | what you will build in Lab 2.5 · two nodes, a bridge and pods on each, one VXLAN tunnel}}
Each node gets a bridge `cni0` with the gateway address `10.244.N.1`, its pods hang off it on veth pairs, and the two nodes are joined by `vxlan0`. Node A owns `10.244.1.0/24`, node B owns `10.244.2.0/24`.

## Part A · One node, two pods, by hand (30 min)

You will turn node A into a pod host: a bridge as the virtual switch, then two pods, each a network namespace with a veth cable into the bridge.

**A1. The bridge.** Four lines: make the bridge, give it the gateway address of node A's pod subnet, switch it on, and let the node route between interfaces.

```bash
# on node A
ip link add cni0 type bridge
ip addr add 10.244.1.1/24 dev cni0
ip link set cni0 up
sysctl -w net.ipv4.ip_forward=1
```

```text
net.ipv4.ip_forward = 1
```

**A2. The first pod, by hand.** `ip link add ... peer name eth0 netns p1` creates both ends of the cable at once and drops one end straight into the pod as `eth0`. `master cni0` plugs the other end into the bridge. The MTU is 1450, not 1500, because Part C will wrap every pod packet in 50 bytes of tunnel headers. `ip -n p1` is short for `ip netns exec p1 ip`.

```bash
# on node A
ip netns add p1
ip link add veth-p1 type veth peer name eth0 netns p1
ip link set veth-p1 master cni0 mtu 1450 up
ip -n p1 link set lo up
ip -n p1 link set eth0 mtu 1450 up
ip -n p1 addr add 10.244.1.2/24 dev eth0
ip -n p1 route add default via 10.244.1.1
ip -n p1 -br addr
ip -n p1 route
```

```text
lo               UNKNOWN        127.0.0.1/8 ::1/128
eth0@if4         UP             10.244.1.2/24 fe80::bc15:d3ff:fe0d:a52b/64
default via 10.244.1.1 dev eth0
10.244.1.0/24 dev eth0 proto kernel scope link src 10.244.1.2
```

The pod has an address, a route to its own subnet (added by the kernel) and a default route to the bridge.

**A3. The same steps as functions.** Typing seven lines per pod does not scale, so put them in a file. Save this as `~/cn-lab/vol2/cni/cni.sh` on **both** nodes; each function is one job a CNI plugin does. `DEV` names the node's own network card: `eth0` in the containers, often `enp0s3` or similar on a VM (`ip -br addr` shows it).

```bash
#!/bin/bash
# cni.sh: what a CNI plugin does, in five functions. Load it with:  . ./cni.sh
# Node N owns the pod subnet 10.244.N.0/24; the bridge cni0 is the node's gateway, 10.244.N.1.
MTU=${MTU:-1450}               # 1500 minus 50 bytes of VXLAN overhead (Part C)
DEV=${DEV:-eth0}               # the node's own network card; on a VM it may be enp0s3

node_up() {                    # node_up N : bridge + forwarding
  ip link add cni0 type bridge
  ip addr add 10.244.$1.1/24 dev cni0
  ip link set cni0 up
  sysctl -qw net.ipv4.ip_forward=1
}

nat_up() {                     # nat_up N : masquerade pod traffic that leaves the pod network
  nft add table ip cni
  nft add chain ip cni post '{ type nat hook postrouting priority srcnat ; }'
  nft add rule ip cni post ip saddr 10.244.$1.0/24 ip daddr != 10.244.0.0/16 oifname != cni0 masquerade
}

pod_add() {                    # pod_add NAME IP : the CNI "ADD" command
  local gw=${2%.*}.1
  ip netns add $1
  ip link add veth-$1 type veth peer name eth0 netns $1
  ip link set veth-$1 master cni0 mtu $MTU up
  ip -n $1 link set lo up
  ip -n $1 link set eth0 mtu $MTU up
  ip -n $1 addr add $2/24 dev eth0
  ip -n $1 route add default via $gw
}

pod_del() {                    # pod_del NAME : the CNI "DEL" command
  ip netns del $1
}

overlay_up() {                 # overlay_up N PEER_N PEER_IP : VXLAN tunnel to one other node
  local me=$(ip -4 -o addr show $DEV | awk '{print $4}' | cut -d/ -f1)
  ip link add vxlan0 type vxlan id 100 dstport 4789 local $me remote $3 dev $DEV
  ip addr add 10.244.$1.0/32 dev vxlan0
  ip link set vxlan0 up
  ip route add 10.244.$2.0/24 via 10.244.$2.0 dev vxlan0 onlink
}
```

`${2%.*}.1` cuts the last number off the pod's address and appends `.1`, so `10.244.1.3` gives the gateway `10.244.1.1`. `pod_del` is one line because deleting a namespace destroys the veth end inside it, and a veth pair never outlives its partner. Load the file and add the second pod with one call:

```bash
# on node A
cd ~/cn-lab/vol2/cni && . ./cni.sh
pod_add p2 10.244.1.3
bridge link
```

```text
4: veth-p1@eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 master cni0 state forwarding priority 32 cost 2
5: veth-p2@eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1450 master cni0 state forwarding priority 32 cost 2
```

Two ports on the switch, both in state `forwarding`.

**A4. Pod to pod, and what the switch learned.**

```bash
# on node A
ip netns exec p1 ping -c 2 10.244.1.3
ip -n p1 neigh
bridge fdb show br cni0 | grep -v permanent
```

```text
64 bytes from 10.244.1.3: icmp_seq=1 ttl=64 time=0.479 ms
64 bytes from 10.244.1.3: icmp_seq=2 ttl=64 time=0.085 ms
...
10.244.1.3 dev eth0 lladdr 4e:e5:47:a5:6f:15 REACHABLE
be:15:d3:0d:a5:2b dev veth-p1 master cni0
4e:e5:47:a5:6f:15 dev veth-p2 master cni0
```

`ttl=64` means no router was crossed: the bridge switched the frames. p1 learned p2's MAC by ARP (Ch 2.1), and the bridge learned which port each pod's MAC sits behind. Those MACs are the pods' own `eth0` addresses, not the `veth-p1` and `veth-p2` ends.

**A5. Watch it on the switch.** Empty both pods' neighbour caches, capture four frames on `cni0`, and ping once:

```bash
# on node A
ip -n p1 neigh flush all; ip -n p2 neigh flush all
tcpdump -Z root -n -e -i cni0 -c 4 -w /tmp/a.pcap 'arp or icmp' 2>/dev/null &
sleep 1
ip netns exec p1 ping -c 1 10.244.1.3 > /dev/null
sleep 1
pkill -x tcpdump; sleep 1
tcpdump -n -e -r /tmp/a.pcap 2>/dev/null
```

```text
09:26:14.134310 be:15:d3:0d:a5:2b > ff:ff:ff:ff:ff:ff, ethertype ARP (0x0806), length 42: Request who-has 10.244.1.3 tell 10.244.1.2, length 28
09:26:14.134318 4e:e5:47:a5:6f:15 > be:15:d3:0d:a5:2b, ethertype ARP (0x0806), length 42: Reply 10.244.1.3 is-at 4e:e5:47:a5:6f:15, length 28
09:26:14.134335 be:15:d3:0d:a5:2b > 4e:e5:47:a5:6f:15, ethertype IPv4 (0x0800), length 98: 10.244.1.2 > 10.244.1.3: ICMP echo request, id 2482, seq 1, length 64
09:26:14.134346 4e:e5:47:a5:6f:15 > be:15:d3:0d:a5:2b, ethertype IPv4 (0x0800), length 98: 10.244.1.3 > 10.244.1.2: ICMP echo reply, id 2482, seq 1, length 64
```

This is exactly Lab 2.1 on a real pod network: a broadcast ARP request, a unicast reply, then the ping. The whole exchange took 36 microseconds in this run. The filter 'arp or icmp' hides the IPv6 and IGMP chatter that every new interface sends, and pkill stops the capture even if a frame was missing.

1. Which command in A2 gives the pod its network card, and which one puts the cable into the switch?
2. Why does `ip -n p1 route` show a route you never typed?
3. The fdb lists two MACs. Which interface does each belong to, and why is neither of them `veth-p1`'s own MAC?
4. Would p1 still reach p2 with `net.ipv4.ip_forward=0`? Explain using the TTL you saw.

## Part B · Out of the node: NAT and conntrack (30 min)

You will let a pod reach a host outside the pod network, watch the first try fail, fix it with one nftables rule, and read what the kernel wrote down. Node B plays "the outside world": it has never heard of `10.244.1.0/24`.

**B1. Without NAT.** Start a capture on node B, then ping node B from p1. Node A forwards the packet because forwarding is on; nothing rewrites its source address.

```bash
# on node B
tcpdump -Z root -n -i eth0 -c 2 icmp -w /tmp/b1.pcap 2>/dev/null &
sleep 1
```

```bash
# on node A
ip netns exec p1 ping -c 2 -W 1 172.29.0.3; echo "exit=$?"
conntrack -L -p icmp 2>/dev/null | grep 172.29.0.3
```

```text
PING 172.29.0.3 (172.29.0.3) 56(84) bytes of data.

--- 172.29.0.3 ping statistics ---
2 packets transmitted, 0 received, 100% packet loss, time 1032ms

exit=1
icmp     1 27 src=10.244.1.2 dst=172.29.0.3 type=8 code=0 id=2490 [UNREPLIED] src=172.29.0.3 dst=10.244.1.2 type=0 code=0 id=2490 mark=0 use=1
```

```bash
# on node B
sleep 1; pkill -x tcpdump; sleep 1; tcpdump -n -r /tmp/b1.pcap 2>/dev/null
```

```text
03:11:53.557632 IP 10.244.1.2 > 172.29.0.3: ICMP echo request, id 2490, seq 1, length 64
03:11:53.557758 IP 172.29.0.3 > 10.244.1.2: ICMP echo reply, id 2490, seq 1, length 64
```

The request arrived with the pod's own address as its source, and node B answered. The answer went to B's default gateway, which knows nothing about `10.244.1.0/24`, so it never came back. Node A's connection tracking (conntrack) table shows the other side of the story: the entry is marked `[UNREPLIED]`, a flow that was seen going out and never seen coming back.

**B2. Masquerade.** `nat_up 1` from your `cni.sh` creates a table `cni`, a chain on the `postrouting` hook and one rule. Load the file again if you opened a new shell, run it, and print the table (`nft list table ip cni` prints only your table; plain `nft list ruleset` would also print Docker's):

```bash
# on node A
cd ~/cn-lab/vol2/cni && . ./cni.sh
nat_up 1
nft list table ip cni
```

```text
table ip cni {
	chain post {
		type nat hook postrouting priority srcnat; policy accept;
		ip saddr 10.244.1.0/24 ip daddr != 10.244.0.0/16 oifname != "cni0" masquerade
	}
}
```

Read the rule as one sentence: "a packet that comes from the pod subnet, is not going to another pod (any `10.244.x.x`), and is not leaving through the bridge, gets the address of its output interface as its source." Ping again with a capture running on node B:

```bash
# on node B
tcpdump -Z root -n -i eth0 -c 2 icmp -w /tmp/b2.pcap 2>/dev/null &
sleep 1
```

```bash
# on node A
conntrack -F > /dev/null 2>&1
ip netns exec p1 ping -c 2 172.29.0.3 | tail -4
conntrack -L -p icmp 2>/dev/null
```

```text
2 packets transmitted, 2 received, 0% packet loss, time 1022ms
rtt min/avg/max/mdev = 0.159/0.191/0.224/0.032 ms
icmp     1 27 src=10.244.1.2 dst=172.29.0.3 type=8 code=0 id=2514 src=172.29.0.3 dst=172.29.0.2 type=0 code=0 id=2514 mark=0 use=1
```

```bash
# on node B
sleep 1; pkill -x tcpdump; sleep 1; tcpdump -n -r /tmp/b2.pcap 2>/dev/null
```

```text
03:12:01.786992 IP 172.29.0.2 > 172.29.0.3: ICMP echo request, id 2514, seq 1, length 64
03:12:01.787033 IP 172.29.0.3 > 172.29.0.2: ICMP echo reply, id 2514, seq 1, length 64
```

Node B now sees node A's own address, so its answer goes back to node A. The conntrack entry has two halves. The left half, `src=10.244.1.2 dst=172.29.0.3`, is what the pod sent. The right half, `src=172.29.0.3 dst=172.29.0.2`, is what the reply will look like. The difference between them is the translation, written down. When the reply arrives, conntrack finds this entry and puts `10.244.1.2` back as the destination.

**B3. The packet's diary.** `meta nftrace set 1` marks a packet; `nft monitor trace` prints every chain and rule the marked packet meets. Add a chain at priority -300 (before everything else) that marks pings from p1 to node B, then ping once and read the trace. Lines are shortened at `...`.

```bash
# on node A
nft add chain ip cni pre '{ type filter hook prerouting priority -300 ; }'
nft add rule ip cni pre ip saddr 10.244.1.2 ip daddr 172.29.0.3 meta nftrace set 1
nft monitor trace > /tmp/trace.txt &
sleep 1
ip netns exec p1 ping -c 1 172.29.0.3 > /dev/null
sleep 1; pkill -x nft
cat /tmp/trace.txt
nft delete chain ip cni pre
```

```text
trace id 71759f50 ip cni pre packet: iif "cni0" ip saddr 10.244.1.2 ip daddr 172.29.0.3 ... ip ttl 64 ... icmp type echo-request
trace id 71759f50 ip cni pre rule ip saddr 10.244.1.2 ip daddr 172.29.0.3 meta nftrace set 1 (verdict continue)
trace id 71759f50 ip cni pre policy accept
trace id 2b248eec ip cni post packet: iif "cni0" oif "eth0" ip saddr 10.244.1.2 ip daddr 172.29.0.3 ... ip ttl 63 ... icmp type echo-request
trace id 2b248eec ip cni post rule ip saddr 10.244.1.0/24 ip daddr != 10.244.0.0/16 oifname != "cni0" masquerade (verdict accept)
```

The packet meets chain `pre` coming in from `cni0` with TTL 64, and chain `post` going out through `eth0` with TTL 63: node A routed it, and every routing step lowers the TTL by one. The masquerade rule fires in `post`. The two trace ids differ on this kernel, so follow the chain names.

1. Which line of the B1 capture proves the request reached node B, and why did the ping still fail?
2. In the B2 conntrack entry, which two fields differ between the left half and the right half? Which one would the pod see if you pinged from p2 instead?
3. The rule has `ip daddr != 10.244.0.0/16`. Part C sends p1's packets to a pod on node B. What would node B see as the source if the rule did not have that condition, and why does the Kubernetes network model forbid it?
4. The trace shows TTL 64 in `pre` and 63 in `post`. Which kernel step lowered it? Why did the ping in Part A (p1 to p2) show TTL 64?

## Part C · Between nodes: the VXLAN tunnel (40 min)

You will give node B its own pod network, join the two nodes with a VXLAN tunnel, and ping a pod on the other node. Then you capture the tunnel on the wire and measure what it costs.

**C1. Node B, and the tunnel on both ends.** Node B gets the same functions with its own number: subnet `10.244.2.0/24`, a bridge, masquerade, and one pod `p3`. `overlay_up N PEER_N PEER_IP` then makes the tunnel end `vxlan0` (VNI 100, UDP port 4789, local address taken from `DEV`, one fixed remote address), gives it the address `10.244.N.0/32`, and adds a route for the peer's pod subnet through the peer's `10.244.PEER.0`. `onlink` tells the kernel to trust that this next hop is reachable on `vxlan0`, although no connected subnet says so.

```bash
# on node B
cd ~/cn-lab/vol2/cni && . ./cni.sh
node_up 2
nat_up 2
pod_add p3 10.244.2.2
overlay_up 2 1 172.29.0.2
ip route
bridge fdb show dev vxlan0
```

```text
default via 172.29.0.1 dev eth0
10.244.1.0/24 via 10.244.1.0 dev vxlan0 onlink
10.244.2.0/24 dev cni0 proto kernel scope link src 10.244.2.1
172.29.0.0/24 dev eth0 proto kernel scope link src 172.29.0.3
00:00:00:00:00:00 dst 172.29.0.2 via eth0 self permanent
```

The last line is the tunnel's forwarding table: "any MAC address is reached by sending the wrapped frame to 172.29.0.2". That is the whole VXLAN configuration of a two-node overlay. Now the other end, on node A:

```bash
# on node A
cd ~/cn-lab/vol2/cni && . ./cni.sh
overlay_up 1 2 172.29.0.3
ip route
ip netns exec p1 ping -c 2 10.244.2.2
```

```text
default via 172.29.0.1 dev eth0
10.244.1.0/24 dev cni0 proto kernel scope link src 10.244.1.1
10.244.2.0/24 via 10.244.2.0 dev vxlan0 onlink
172.29.0.0/24 dev eth0 proto kernel scope link src 172.29.0.2
PING 10.244.2.2 (10.244.2.2) 56(84) bytes of data.
64 bytes from 10.244.2.2: icmp_seq=1 ttl=62 time=1.21 ms
64 bytes from 10.244.2.2: icmp_seq=2 ttl=62 time=0.236 ms
```

Pod p1 on node A reached pod p3 on node B. `ttl=62` means two routers forwarded the packet, node A and node B. Nothing translated the addresses: on node B, `conntrack -L -p icmp` shows `src=10.244.1.2 dst=10.244.2.2` in the left half and the same two addresses, swapped, in the right half. That is why the masquerade rule skips `10.244.0.0/16`.

**C2. The tunnel on the wire.** Capture on node A's real card, `eth0`, for UDP port 4789, and ping once. Emptying the neighbour caches first makes the capture include the ARP exchange that the tunnel carries.

```bash
# on node A
ip -n p1 neigh flush all; ip neigh flush dev vxlan0
tcpdump -Z root -n -e -i eth0 -c 4 -w /tmp/v.pcap udp port 4789 2>/dev/null &
sleep 1
ip netns exec p1 ping -c 1 10.244.2.2 > /dev/null
sleep 1; pkill -x tcpdump; sleep 1
tcpdump -n -e -r /tmp/v.pcap 2>/dev/null
```

```text
03:12:28.747917 56:e5:97:17:16:c1 > 22:f1:e6:80:68:d1, ethertype IPv4 (0x0800), length 92: 172.29.0.2.53285 > 172.29.0.3.4789: VXLAN, flags [I] (0x08), vni 100
0a:ec:58:16:3e:f6 > ff:ff:ff:ff:ff:ff, ethertype ARP (0x0806), length 42: Request who-has 10.244.2.0 tell 10.244.1.0, length 28
03:12:28.748026 22:f1:e6:80:68:d1 > 56:e5:97:17:16:c1, ethertype IPv4 (0x0800), length 92: 172.29.0.3.53285 > 172.29.0.2.4789: VXLAN, flags [I] (0x08), vni 100
ea:d5:a3:67:99:07 > 0a:ec:58:16:3e:f6, ethertype ARP (0x0806), length 42: Reply 10.244.2.0 is-at ea:d5:a3:67:99:07, length 28
03:12:28.748044 56:e5:97:17:16:c1 > 22:f1:e6:80:68:d1, ethertype IPv4 (0x0800), length 148: 172.29.0.2.53740 > 172.29.0.3.4789: VXLAN, flags [I] (0x08), vni 100
0a:ec:58:16:3e:f6 > ea:d5:a3:67:99:07, ethertype IPv4 (0x0800), length 98: 10.244.1.2 > 10.244.2.2: ICMP echo request, id 2574, seq 1, length 64
03:12:28.748146 22:f1:e6:80:68:d1 > 56:e5:97:17:16:c1, ethertype IPv4 (0x0800), length 148: 172.29.0.3.53740 > 172.29.0.2.4789: VXLAN, flags [I] (0x08), vni 100
ea:d5:a3:67:99:07 > 0a:ec:58:16:3e:f6, ethertype IPv4 (0x0800), length 98: 10.244.2.2 > 10.244.1.2: ICMP echo reply, id 2574, seq 1, length 64
```

Each captured packet prints two lines: the outer packet with a timestamp, and the pod's own frame that rides inside it. The outer packets are ordinary UDP between the two node addresses, to port 4789. The inner frames carry the MAC addresses of the two `vxlan0` devices, not of the pods. The sizes show the cost: the ARP frame is 42 bytes inside and 92 outside, the echo is 98 inside and 148 outside. Both differences are exactly 50 bytes.

**C3. The same ping, seen inside the tunnel.** Capture on `vxlan0` instead of `eth0`: the kernel has already unwrapped the packets there, so you see only what the pods sent. The filter leaves out the IPv6 chatter that a new interface sends.

```bash
# on node A
ip -n p1 neigh flush all; ip neigh flush dev vxlan0
tcpdump -Z root -n -e -i vxlan0 -c 4 -w /tmp/v2.pcap 'arp or icmp' 2>/dev/null &
sleep 1
ip netns exec p1 ping -c 1 10.244.2.2 > /dev/null
sleep 1; pkill -x tcpdump; sleep 1
tcpdump -n -e -r /tmp/v2.pcap 2>/dev/null
```

```text
03:15:13.514025 0a:ec:58:16:3e:f6 > ff:ff:ff:ff:ff:ff, ethertype ARP (0x0806), length 42: Request who-has 10.244.2.0 tell 10.244.1.0, length 28
03:15:13.514364 ea:d5:a3:67:99:07 > 0a:ec:58:16:3e:f6, ethertype ARP (0x0806), length 42: Reply 10.244.2.0 is-at ea:d5:a3:67:99:07, length 28
03:15:13.514649 0a:ec:58:16:3e:f6 > ea:d5:a3:67:99:07, ethertype IPv4 (0x0800), length 98: 10.244.1.2 > 10.244.2.2: ICMP echo request, id 2811, seq 1, length 64
03:15:13.514954 ea:d5:a3:67:99:07 > 0a:ec:58:16:3e:f6, ethertype IPv4 (0x0800), length 98: 10.244.2.2 > 10.244.1.2: ICMP echo reply, id 2811, seq 1, length 64
```

This is Lab 2.1 again, one level up: node A does not know the MAC address of its next hop `10.244.2.0`, so it broadcasts an ARP request into the tunnel. The tunnel's one forwarding entry sends that broadcast to node B, whose `vxlan0` owns `10.244.2.0` and answers.

**C4. The largest packet that fits.** The pod interfaces have MTU 1450. Send the biggest ping that keeps the do-not-fragment bit set (`-M do`): the payload is the MTU minus 28 bytes of IP and ICMP headers.

```bash
# on node A
ip netns exec p1 ping -c 1 -M do -s 1422 10.244.2.2 | head -2
ip netns exec p1 ping -c 1 -M do -s 1423 10.244.2.2 2>&1 | head -3
```

```text
PING 10.244.2.2 (10.244.2.2) 1422(1450) bytes of data.
1430 bytes from 10.244.2.2: icmp_seq=1 ttl=62 time=0.311 ms
PING 10.244.2.2 (10.244.2.2) 1423(1451) bytes of data.
ping: local error: message too long, mtu=1450
```

One byte more and the pod's own kernel refuses to send: the packet would not fit once wrapped in 50 bytes of tunnel headers inside a 1500-byte network. Break it makes a pod that does not know this.

1. In the C2 capture, which line holds the pod's source address and which line holds node A's? Which of the two would a firewall between the nodes see?
2. Why does the ARP request in C3 go to node B's `vxlan0` and not to p3 directly?
3. Add up the 50 bytes of overhead from the sizes in C2, field by field (Ethernet, IP, UDP, VXLAN). Which of the four would change if the tunnel ran over IPv6?
4. This lab's tunnel has one fixed `remote`. List what would have to change for a third node, and who should keep that list up to date in a real cluster.

## Part D · The real contract: run a CNI plugin by hand (30 min)

You will call the reference `bridge` plugin yourself, exactly as a container runtime does, read the JSON it prints, and compare its work with your `pod_add`. Everything in this part runs on node A. The plugins come from the `containernetworking-plugins` package you installed; on Ubuntu they sit in `/usr/lib/cni`.

**D1. The network configuration.** The runtime hands a plugin its configuration as JSON on standard input. `type` names the plugin binary, `bridge` the bridge to use (a new one, `cni1`, so it cannot disturb `cni0`), `isGateway` gives that bridge the gateway address, and `ipam` names a second plugin, `host-local`, that hands out addresses from a range and remembers them in files.

```bash
# on node A
cd ~/cn-lab/vol2/cni
cat > real.conf <<'EOF'
{
  "cniVersion": "1.0.0",
  "name": "real",
  "type": "bridge",
  "bridge": "cni1",
  "isGateway": true,
  "ipam": { "type": "host-local", "subnet": "10.250.1.0/24", "routes": [ { "dst": "0.0.0.0/0" } ] }
}
EOF
```

**D2. ADD.** The runtime's first job is to create the network namespace; you do that with `ip netns add`. Then the inputs travel as environment variables, the configuration on standard input, and the plugin prints its result on standard output:

```bash
# on node A
ip netns add real1
export CNI_CONTAINERID=real1 CNI_NETNS=/var/run/netns/real1 CNI_IFNAME=eth0 CNI_PATH=/usr/lib/cni
CNI_COMMAND=ADD /usr/lib/cni/bridge < real.conf; echo "exit=$?"
```

```text
{
    "cniVersion": "1.0.0",
    "interfaces": [
        { "name": "cni1",         "mac": "ca:50:86:a7:4d:64" },
        { "name": "veth914b9eae", "mac": "2a:d2:d7:5f:a9:f0" },
        { "name": "eth0",         "mac": "8a:49:38:d5:6d:87", "sandbox": "/var/run/netns/real1" }
    ],
    "ips": [ { "interface": 2, "address": "10.250.1.2/24", "gateway": "10.250.1.1" } ],
    "routes": [ { "dst": "0.0.0.0/0" } ],
    "dns": {}
}
exit=0
```

(The plugin prints the same data with one field per line; it is folded here to save space.) Read the result as a receipt. It lists three interfaces: the bridge, the host end of the cable, and the pod's `eth0` inside the sandbox. The address `10.250.1.2/24` belongs to interface number 2, the third entry. Exit code 0 means success.

**D3. Compare with `pod_add`.** Look at what the plugin built:

```bash
# on node A
ip -n real1 -br addr
ip -n real1 route
ip -br addr show cni1
bridge link | grep cni1
ls /var/lib/cni/networks/real
```

```text
lo               DOWN
eth0@if8         UP             10.250.1.2/24 fe80::8849:38ff:fed5:6d87/64
default via 10.250.1.1 dev eth0
10.250.1.0/24 dev eth0 proto kernel scope link src 10.250.1.2
cni1             UP             10.250.1.1/24 fe80::c850:86ff:fea7:4d64/64
8: veth914b9eae@eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 master cni1 state forwarding priority 32 cost 2
10.250.1.2
last_reserved_ip.0
lock
```

It is the same recipe as Part A, with four differences worth noticing:

| Your `pod_add` | The reference plugin |
| --- | --- |
| You choose the address on the command line | `host-local` picks the next free one and writes a file named `10.250.1.2` into `/var/lib/cni/networks/real/` |
| The host end of the cable is `veth-p1` | The name is random (`veth914b9eae`), so two pods never collide |
| MTU 1450, set explicitly | MTU 1500, the default; the configuration has an `mtu` field for this |
| `lo` is brought up inside `pod_add` | `lo` is still `DOWN`: bringing it up is the job of a second plugin, `loopback` |

The runtime would call the loopback plugin right after the bridge plugin. Do it yourself, then ping the gateway from inside the pod:

```bash
# on node A
echo '{"cniVersion":"1.0.0","name":"lo","type":"loopback"}' > lo.conf
CNI_IFNAME=lo CNI_COMMAND=ADD /usr/lib/cni/loopback < lo.conf > /dev/null
ip -n real1 -br addr
ip netns exec real1 ping -c 1 10.250.1.1 | tail -1
```

```text
lo               UNKNOWN        127.0.0.1/8 ::1/128
eth0@if8         UP             10.250.1.2/24 fe80::8849:38ff:fed5:6d87/64
rtt min/avg/max/mdev = 2.017/2.017/2.017/0.000 ms
```

**D4. DEL, twice.** `DEL` undoes `ADD`. The specification says a plugin must succeed when asked to delete something that is already gone, because a runtime may retry after a crash:

```bash
# on node A
CNI_COMMAND=DEL /usr/lib/cni/bridge < real.conf; echo "first DEL exit=$?"
CNI_COMMAND=DEL /usr/lib/cni/bridge < real.conf; echo "second DEL exit=$?"
ls /var/lib/cni/networks/real
```

```text
first DEL exit=0
second DEL exit=0
last_reserved_ip.0
lock
```

The address file `10.250.1.2` is gone: the plugin released the address and removed the host end of the cable. The bridge `cni1` stays, as it would in a cluster, and the namespace is still the runtime's to remove.

**D5. A failure.** Point the plugin at a namespace that does not exist:

```bash
# on node A
CNI_NETNS=/var/run/netns/nope CNI_COMMAND=ADD /usr/lib/cni/bridge < real.conf; echo "exit=$?"
```

```text
{
    "code": 999,
    "msg": "failed to open netns \"/var/run/netns/nope\": failed to Statfs \"/var/run/netns/nope\": no such file or directory"
}
exit=1
```

A failure is a non-zero exit code plus a JSON error on standard output. The runtime reads the code and the message, and treats the container's network setup as failed. Clean up this part:

```bash
# on node A
ip netns del real1; ip link del cni1; rm -rf /var/lib/cni/networks/real
unset CNI_CONTAINERID CNI_NETNS CNI_IFNAME CNI_PATH
```

1. Which of the four environment variables would the runtime change for the next Pod, and which stay the same? Where did the plugin get the IP range?
2. In the D2 result, how does `ips[0].interface` point at the Pod's `eth0`? What would the index be if the plugin did not create a bridge?
3. Why does the specification demand that a second `DEL` succeeds? What could go wrong if it returned an error?
4. `pod_del` in `cni.sh` is one line. List what the real `DEL` did that `pod_del` does not, and what would leak on a node whose runtime never called `DEL`.

## Checkpoint

You are done with Parts A to D when all of these hold. Run the first seven on node A, the last row on both. Paste the commands and your results into `~/cn-lab/vol2/lab-2.5.md`, and keep `cni.sh`: Milestone 2 uses it.

| Check | Expected |
| --- | --- |
| `bridge link \| grep -c "master cni0"` | `2` (p1 and p2 are ports of the bridge) |
| `ip netns exec p1 ping -c 2 10.244.1.3 \| grep -o "ttl=[0-9]*" \| tail -1` | `ttl=64` (same switch, no router) |
| `ip netns exec p1 ping -c 2 172.29.0.3 \| grep -o "ttl=[0-9]*" \| tail -1` | `ttl=63` (one router, node A, and masquerade) |
| `ip netns exec p1 ping -c 2 10.244.2.2 \| grep -o "ttl=[0-9]*" \| tail -1` | `ttl=62` (two routers, through the tunnel) |
| `ip netns exec p1 ping -c 1 -M do -s 1423 10.244.2.2 2>&1 \| grep -o "mtu=[0-9]*"` | `mtu=1450` |
| `nft list table ip cni \| grep -c masquerade` | `1` |
| `grep -c '^[a-z_]*() {' ~/cn-lab/vol2/cni/cni.sh` | `5` (`node_up`, `nat_up`, `pod_add`, `pod_del`, `overlay_up`) |
| `ip netns list \| wc -l` | `2` on node A (p1, p2) and `1` on node B (p3): Part D left nothing behind |
| Notebook | Answers to the questions of Parts A to D, the C2 capture, and the D2 result with a sentence on what each of its three interfaces is |

## Break it: a firewall that eats one ICMP message

Teams often "harden" nodes by dropping all ICMP. Pods that still believe their MTU is 1500, on a tunnel that carries only 1450, then work for pings and small requests and hang on big ones. You will build that outage, find it, and fix it twice.

**1. Set it up and see it work.** Make one pod on each node with MTU 1500, the default of the real plugin from Part D, and start an `iperf3` server in node B's pod. `iperf3` is a throughput tester; its server waits for a client.

```bash
# on node B
cd ~/cn-lab/vol2/cni && . ./cni.sh
MTU=1500 pod_add big3 10.244.2.9
ip netns exec big3 iperf3 -s -D
```

```bash
# on node A
cd ~/cn-lab/vol2/cni && . ./cni.sh
MTU=1500 pod_add big1 10.244.1.9
ip netns exec big1 ping -c 1 -M do -s 1472 10.244.2.9 | head -3
ip netns exec big1 iperf3 -c 10.244.2.9 -t 3 | tail -4 | head -2
```

```text
PING 10.244.2.9 (10.244.2.9) 1472(1500) bytes of data.
From 10.244.1.1 icmp_seq=1 Frag needed and DF set (mtu = 1450)

[  5]   0.00-3.01   sec   730 MBytes  2.03 Gbits/sec  1653             sender
[  5]   0.00-3.01   sec   724 MBytes  2.01 Gbits/sec                  receiver
```

The 1500-byte ping does not fit into the tunnel, and node A, the pod's gateway, says so with an ICMP message "fragmentation needed" (Ch 2.2, path MTU discovery). The pod's kernel learns that the path allows 1450 and sends smaller packets from then on. That is why `iperf3` works.

**2. Cause it.** Add the firewall rule: drop every ICMP "destination unreachable" message that node A sends. "Fragmentation needed" is one of them. Empty the pod's memory of the path first.

```bash
# on node A
nft add table inet fw
nft add chain inet fw out '{ type filter hook output priority 0 ; }'
nft add rule inet fw out icmp type destination-unreachable counter drop
ip -n big1 route flush cache
ip netns exec big1 ping -c 1 -W 2 -M do -s 1472 10.244.2.9 | head -4
ip netns exec big1 iperf3 -c 10.244.2.9 -t 4 --connect-timeout 3000 | tail -8
```

```text
PING 10.244.2.9 (10.244.2.9) 1472(1500) bytes of data.

--- 10.244.2.9 ping statistics ---
1 packets transmitted, 0 received, 100% packet loss, time 0ms
[  5]   2.00-3.01   sec  0.00 Bytes  0.00 bits/sec    0   1.41 KBytes
[  5]   3.01-4.00   sec  0.00 Bytes  0.00 bits/sec    1   1.41 KBytes
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-4.00   sec  0.00 Bytes  0.00 bits/sec    4             sender
[  5]   0.00-4.01   sec  0.00 Bytes  0.00 bits/sec                  receiver
```

The connection opens (the small packets of the handshake fit) and then moves nothing: 0 bytes, a congestion window stuck at 1.41 KBytes, a few retransmissions. The ping that worked before now gets no answer at all, not even an error.

**3. Diagnose it.** The signature is "small works, big does not". Find the boundary with `ping`, then count what the firewall ate:

```bash
# on node A
for s in 1472 1450 1423 1422; do printf "%s: " $s; ip netns exec big1 ping -c 1 -W 1 -M do -s $s 10.244.2.9 2>&1 | grep -E "bytes from|100%" | head -1; done
nft list chain inet fw out | grep counter
```

```text
1472: 1 packets transmitted, 0 received, 100% packet loss, time 0ms
1450: 1 packets transmitted, 0 received, 100% packet loss, time 0ms
1423: 1 packets transmitted, 0 received, 100% packet loss, time 0ms
1422: 1430 bytes from 10.244.2.9: icmp_seq=1 ttl=62 time=0.463 ms
		icmp type destination-unreachable counter packets 12 bytes 6912 drop
```

A payload of 1422 bytes (a 1450-byte packet) passes; 1423 does not. The boundary is exactly the tunnel's MTU, and the rule's counter shows the messages that would have told the pod so: 12 so far, and it grows with every retry. That the limit sits at 1450 and not at 1500 points to the tunnel, not to the pod.

**4. Fix it, first way: let the message through.** Delete the rule. The first big packet now triggers the ICMP message, and the pod caches the answer for ten minutes.

```bash
# on node A
nft delete table inet fw
ip netns exec big1 iperf3 -c 10.244.2.9 -t 3 | tail -4 | head -2
ip -n big1 route get 10.244.2.9 | head -2
```

```text
[  5]   0.00-3.00   sec  1.03 GBytes  2.95 Gbits/sec  1305             sender
[  5]   0.00-3.02   sec  1.03 GBytes  2.94 Gbits/sec                  receiver
10.244.2.9 via 10.244.1.1 dev eth0 src 10.244.1.9 uid 0
    cache expires 596sec mtu 1450
```

**5. Fix it, the better way: give the pod the right MTU.** Put the firewall back, then recreate both pods with the default `MTU` of `cni.sh`, 1450. No pod ever sends a packet that needs the message, so the firewall can drop it.

```bash
# on node A
nft add table inet fw
nft add chain inet fw out '{ type filter hook output priority 0 ; }'
nft add rule inet fw out icmp type destination-unreachable counter drop
ip netns del big1; sleep 1
pod_add big1 10.244.1.9
```

```bash
# on node B
pkill -x iperf3; ip netns del big3; sleep 1
pod_add big3 10.244.2.9
ip netns exec big3 iperf3 -s -D
```

```bash
# on node A
ip netns exec big1 iperf3 -c 10.244.2.9 -t 3 | tail -4 | head -2
nft list chain inet fw out | grep counter
```

```text
[  5]   0.00-3.00   sec  1.25 GBytes  3.58 Gbits/sec  973              sender
[  5]   0.00-3.01   sec  1.25 GBytes  3.58 Gbits/sec                   receiver
		icmp type destination-unreachable counter packets 0 bytes 0 drop
```

The firewall is still there and has dropped nothing. The `sleep 1` after `ip netns del` matters: the kernel removes the veth ends a moment after the namespace goes, and an immediate `pod_add` with the same name fails with "File exists".

**The measurement.** The chart compares four cases with the same command, repeated three times per case:

```bash
# on node A (flush the path memory between cases)
ip -n big1 route flush cache
for i in 1 2 3; do ip netns exec big1 iperf3 -c 10.244.2.9 -t 5 -f g | grep sender; done
```

{{diagram lab-2-5-02.jsx | measured on the test machine, 2026-11-17 · two privileged containers on Docker Desktop, iperf3 -t 5, 3 runs per case}}
The one finding to take from it: with the ICMP message dropped and a 1500-byte pod, every run moved 0 bytes. The other three rows only show that the tunnel works. Their spread is wide because two containers share one laptop under Docker Desktop, so do not read a ranking into 1.5 against 2.3 Gbit/s; node to node is faster because it skips the bridge, the tunnel and the wrapping.

1. Which message did the firewall drop, who sent it, and what did the pod do with it before the firewall existed?
2. The handshake and the ping with a small payload worked during the outage. Explain why only large packets died.
3. Fix 1 and fix 2 both restored traffic. Name one situation in which fix 1 does not help and fix 2 does (hint: whose firewall is it?), and one in which fix 2 does not help.

## Clean up

In the container route, removing the containers removes every namespace, bridge, tunnel and nftables rule. Copy `cni.sh` to your laptop first, because Milestone 2 needs it.

```bash
# on your laptop
mkdir -p ~/cn-lab/vol2/cni
docker cp node-a:/root/cn-lab/vol2/cni/cni.sh ~/cn-lab/vol2/cni/cni.sh
docker rm -f node-a node-b
docker network rm cnlab-net
```

On two VMs, delete the pieces yourself on each node. Errors for things that do not exist are harmless:

```bash
# on each VM, as root
pkill -x iperf3
for n in $(ip netns list | awk '{print $1}'); do ip netns del $n; done
ip link del cni0; ip link del vxlan0
nft delete table ip cni; nft delete table inet fw
```
