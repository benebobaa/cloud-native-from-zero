# Lab 2.1 · Watching ARP and Frames

## Goal

You will join two hosts with a virtual cable and watch ARP, replace the cable with a software switch and see who hears what, tag traffic with VLANs, break the MTU on purpose, and diagnose a duplicate IP address.

**Versions tested** (2026-11-16, privileged `ubuntu:24.04` container on Docker Desktop, kernel 6.18.58.1-microsoft-standard-WSL2): iproute2 6.1.0, tcpdump 4.99.4 with libpcap 1.10.4, iputils `ping` and `arping` 20240117. The container route is the one that was tested. A VM or a WSL2 Ubuntu 24.04 distro (run `sudo -i` first) is *targeted*: same commands, not run. Ubuntu 24.04's own kernel is 6.8 (targeted, not run). Every output below came from one run of these commands; MAC addresses, ids and timings differ on your machine, the shapes do not.

**Before you start.** Everything happens in network namespaces, which are private to the machine, so nothing touches your real network. The lab needs root. In a throwaway container:

```bash
mkdir -p ~/cn-lab && docker run -it --rm --privileged -v ~/cn-lab:/root/cn-lab --name cnlab-vol2 ubuntu:24.04 bash   # files saved under /root/cn-lab survive --rm
apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y iproute2 tcpdump iputils-ping iputils-arping
```

This lab needs only those four packages; later Vol 2 labs add more. Keep one terminal and your notebook `~/cn-lab/vol2/lab-2.1.md` open, and paste your own outputs into it. Start from a clean slate, which is also the clean-up block at the end:

```bash
for n in h1 h2 s1 s2 s3; do ip netns del $n 2>/dev/null; done
ip link del sw0 2>/dev/null
rm -f /tmp/*.pcap
```

### What you will build

{{diagram lab-2-1-01.jsx | what you will build in Lab 2.1 · a cable (Part A), then a switch with three hosts}}
## Part A · One cable, two hosts, ARP by hand (40 min)

You will join two hosts with a virtual cable, ping across it, and watch ARP appear in a capture.

**A1. Build the hosts and the cable.** Each `ip netns add` creates a host with its own empty network stack. `veth-h1` and `veth-h2` are the two ends of one cable; each end moves into its host and gets an address. `ip -n h1 ...` means "run this `ip` command inside host h1".

```bash
ip netns add h1
ip netns add h2
ip link add veth-h1 type veth peer name veth-h2
ip link set veth-h1 netns h1
ip link set veth-h2 netns h2
ip -n h1 addr add 10.0.0.1/24 dev veth-h1
ip -n h2 addr add 10.0.0.2/24 dev veth-h2
ip -n h1 link set veth-h1 up
ip -n h2 link set veth-h2 up
```

Look at what you built. The `link` view shows each interface's MAC address, and the neighbour cache of h1 is still empty:

```bash
ip -n h1 -br link show veth-h1
ip -n h2 -br link show veth-h2
ip -n h1 -br addr show veth-h1
ip -n h1 neigh
```

```text
veth-h1@if18     UP             46:4c:1d:d1:30:9f <BROADCAST,MULTICAST,UP,LOWER_UP> 
veth-h2@if19     UP             0e:b0:f4:b8:4f:b5 <BROADCAST,MULTICAST,UP,LOWER_UP> 
veth-h1@if18     UP             10.0.0.1/24 fe80::444c:1dff:fed1:309f/64 
```

The last command, `ip -n h1 neigh`, printed nothing: h1 knows no neighbours yet.

**A2. Capture while you ping.** `tcpdump` records frames on h1's end of the cable. `-Z root` stops it dropping privileges, which would make it fail silently when it overwrites a file; `-c 4` stops after four frames; `&` runs it in the background and `sleep 1` gives it time to start. `-e` prints the MAC addresses.

```bash
ip netns exec h1 tcpdump -Z root -n -e -i veth-h1 -c 4 -w /tmp/arp.pcap "arp or icmp" 2>/dev/null &
sleep 1
ip netns exec h1 ping -c 2 10.0.0.2
wait
tcpdump -n -e -r /tmp/arp.pcap 2>/dev/null
ip -n h1 neigh
```

```text
PING 10.0.0.2 (10.0.0.2) 56(84) bytes of data.
64 bytes from 10.0.0.2: icmp_seq=1 ttl=64 time=0.105 ms
64 bytes from 10.0.0.2: icmp_seq=2 ttl=64 time=0.059 ms

--- 10.0.0.2 ping statistics ---
2 packets transmitted, 2 received, 0% packet loss, time 1001ms
rtt min/avg/max/mdev = 0.059/0.082/0.105/0.023 ms
07:54:01.344970 46:4c:1d:d1:30:9f > ff:ff:ff:ff:ff:ff, ethertype ARP (0x0806), length 42: Request who-has 10.0.0.2 tell 10.0.0.1, length 28
07:54:01.345002 0e:b0:f4:b8:4f:b5 > 46:4c:1d:d1:30:9f, ethertype ARP (0x0806), length 42: Reply 10.0.0.2 is-at 0e:b0:f4:b8:4f:b5, length 28
07:54:01.345007 46:4c:1d:d1:30:9f > 0e:b0:f4:b8:4f:b5, ethertype IPv4 (0x0800), length 98: 10.0.0.1 > 10.0.0.2: ICMP echo request, id 880, seq 1, length 64
07:54:01.345027 0e:b0:f4:b8:4f:b5 > 46:4c:1d:d1:30:9f, ethertype IPv4 (0x0800), length 98: 10.0.0.2 > 10.0.0.1: ICMP echo reply, id 880, seq 1, length 64
10.0.0.2 dev veth-h1 lladdr 0e:b0:f4:b8:4f:b5 REACHABLE 
```

Four frames, in this order: the broadcast question, the unicast answer, the ping, the pong. The capture holds only the first ping's frames (`-c 4`); the second ping used the cache. This is the sequence drawn in the theory chapter.

**A3. Watch an entry go stale.** Wait for the entry to age, then ping once and capture again. Four frames are expected: the ping, its reply, and two ARP probes five seconds later.

```bash
sleep 45
ip -n h1 neigh
ip netns exec h1 tcpdump -Z root -n -e -i veth-h1 -c 4 -w /tmp/arp2.pcap "arp or icmp" 2>/dev/null &
sleep 1
ip netns exec h1 ping -c 1 10.0.0.2 > /dev/null
sleep 6
wait
tcpdump -n -e -r /tmp/arp2.pcap 2>/dev/null
ip -n h1 neigh
```

```text
10.0.0.2 dev veth-h1 lladdr 0e:b0:f4:b8:4f:b5 STALE 
07:54:48.483044 46:4c:1d:d1:30:9f > 0e:b0:f4:b8:4f:b5, ethertype IPv4 (0x0800), length 98: 10.0.0.1 > 10.0.0.2: ICMP echo request, id 887, seq 1, length 64
07:54:48.483082 0e:b0:f4:b8:4f:b5 > 46:4c:1d:d1:30:9f, ethertype IPv4 (0x0800), length 98: 10.0.0.2 > 10.0.0.1: ICMP echo reply, id 887, seq 1, length 64
07:54:53.573676 46:4c:1d:d1:30:9f > 0e:b0:f4:b8:4f:b5, ethertype ARP (0x0806), length 42: Request who-has 10.0.0.2 tell 10.0.0.1, length 28
07:54:53.573720 0e:b0:f4:b8:4f:b5 > 46:4c:1d:d1:30:9f, ethertype ARP (0x0806), length 42: Request who-has 10.0.0.1 tell 10.0.0.2, length 28
10.0.0.2 dev veth-h1 lladdr 0e:b0:f4:b8:4f:b5 REACHABLE 
```

The ping was answered at once, using the `STALE` entry. About five seconds later (07:54:48.48 to 07:54:53.57 is 5.1 seconds) h1 sent a *unicast* who-has to h2's MAC, and h2 did the same towards h1. The entry is `REACHABLE` again.

**A4. Empty the cache.** A flushed entry is simply asked for again at the next packet.

```bash
ip -n h1 neigh flush all
ip -n h1 neigh
```

The second command prints nothing.

1. In the A2 trace, which frame is a broadcast, and which field tells you? How does the destination MAC of frame 1 differ from that of frame 3, and why?
2. h2 sent the echo reply without any ARP request of its own. Which rule of RFC 826 (see the theory) explains where h2 got h1's MAC?
3. In A3 the ping was not delayed although the entry was `STALE`. Why can the kernel use an entry it calls "suspicious", and what did the unicast who-has achieve?
4. *Predict:* after A4, you ping again and capture. What is the first frame, and who sends it? Check with the A2 commands.

## Part B · Replace the cable with a switch (50 min)

You will build a Linux bridge with three hosts, see that a bystander hears only the broadcast, and force the switch to flood a frame it cannot place.

**B1. Build the switch.** Remove the two hosts of Part A. Create the bridge `sw0`, then repeat three times: make a host `s$i`, make a cable whose one end `port$i` stays outside and plugs into the bridge, and whose other end becomes `eth0` inside the host.

```bash
ip netns del h1; ip netns del h2
ip link add sw0 type bridge
ip link set sw0 up
for i in 1 2 3; do
  ip netns add s$i
  ip link add port$i type veth peer name eth0 netns s$i
  ip link set port$i master sw0 up
  ip -n s$i addr add 10.0.1.$i/24 dev eth0
  ip -n s$i link set eth0 up
done
```

Inspect the ports, the hosts' MACs and the switch's MAC table. `grep -v permanent` hides the bridge's own entries:

```bash
bridge link show
for i in 1 2 3; do ip -n s$i -br link show eth0; done
bridge fdb show br sw0 | grep -v permanent
```

```text
21: port1@eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 master sw0 state forwarding priority 32 cost 2 
22: port2@eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 master sw0 state forwarding priority 32 cost 2 
23: port3@eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 master sw0 state forwarding priority 32 cost 2 
eth0@if21        UP             0a:0c:58:0e:06:52 <BROADCAST,MULTICAST,UP,LOWER_UP> 
eth0@if22        UP             de:5c:31:ae:2a:e4 <BROADCAST,MULTICAST,UP,LOWER_UP> 
eth0@if23        UP             1e:e6:c3:21:df:25 <BROADCAST,MULTICAST,UP,LOWER_UP> 
0a:0c:58:0e:06:52 dev port1 master sw0 
de:5c:31:ae:2a:e4 dev port2 master sw0 
1e:e6:c3:21:df:25 dev port3 master sw0 
```

The switch already knows all three hosts, although nobody has pinged. When an interface comes up the kernel sends a few IPv6 frames by itself, and the bridge learned each source MAC from them. Each MAC in the table equals the `eth0` MAC of the host behind that port.

**B2. Who hears the ARP request?** s3 is a bystander. Capture on s3 and on s2 while s1 pings s2. s3 stops after one frame; `pkill` is a safety net.

```bash
ip netns exec s3 tcpdump -Z root -n -e -i eth0 -c 1 -w /tmp/s3.pcap "arp or icmp" 2>/dev/null &
ip netns exec s2 tcpdump -Z root -n -e -i eth0 -c 3 -w /tmp/s2.pcap "arp or icmp" 2>/dev/null &
sleep 1
ip netns exec s1 ping -c 1 10.0.1.2 > /dev/null
sleep 1; pkill -x tcpdump; sleep 0.5
echo "-- s3 (bystander)"; tcpdump -n -e -r /tmp/s3.pcap 2>/dev/null
echo "-- s2 (target)"; tcpdump -n -e -r /tmp/s2.pcap 2>/dev/null
ip -n s1 neigh
ip -n s3 neigh
```

```text
-- s3 (bystander)
07:54:57.605842 0a:0c:58:0e:06:52 > ff:ff:ff:ff:ff:ff, ethertype ARP (0x0806), length 42: Request who-has 10.0.1.2 tell 10.0.1.1, length 28
-- s2 (target)
07:54:57.605845 0a:0c:58:0e:06:52 > ff:ff:ff:ff:ff:ff, ethertype ARP (0x0806), length 42: Request who-has 10.0.1.2 tell 10.0.1.1, length 28
07:54:57.605876 de:5c:31:ae:2a:e4 > 0a:0c:58:0e:06:52, ethertype ARP (0x0806), length 42: Reply 10.0.1.2 is-at de:5c:31:ae:2a:e4, length 28
07:54:57.605890 0a:0c:58:0e:06:52 > de:5c:31:ae:2a:e4, ethertype IPv4 (0x0800), length 98: 10.0.1.1 > 10.0.1.2: ICMP echo request, id 921, seq 1, length 64
10.0.1.2 dev eth0 lladdr de:5c:31:ae:2a:e4 REACHABLE 
```

The bystander s3 heard exactly one frame, the broadcast question. The answer and the ping were forwarded to one port each. The last command, `ip -n s3 neigh`, printed nothing: s3 learned no addresses.

**B3. Make the switch flood a unicast.** Delete s1's entry from the MAC table, then let s2 ping s1. The switch no longer knows where s1 is, so it must flood the frame to find out.

```bash
S1MAC=$(ip -n s1 -br link show eth0 | awk '{print $3}')
bridge fdb del $S1MAC dev port1 master
bridge fdb show br sw0 | grep -v permanent
ip netns exec s3 tcpdump -Z root -n -e -i eth0 -c 1 -w /tmp/flood.pcap "icmp" 2>/dev/null &
sleep 1
ip netns exec s2 ping -c 1 10.0.1.1 > /dev/null
sleep 1; pkill -x tcpdump; sleep 0.5
tcpdump -n -e -r /tmp/flood.pcap 2>/dev/null
bridge fdb show br sw0 | grep -v permanent
```

```text
de:5c:31:ae:2a:e4 dev port2 master sw0 
1e:e6:c3:21:df:25 dev port3 master sw0 
07:55:00.322039 de:5c:31:ae:2a:e4 > 0a:0c:58:0e:06:52, ethertype IPv4 (0x0800), length 98: 10.0.1.2 > 10.0.1.1: ICMP echo request, id 939, seq 1, length 64
0a:0c:58:0e:06:52 dev port1 master sw0 
de:5c:31:ae:2a:e4 dev port2 master sw0 
1e:e6:c3:21:df:25 dev port3 master sw0 
```

The first table lacks s1. s3 then captured an echo request addressed to *s1's* MAC: an *unknown-unicast flood*. s1's reply carried s1's source MAC, so the switch learned it again, and the last table has all three hosts.

1. In B2, s3 captured only the broadcast. Name the three rules of a switch (theory, part 3) and say which one each of the three frames s2 captured triggered.
2. After B2, `ip -n s3 neigh` is empty although s3 heard a who-has. Which rule of RFC 826 explains this?
3. In B3, why did s3 see the echo request but not s1's reply? What does that tell you about when a bystander can read someone else's traffic, and what protects the wallet's data then (Ch 2.4)?
4. *Predict, do not run:* you add a second cable between `sw0` and one host, so two paths exist. Spanning tree is off on this bridge. What happens to the first broadcast, and why?

## Part C · VLAN tags (40 min)

You will give each host a VLAN sub-interface, see the 4-byte tag in a capture, and show that a host in VLAN 20 cannot resolve a neighbour in VLAN 10.

**C1. Create the sub-interfaces.** s1 and s2 get `eth0.10` (VLAN 10) with addresses in `10.0.10.0/24`. s3 gets `eth0.20` (VLAN 20) and, on purpose, an address in the same subnet.

```bash
for i in 1 2; do
  ip -n s$i link add link eth0 name eth0.10 type vlan id 10
  ip -n s$i addr add 10.0.10.$i/24 dev eth0.10
  ip -n s$i link set eth0.10 up
done
ip -n s3 link add link eth0 name eth0.20 type vlan id 20
ip -n s3 addr add 10.0.10.3/24 dev eth0.20
ip -n s3 link set eth0.20 up
ip -n s1 -d link show eth0.10
ip -n s1 -br addr show eth0.10
```

```text
3: eth0.10@eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default qlen 1000
    link/ether 0a:0c:58:0e:06:52 brd ff:ff:ff:ff:ff:ff promiscuity 0  allmulti 0 minmtu 0 maxmtu 65535 
    vlan protocol 802.1Q id 10 <REORDER_HDR> addrgenmode eui64 numtxqueues 1 numrxqueues 1 gso_max_size 65536 gso_max_segs 65535 tso_max_size 524280 tso_max_segs 65535 gro_max_size 65536 
eth0.10@eth0     UP             10.0.10.1/24 fe80::80c:58ff:fe0e:652/64 
```

The sub-interface has the same MAC as `eth0`; the line `vlan protocol 802.1Q id 10` is what makes it tag its frames.

**C2. Ping inside VLAN 10 and watch from VLAN 20.** The filter `vlan and arp` matches tagged ARP frames. s3 captures on its plain `eth0`, below the VLAN sub-interface, so it sees the raw tag.

```bash
ip netns exec s3 tcpdump -Z root -n -e -i eth0 -c 1 -w /tmp/vlan.pcap "vlan and arp" 2>/dev/null &
sleep 1
ip netns exec s1 ping -c 2 10.0.10.2 | tail -2
sleep 1; pkill -x tcpdump; sleep 0.5
tcpdump -n -e -r /tmp/vlan.pcap 2>/dev/null
```

```text
2 packets transmitted, 2 received, 0% packet loss, time 1021ms
rtt min/avg/max/mdev = 0.081/0.257/0.433/0.176 ms
07:55:03.496663 0a:0c:58:0e:06:52 > ff:ff:ff:ff:ff:ff, ethertype 802.1Q (0x8100), length 46: vlan 10, p 0, ethertype ARP (0x0806), Request who-has 10.0.10.2 tell 10.0.10.1, length 28
```

The frame is now `ethertype 802.1Q (0x8100)`, 46 bytes long (42 plus the 4-byte tag), with `vlan 10` and priority `p 0`; the inner ARP request is unchanged.

**C3. VLAN 20 cannot ask VLAN 10.** s3 pings the address of s1's VLAN 10 interface from its own VLAN 20 interface:

```bash
ip netns exec s3 ping -c 2 -W 1 10.0.10.1
ip -n s3 neigh show dev eth0.20
```

```text
PING 10.0.10.1 (10.0.10.1) 56(84) bytes of data.

--- 10.0.10.1 ping statistics ---
2 packets transmitted, 0 received, 100% packet loss, time 1025ms

10.0.10.1 INCOMPLETE 
```

`INCOMPLETE` means s3 asked who-has and nobody answered. If you wait a few seconds and repeat the `ip -n s3 neigh` command, the state becomes `FAILED`.

A caution about what this proves. Your bridge does not understand VLANs: it flooded the tagged broadcast out of every port, so s3's cable carried it (you captured it in C2). The separation is done by s3's kernel, which has no VLAN 10 interface and so drops the frame. A real switch configures each port with the VLANs it may carry and never sends VLAN 10 frames to s3's port at all.

1. Which field of the frame carries the number 10, and how many bytes longer is the tagged ARP request than the untagged one in Part A?
2. s3 captured the VLAN 10 frame but never answered it. Where exactly was the frame discarded?
3. *Predict, then check:* run `ip netns exec s3 tcpdump -n -e -i eth0 -c 2 "vlan 20 and arp"` in the background and repeat C3. Which frames will s3 send, and will anything reach s1?

## Part D · MTU: when sizes disagree (30 min)

You will find the largest packet that fits, then break the MTU first on the sender and then on the receiver, and compare the two failures.

**D1. A packet that exactly fits.** `ping -s 1472` sends 1472 bytes of data. With the 8-byte ICMP header and the 20-byte IP header that is 1500 bytes, the MTU. `-M do` sets the "do not fragment" flag, so the kernel refuses to split the packet.

```bash
ip netns exec s1 ping -c 1 -M do -s 1472 10.0.1.2 | head -2
```

```text
PING 10.0.1.2 (10.0.1.2) 1472(1500) bytes of data.
1480 bytes from 10.0.1.2: icmp_seq=1 ttl=64 time=0.070 ms
```

**D2. Lower the sender's MTU (a loud failure).** Set s1's `eth0` to 1400 and send the same ping, then a smaller one that fits:

```bash
ip -n s1 link set eth0 mtu 1400
ip netns exec s1 ping -c 1 -M do -s 1472 10.0.1.2
ip netns exec s1 ping -c 1 -M do -s 1372 10.0.1.2 | head -2
ip -n s1 link set eth0 mtu 1500
```

```text
PING 10.0.1.2 (10.0.1.2) 1472(1500) bytes of data.
ping: local error: message too long, mtu=1400

--- 10.0.1.2 ping statistics ---
1 packets transmitted, 0 received, +1 errors, 100% packet loss, time 0ms

PING 10.0.1.2 (10.0.1.2) 1372(1400) bytes of data.
1380 bytes from 10.0.1.2: icmp_seq=1 ttl=64 time=0.094 ms
```

The kernel refused to send and named the limit, `mtu=1400`. The smaller packet, 1372 + 28 = 1400 bytes, fits exactly.

**D3. Lower the receiver's MTU (a silent failure).** Now s1 keeps 1500 and s2's `eth0` drops to 1400. The big ping leaves s1 happily; check s2's receive counters:

```bash
ip -n s2 link set eth0 mtu 1400
ip netns exec s1 ping -c 2 -W 1 -M do -s 1472 10.0.1.2
ip -n s2 -s link show eth0
ip netns exec s1 ping -c 2 -W 1 -M do -s 1372 10.0.1.2 | tail -3
ip -n s2 link set eth0 mtu 1500
```

```text
PING 10.0.1.2 (10.0.1.2) 1472(1500) bytes of data.

--- 10.0.1.2 ping statistics ---
2 packets transmitted, 0 received, 100% packet loss, time 1028ms

2: eth0@if22: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1400 qdisc noqueue state UP mode DEFAULT group default qlen 1000
    link/ether de:5c:31:ae:2a:e4 brd ff:ff:ff:ff:ff:ff link-netnsid 0
    RX:  bytes packets errors dropped  missed   mcast           
          7172      56      0       2       0       0 
    TX:  bytes packets errors dropped carrier collsns           
          4730      25      0       0       0       0 
--- 10.0.1.2 ping statistics ---
2 packets transmitted, 2 received, 0% packet loss, time 1018ms
rtt min/avg/max/mdev = 0.078/0.344/0.610/0.266 ms
```

No error, no reply: both big pings vanished, the receive counter `dropped` is 2, and small pings still work. That is the symptom of an MTU mismatch inside a network: the sender cannot know, because a switch sends no "too big" message.

1. Why is the largest ping data size 1472 and not 1500?
2. D2 failed before anything was sent; D3 sent the packet and lost it. Which is easier to diagnose, and what would you check first on a path of three switches in D3's situation?
3. *Design:* a tunnel adds 50 bytes of header to every packet and the physical links stay at MTU 1500. What MTU should you set on the interface inside the tunnel, and why?

## Checkpoint

You are done with Parts A to D when all of these hold. The capture files are still in `/tmp`, and the switch and hosts of Parts B to D are still up. Paste the commands and your results into `~/cn-lab/vol2/lab-2.1.md`.

| Check | Expected |
| --- | --- |
| `tcpdump -n -e -r /tmp/arp.pcap 2>/dev/null \| grep -c ARP` | `2` (request and reply of Part A) |
| `tcpdump -n -r /tmp/s3.pcap 2>/dev/null \| wc -l` | `1` (the bystander heard only the broadcast) |
| `tcpdump -n -r /tmp/flood.pcap 2>/dev/null \| grep -c "10.0.1.2 > 10.0.1.1"` | `1` (the flooded unicast) |
| `bridge fdb show br sw0 \| grep -v permanent \| wc -l` | `3` (the switch knows s1, s2 and s3) |
| `tcpdump -n -e -r /tmp/vlan.pcap 2>/dev/null \| grep -c "vlan 10"` | `1` |
| `ip -n s1 -d link show eth0.10 \| grep -o "vlan protocol 802.1Q id 10"` | `vlan protocol 802.1Q id 10` |
| `ip -n s3 neigh show dev eth0.20` | `10.0.10.1` with `INCOMPLETE` right after the pings, or `FAILED` later; never `REACHABLE` |
| `ip netns exec s1 ping -c 1 -M do -s 1472 10.0.1.2 \| grep -c "1480 bytes"` | `1` (MTU back at 1500) |
| Notebook | Answers to the questions of Parts A to D, and the MAC addresses of h1, h2 and s1 to s3 on your machine |

## Break it: two hosts, one address

A duplicate IP address is a classic fault: a static address overlaps a DHCP range, or a cloned machine keeps its old settings. Everything seems to work, which is what makes it hard. s3 will now claim the address of s2, the host you used as the "wallet database".

**1. Cause it.**

```bash
ip -n s3 addr add 10.0.1.2/24 dev eth0
```

**2. Ask who owns 10.0.1.2.** `arping` sends ARP requests and prints every reply with its MAC. A healthy address prints one MAC.

```bash
ip -n s1 neigh flush all
ip netns exec s1 arping -c 3 -I eth0 10.0.1.2
```

```text
ARPING 10.0.1.2 from 10.0.1.1 eth0
Unicast reply from 10.0.1.2 [1E:E6:C3:21:DF:25]  0.586ms
Unicast reply from 10.0.1.2 [DE:5C:31:AE:2A:E4]  0.710ms
Unicast reply from 10.0.1.2 [DE:5C:31:AE:2A:E4]  0.561ms
Unicast reply from 10.0.1.2 [DE:5C:31:AE:2A:E4]  0.544ms
Sent 3 probes (1 broadcast(s))
Received 4 response(s)
```

Two different MACs answer. The first probe is a broadcast and both hosts replied; `arping` then switched to unicast probes towards one of them.

**3. Find the intruder's port.** The switch's MAC table maps each MAC to a port:

```bash
bridge fdb show br sw0 | grep -v permanent
```

```text
0a:0c:58:0e:06:52 dev port1 master sw0 
de:5c:31:ae:2a:e4 dev port2 master sw0 
1e:e6:c3:21:df:25 dev port3 master sw0 
```

The MAC `1e:e6:...` sits behind `port3`, which is s3. Now watch what a normal ping does and what s1 caches:

```bash
ip netns exec s1 tcpdump -Z root -n -e -i eth0 -c 4 -w /tmp/dup.pcap "arp" 2>/dev/null &
sleep 1
ip netns exec s1 ping -c 1 10.0.1.2 | tail -3
ip -n s1 neigh show 10.0.1.2
sleep 1; pkill -x tcpdump; sleep 0.5
tcpdump -n -e -r /tmp/dup.pcap 2>/dev/null
```

```text
--- 10.0.1.2 ping statistics ---
1 packets transmitted, 1 received, 0% packet loss, time 0ms
rtt min/avg/max/mdev = 0.087/0.087/0.087/0.000 ms
10.0.1.2 dev eth0 lladdr 1e:e6:c3:21:df:25 REACHABLE 
07:55:16.460763 0a:0c:58:0e:06:52 > ff:ff:ff:ff:ff:ff, ethertype ARP (0x0806), length 42: Request who-has 10.0.1.2 tell 10.0.1.1, length 28
07:55:16.460795 1e:e6:c3:21:df:25 > 0a:0c:58:0e:06:52, ethertype ARP (0x0806), length 42: Reply 10.0.1.2 is-at 1e:e6:c3:21:df:25, length 28
07:55:16.460802 de:5c:31:ae:2a:e4 > 0a:0c:58:0e:06:52, ethertype ARP (0x0806), length 42: Reply 10.0.1.2 is-at de:5c:31:ae:2a:e4, length 28
```

The ping *succeeded*, but s1 cached the MAC of s3, so its packets went to the wrong host. One request drew two replies, 7 microseconds apart; s1 kept the first. Repeat the question six times and the cache decides again each time:

```bash
for i in 1 2 3 4 5 6; do ip -n s1 neigh flush all; ip netns exec s1 ping -c 1 10.0.1.2 > /dev/null; ip -n s1 neigh show 10.0.1.2; done
```

On the test run s3's MAC won all six times. Do not read that as a rule: it depends on which reply arrives first, so on another network the winner can change and the fault looks random.

**4. Fix it and verify.**

```bash
ip -n s3 addr del 10.0.1.2/24 dev eth0
ip -n s1 neigh flush all
ip netns exec s1 arping -c 2 -I eth0 10.0.1.2
```

Only one MAC answers now: s2's, the same one `ip -n s2 -br link show eth0` prints.

1. A real wallet API would have connected to the "database" and received answers from the wrong machine. What would the symptom look like to the wallet, and why would `ping` not reveal it?
2. Which two commands of this chapter proved there were two owners, and which one told you which switch port to look at?
3. RFC 5227 asks a host to send an ARP probe before using an address. What would a host see if it did so on this network, and what should it then do?

## Clean up

Removing a namespace removes the cable ends inside it, which removes the ports too; the bridge and the capture files go separately.

```bash
for n in h1 h2 s1 s2 s3; do ip netns del $n 2>/dev/null; done
ip link del sw0 2>/dev/null
rm -f /tmp/*.pcap
ip netns list
```

The last command prints nothing. If you used the container, `exit` removes everything else.
