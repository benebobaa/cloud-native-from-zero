# Lab 2.3 · Sockets and the TCP Handshake

## Goal

You will watch TCP work with your own tools: see the sockets behind one connection, capture a handshake and a teardown packet by packet, compare it with UDP, measure what delay and packet loss do to throughput, tell "refused" from "timed out", and run a client out of ports.

**Versions tested** (2026-11-16, privileged `ubuntu:24.04` container; kernel 6.18.58.1-microsoft-standard-WSL2 on Docker Desktop): iproute2 6.1.0, tcpdump 4.99.4, nftables 1.0.9, curl 8.5.0, Python 3.12.3, iperf3 3.16, conntrack-tools 1.4.8, netcat-openbsd 1.226. **Targeted, not run:** the same commands in a VM or WSL2 distro, and Ubuntu 24.04's own kernel (6.8). Ports, PIDs, timestamps and every number that depends on random loss or machine speed will differ on your machine.

**Throughput figures are a shape, not a benchmark.** The two charts in Part D come from one earlier quiet run of the scripts below on a veth pair inside a single WSL2 VM; I re-ran the delay script later and got the same shape with different digits. Only the *shape* (what falls, by how much, in which order) transfers to your machine.

## What you will build

{{diagram lab-2-3-01.jsx | what you will build in Lab 2.3 · one panel per part}}
Every part uses this one pair of namespaces. Part D puts `netem`, the kernel's network emulator, on both ends of the cable to add delay and loss; Part E puts a firewall on the server side.

**Before you start.** Everything runs as root, inside network namespaces, so nothing touches your real network. Two routes:

- **Container (the route that was tested):** `mkdir -p ~/cn-lab && docker run -it --rm --privileged -v ~/cn-lab:/root/cn-lab --name cnlab-vol2 ubuntu:24.04 bash`, then inside it run the install line below. Files saved under /root/cn-lab survive the container.
- **VM or WSL2 (targeted):** open a root shell with `sudo -i` and run the install line.

```bash
DEBIAN_FRONTEND=noninteractive apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y iproute2 tcpdump nftables iputils-ping curl python3 netcat-openbsd iperf3 conntrack
mkdir -p ~/cn-lab/vol2 && cd ~/cn-lab/vol2
```

**Set up the lab network (5 min).** Two namespaces, `cli` and `srv`, joined by one virtual cable (a veth pair). If you built namespaces with these names in an earlier lab, delete them first.

```bash
ip netns del cli 2>/dev/null; ip netns del srv 2>/dev/null
ip netns add cli; ip netns add srv
ip link add veth-c type veth peer name veth-s
ip link set veth-c netns cli; ip link set veth-s netns srv
ip -n cli addr add 10.2.0.1/24 dev veth-c; ip -n srv addr add 10.2.0.2/24 dev veth-s
ip -n cli link set veth-c up; ip -n srv link set veth-s up
ip -n cli link set lo up;     ip -n srv link set lo up
ip netns exec cli ping -c 1 10.2.0.2
```

`ip -n cli ...` is shorthand for `ip netns exec cli ip ...`; every other command needs the full `ip netns exec NAME` prefix. The ping prints one reply and `1 packets transmitted, 1 received, 0% packet loss`; the round trip over the virtual cable is under a millisecond (0.088 ms on the test machine).

## Part A · Sockets and the 5-tuple (35 min)

You will make a listening socket, connect to it, and read both ends of the connection with `ss`.

Start a listener in `srv` on port 9000. `nc -l` listens once; the output goes to `/dev/null`. The `&` puts it in the background of your shell, and `sleep 0.5` gives it time to bind.

```bash
ip netns exec srv nc -l 9000 > /dev/null &
sleep 0.5
ip netns exec srv ss -tlnp
```

```text
State  Recv-Q Send-Q Local Address:Port Peer Address:PortProcess
LISTEN 0      1            0.0.0.0:9000      0.0.0.0:*    users:("nc",pid=3179,fd=3)
```

Read it: state `LISTEN`; `0.0.0.0` means "any address of this namespace"; `Recv-Q` 0 connections wait to be accepted; `Send-Q` 1 is the backlog that `nc` asked for; the process holds the listening socket as file descriptor 3. Now connect from `cli`. The `(sleep 30) |` keeps `nc`'s input open so the connection stays up for 30 seconds.

```bash
(sleep 30) | ip netns exec cli nc 10.2.0.2 9000 &
sleep 1
ip netns exec cli ss -tnp
ip netns exec srv ss -tan
ip netns exec srv ss -tnp
```

```text
State Recv-Q Send-Q Local Address:Port  Peer Address:PortProcess
ESTAB 0      0           10.2.0.1:50834     10.2.0.2:9000 users:("nc",pid=3183,fd=3)

State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process
LISTEN 0      1            0.0.0.0:9000      0.0.0.0:*
ESTAB  0      0           10.2.0.2:9000     10.2.0.1:50834

State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
ESTAB 0      0           10.2.0.2:9000     10.2.0.1:50834 users:("nc",pid=3179,fd=4)
```

Three things to see. The client's ephemeral port (50834 here) is not the server's 9000. The server now has *two* sockets on port 9000: the `LISTEN` one and a new `ESTAB` one. And that new one belongs to the same process as the listener (`pid=3179`) but is descriptor 4: `accept` made it. This is exactly the `accept4` returning descriptor 4 from the wallet's `strace` in Ch 1.2. Look at the client's descriptors, as in Ch 1.2:

```bash
ls -l /proc/$(ip netns pids cli)/fd
```

```text
lr-x------ 1 root root 64 Nov 16 08:09 0 -> pipe:[1592947]
l-wx------ 1 root root 64 Nov 16 08:09 1 -> pipe:[1595610]
l-wx------ 1 root root 64 Nov 16 08:09 2 -> pipe:[1589798]
lrwx------ 1 root root 64 Nov 16 08:09 3 -> socket:[1592950]
```

Descriptors 0 to 2 are the pipe and the terminal streams; descriptor 3 is the TCP socket. A socket is a file descriptor. Now ask the kernel what it knows about this connection:

```bash
ip netns exec cli ss -ti dst 10.2.0.2
```

```text
State Recv-Q Send-Q Local Address:Port  Peer Address:Port
ESTAB 0      0           10.2.0.1:50834     10.2.0.2:9000
	 cubic wscale:10,10 rto:200 rtt:0.041/0.02 mss:1448 pmtu:1500 rcvmss:536 advmss:1448 cwnd:10 bytes_acked:1 segs_out:2 segs_in:1 send 2.83Gbps ...
```

These are the numbers the theory named: congestion control `cubic`, window scale 10, a retransmission timeout of 200 ms (`rto:200`), a round trip of 0.041 ms, 1448 payload bytes per segment, and an initial congestion window of 10 segments. Finally close the client only, and see who ends in TIME\_WAIT:

```bash
kill $(ip netns pids cli); sleep 0.5
ip netns exec cli ss -tan
ip netns exec srv ss -tan
pkill -x nc
```

```text
State     Recv-Q Send-Q Local Address:Port  Peer Address:PortProcess
TIME-WAIT 0      0           10.2.0.1:50834     10.2.0.2:9000
State Recv-Q Send-Q Local Address:Port Peer Address:PortProcess
```

The client closed first, so the client holds the TIME-WAIT entry. The server's `nc` saw the end of the stream and exited, so its socket is gone (and its listener with it).

1. Two different clients connect to the same server port 9000. Which values of the 5-tuple make the two connections different, so the kernel never confuses them?
2. What would `Recv-Q` on the `LISTEN` line show if a second client connected while `nc` was busy and never called `accept`? Check the theory section on the listen queue.
3. The client port was picked by the kernel. Read `ip_local_port_range` with `ip netns exec cli sysctl net.ipv4.ip_local_port_range` and check that 50834 lies inside it.

## Part B · Capture a handshake and a teardown (40 min)

You will record every packet of one HTTP request and read it against the sequence diagram in the theory.

Make a 12 000-byte file, serve it from `srv`, and start a capture on the server's side of the cable. `-Z root` is needed so `tcpdump` may write the file; the `sleep` after each background command gives it time to start.

```bash
mkdir -p /tmp/www; head -c 12000 /dev/zero | tr '\0' 'x' > /tmp/www/page.txt
ip netns exec srv python3 -m http.server 8000 --directory /tmp/www >/dev/null 2>&1 &
sleep 1
ip netns exec srv tcpdump -Z root -n -i veth-s -w /tmp/hs.pcap "tcp port 8000" 2>/dev/null &
sleep 1
ip netns exec cli curl -s -o /dev/null http://10.2.0.2:8000/page.txt
sleep 1; pkill -x tcpdump; sleep 0.5
tcpdump -n -ttt -r /tmp/hs.pcap
```

The first column is the time since the previous packet (`-ttt`). Flags: `S` SYN, `.` ACK, `P` PSH ("deliver this to the application now"), `F` FIN; so `[S.]` is SYN-ACK. After the first two lines the timestamp options are trimmed here to save width.

```text
00:00:00.000000 IP 10.2.0.1.50254 > 10.2.0.2.8000: Flags [S], seq 3713947734, win 64240, options [mss 1460,sackOK,TS val 3492331432 ecr 0,nop,wscale 10], length 0
00:00:00.000023 IP 10.2.0.2.8000 > 10.2.0.1.50254: Flags [S.], seq 3437316581, ack 3713947735, win 65160, options [mss 1460,sackOK,TS val 869408336 ecr 3492331432,nop,wscale 10], length 0
00:00:00.000020 IP 10.2.0.1.50254 > 10.2.0.2.8000: Flags [.], ack 1, win 63, length 0
00:00:00.000114 IP 10.2.0.1.50254 > 10.2.0.2.8000: Flags [P.], seq 1:85, ack 1, win 63, length 84
00:00:00.000005 IP 10.2.0.2.8000 > 10.2.0.1.50254: Flags [.], ack 85, win 64, length 0
00:00:00.008984 IP 10.2.0.2.8000 > 10.2.0.1.50254: Flags [P.], seq 1:190, ack 85, win 64, length 189
00:00:00.000058 IP 10.2.0.1.50254 > 10.2.0.2.8000: Flags [.], ack 190, win 63, length 0
00:00:00.000075 IP 10.2.0.2.8000 > 10.2.0.1.50254: Flags [P.], seq 190:7430, ack 85, win 64, length 7240
00:00:00.000009 IP 10.2.0.1.50254 > 10.2.0.2.8000: Flags [.], ack 7430, win 77, length 0
00:00:00.000004 IP 10.2.0.2.8000 > 10.2.0.1.50254: Flags [P.], seq 7430:12190, ack 85, win 64, length 4760
00:00:00.000005 IP 10.2.0.1.50254 > 10.2.0.2.8000: Flags [.], ack 12190, win 87, length 0
00:00:00.000076 IP 10.2.0.2.8000 > 10.2.0.1.50254: Flags [F.], seq 12190, ack 85, win 64, length 0
00:00:00.000004 IP 10.2.0.1.50254 > 10.2.0.2.8000: Flags [F.], seq 85, ack 12190, win 87, length 0
00:00:00.000008 IP 10.2.0.2.8000 > 10.2.0.1.50254: Flags [.], ack 86, win 64, length 0
00:00:00.000007 IP 10.2.0.1.50254 > 10.2.0.2.8000: Flags [.], ack 12191, win 87, length 0
```

This is the trace behind the sequence diagram in the theory: your packet count and timings will be close, your ports and sequence numbers will not. Now look at the sockets the two ends are left with, and at the timer on one of them:

```bash
ip netns exec srv ss -tan state time-wait
ip netns exec cli ss -tano state time-wait
```

```text
Recv-Q Send-Q Local Address:Port Peer Address:Port Process
0      0           10.2.0.2:8000     10.2.0.1:32800 timer:(timewait,51sec,0)
```

This output is from a second run of the same commands, so the port differs from the trace. Only the server holds a TIME-WAIT entry; the client has none. In the first run the FINs crossed and both sides held one. Which you get depends on whether the client's FIN is sent before the server's arrives, a race of a few microseconds. The 51 seconds are what is left of TIME\_WAIT's 60; run the command again and it counts down. A fresh `ss` right after a close showed `timewait,59sec`.

1. In the first packet, find `mss`, `sackOK` and `wscale 10`. In packet 4, `win 63` is the client's window: multiply it by 1024. How many bytes of room does the client offer?
2. The client sent 84 bytes. Which later packet acknowledges them, and what is its `ack` number? Why 85 and not 84?
3. The server sent bytes 1 to 12189 (the last `seq` is 12190, the FIN). How do 189 and 12 000 add up to that?
4. Which side sent a FIN first, and how many microseconds later did the other side send its own? In your run, which side(s) hold TIME-WAIT, and why only those?

## Part C · UDP, and what a closed port answers (25 min)

You will send one UDP datagram, see that there is no handshake, then send one to a port nobody listens on and capture the kernel's reply.

```bash
ip netns exec srv nc -u -l 5000 &
sleep 0.5
ip netns exec srv tcpdump -Z root -n -i veth-s -w /tmp/udp.pcap "udp" 2>/dev/null &
sleep 1
echo "hello wallet" | ip netns exec cli nc -u -w1 10.2.0.2 5000
sleep 1
ip netns exec srv ss -uanp
pkill -x tcpdump; sleep 0.5
tcpdump -n -r /tmp/udp.pcap
```

```text
hello wallet
State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
ESTAB 0      0           10.2.0.2:5000     10.2.0.1:59705 users:("nc",pid=2631,fd=3)
07:41:12.782756 IP 10.2.0.1.59705 > 10.2.0.2.5000: UDP, length 13
```

The server's terminal prints `hello wallet`. The capture holds exactly one packet, `UDP, length 13` (12 letters, a space, and the newline): no SYN, no ACK, nothing to close. `ss` calls the socket `ESTAB` because `nc` *connected* the UDP socket to its peer, which only fixes the default address; no handshake happened. Now send to a port where nothing listens:

```bash
ip netns exec cli tcpdump -Z root -n -i veth-c -c 2 -w /tmp/udp2.pcap "icmp or udp" 2>/dev/null &
sleep 1
echo "ping" | ip netns exec cli nc -u -w1 10.2.0.2 5999; echo "nc exit=$?"
sleep 1; pkill -x tcpdump; sleep 0.5
tcpdump -n -r /tmp/udp2.pcap
pkill -x nc
```

```text
nc exit=0
07:41:16.311633 IP 10.2.0.1.53343 > 10.2.0.2.5999: UDP, length 5
07:41:16.311658 IP 10.2.0.2 > 10.2.0.1: ICMP 10.2.0.2 udp port 5999 unreachable, length 41
```

The kernel of `srv` answered in 25 microseconds with an ICMP *port unreachable*. UDP has no RST; ICMP plays that role. `nc` still exited with 0, because it had already sent its one datagram and was not waiting for an answer.

1. A TCP connect to a closed port gets a RST back (you will capture it in Part E). Name one difference between that answer and this ICMP message.
2. DNS uses UDP. If the reply datagram is lost, who notices, and what must the client do?
3. `ss` shows `ESTAB` for the UDP socket. What does that word promise about a UDP socket, compared with a TCP one?

## Part D · What delay and loss do to a stream (60 min)

You will slow the virtual cable on purpose, measure a single TCP stream, and watch retransmissions appear in the kernel's counters.

**D1 · Add delay (10 min).** `netem` is a queueing discipline (`qdisc`) that delays, drops or reorders packets leaving an interface. Put 10 ms on each end, so every round trip gains 20 ms.

```bash
ip netns exec cli tc qdisc add dev veth-c root netem delay 10ms
ip netns exec srv tc qdisc add dev veth-s root netem delay 10ms
ip netns exec cli tc qdisc show dev veth-c
ip netns exec cli ping -c 4 10.2.0.2
```

```text
qdisc netem 802a: root refcnt 13 limit 1000 delay 10ms
64 bytes from 10.2.0.2: icmp_seq=1 ttl=64 time=20.2 ms
64 bytes from 10.2.0.2: icmp_seq=2 ttl=64 time=20.3 ms
64 bytes from 10.2.0.2: icmp_seq=3 ttl=64 time=20.3 ms
64 bytes from 10.2.0.2: icmp_seq=4 ttl=64 time=20.2 ms
rtt min/avg/max/mdev = 20.198/20.258/20.307/0.042 ms
```

**D2 · Measure one stream and look inside it (15 min).** `iperf3` sends as much TCP data as it can for a few seconds and reports the rate. While it runs, ask the sender's socket what it is doing:

```bash
ip netns exec srv iperf3 -s -D
ip netns exec cli iperf3 -c 10.2.0.2 -t 6 > /tmp/iperf.txt &
sleep 4
ip netns exec cli ss -ti state established '( dport = :5201 )'
wait
tail -4 /tmp/iperf.txt
```

`ss` prints two sockets: iperf's tiny control connection, and the data connection. The data connection, trimmed:

```text
Recv-Q Send-Q  Local Address:Port  Peer Address:Port
0      4127696      10.2.0.1:47026     10.2.0.2:5201
	 cubic wscale:10,10 rto:224 rtt:20.212/0.08 mss:1448 cwnd:5792 bytes_acked:688586270 send 3.32Gbps pacing_rate 6.64Gbps delivery_rate 1.62Gbps app_limited busy:3920ms rwnd_limited:424ms(10.8%) unacked:2851 ...

[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-6.03   sec  1.04 GBytes  1.48 Gbits/sec    0             sender
[  5]   0.00-6.05   sec  1.04 GBytes  1.47 Gbits/sec                  receiver
```

Read it with the theory in hand. `rtt:20.2` is the 20 ms you added. `unacked:2851` segments of 1448 bytes are in flight: 4.1 MB. That is the bandwidth-delay product at work: `delivery_rate` 1.62 Gbit/s times 20.2 ms is 4.1 MB. `Send-Q` 4 127 696 is data the program has written that is still waiting for acknowledgements. `rwnd_limited` says the receiver's window held the sender back for 10.8% of the time.

**D3 · Sweep the delay (15 min).** Save this as `~/cn-lab/vol2/sweep.sh`. It tries six delays, measures the real round trip with `ping`, then runs a 5-second `iperf3` test. The first value, 0 ms, is the bare cable.

```bash
#!/bin/bash
# throughput of one TCP stream at several delays (each way); rtt is about 2 x delay
ip netns exec srv iperf3 -s -D >/dev/null
sleep 1
echo "delay_each_way_ms,rtt_ms,mbit_s"
for d in 0 5 10 25 50 100; do
  for ns_if in "cli veth-c" "srv veth-s"; do set -- $ns_if
    ip netns exec $1 tc qdisc del dev $2 root 2>/dev/null
    [ $d -gt 0 ] && ip netns exec $1 tc qdisc add dev $2 root netem delay ${d}ms
  done
  rtt=$(ip netns exec cli ping -c 5 -i 0.2 -q 10.2.0.2 | awk -F'/' '/^rtt/{print $5}')
  bps=$(ip netns exec cli iperf3 -c 10.2.0.2 -t 5 -J | python3 -c 'import json,sys; print(round(json.load(sys.stdin)["end"]["sum_received"]["bits_per_second"]/1e6,1))')
  echo "$d,$rtt,$bps"
done
for ns_if in "cli veth-c" "srv veth-s"; do set -- $ns_if; ip netns exec $1 tc qdisc del dev $2 root 2>/dev/null; done
pkill -x iperf3
```

Run it with `pkill -x iperf3; bash ~/cn-lab/vol2/sweep.sh | tee sweep.csv` (about 45 seconds). One run on the test machine, later on a busier machine than the chart's run:

```text
delay_each_way_ms,rtt_ms,mbit_s
0,0.078,11400.7
5,10.240,2441.4
10,20.550,1391.8
25,50.237,353.6
50,100.167,262.0
100,200.700,109.9
```

{{diagram lab-2-3-02.jsx | measured on the test machine, 2026-11-16 · sweep.sh, one quiet run, 5-second iperf3 test per delay, no loss}}
Ten milliseconds each way cut the stream from 13.1 Gbit/s to 1.5 Gbit/s, and every doubling of the round trip roughly halves it again. The second row explains why. Rate times round trip is the amount of data in flight, and once delay is added it stays near 3 to 4 MB: the sender can only have so much unacknowledged data out, so a longer round trip means fewer windows per second. The first point is different: at 0.05 ms the limit is the CPU copying bytes, not the window.

**D4 · Add loss and count retransmissions (10 min).** Keep the 10 ms each way and drop 1% of the packets leaving each end. `nstat -n` resets the kernel's counters for the client namespace; plain `nstat` then prints how much they grew. `TcpOutSegs` counts every segment sent, `TcpRetransSegs` the ones sent again.

```bash
pkill -x iperf3; sleep 0.5
for ns_if in "cli veth-c" "srv veth-s"; do set -- $ns_if
  ip netns exec $1 tc qdisc del dev $2 root 2>/dev/null
  ip netns exec $1 tc qdisc add dev $2 root netem delay 10ms loss 1%
done
ip netns exec cli tc qdisc show dev veth-c
ip netns exec srv iperf3 -s -D; sleep 1
ip netns exec cli nstat -n
ip netns exec cli iperf3 -c 10.2.0.2 -t 5 | tail -4
ip netns exec cli nstat TcpOutSegs TcpRetransSegs
```

```text
qdisc netem 805d: root refcnt 13 limit 1000 delay 10ms loss 1%
[  5]   0.00-5.13   sec  4.75 MBytes  7.77 Mbits/sec   30             sender
[  5]   0.00-5.16   sec  4.50 MBytes  7.32 Mbits/sec                  receiver

iperf Done.
#kernel
TcpOutSegs                      3370               0.0
TcpRetransSegs                  30                 0.0
```

The `Retr` column of `iperf3` and the kernel agree: 30 of 3370 segments were sent twice, about 0.9%, close to the 1% you asked `netem` to drop. The rate fell from 1.48 Gbit/s in D2 to 7.77 Mbit/s, almost 200 times slower, for one lost packet in a hundred. Every loss tells the sender the path is congested, so CUBIC shrinks its congestion window and must grow it back.

**D5 · Sweep the loss (15 min).** Save this as `~/cn-lab/vol2/loss.sh`. It keeps 10 ms each way, tries five loss rates and runs three 5-second tests per rate, because a single test under random loss is noisy.

```bash
#!/bin/bash
# throughput of one TCP stream at 20 ms round trip and several loss rates; 3 runs each
ip netns exec srv iperf3 -s -D >/dev/null
sleep 1
echo "loss_pct,run1,run2,run3,median_mbit_s"
for loss in 0 0.1 0.5 1 2; do
  for ns_if in "cli veth-c" "srv veth-s"; do set -- $ns_if
    ip netns exec $1 tc qdisc del dev $2 root 2>/dev/null
    ip netns exec $1 tc qdisc add dev $2 root netem delay 10ms loss ${loss}%
  done
  r=""
  for k in 1 2 3; do
    v=$(ip netns exec cli iperf3 -c 10.2.0.2 -t 5 -J | python3 -c 'import json,sys; print(round(json.load(sys.stdin)["end"]["sum_received"]["bits_per_second"]/1e6,1))')
    r="$r $v"
  done
  set -- $r
  med=$(printf '%s\n' $1 $2 $3 | sort -n | sed -n 2p)
  echo "$loss,$1,$2,$3,$med"
done
for ns_if in "cli veth-c" "srv veth-s"; do set -- $ns_if; ip netns exec $1 tc qdisc del dev $2 root 2>/dev/null; done
pkill -x iperf3
```

Run it with `pkill -x iperf3; bash ~/cn-lab/vol2/loss.sh | tee loss.csv` (about 80 seconds). The quiet run on the test machine:

```text
loss_pct,run1,run2,run3,median_mbit_s
0,1516.7,1504.7,1529.6,1516.7
0.1,879.7,929.5,524.1,879.7
0.5,124.4,12.3,85.6,85.6
1,10.7,119.4,7.9,10.7
2,5.6,6.3,4.8,5.6
```

{{diagram lab-2-3-03.jsx | measured on the test machine, 2026-11-16 · loss.sh, one quiet run, 10 ms delay each way, 3 runs per loss rate}}
Loss hurts far more than delay. One packet in a thousand already costs 40% of the rate; one in a hundred leaves less than 1%. The long whiskers at 0.5% and 1% are real: which packets `netem` drops is random, and one unlucky early loss keeps the window small for the whole test. That is why the script takes three runs and plots the middle one.

1. Use the D2 numbers: `delivery_rate` 1.62 Gbit/s at a round trip of 20.2 ms. Compute the bandwidth-delay product in bytes, and compare it with `unacked` times `mss`.
2. In the delay chart, rate times round trip stays near 3 to 4 MB. Which socket setting would you expect to limit it? Look at `rwnd_limited` in D2 and at the flow-control part of the theory.
3. Your wallet's database sits 50 ms away and the network loses 0.1% of packets. From the two charts, which of the two hurts a bulk transfer more, and roughly by how much?
4. In D4, 30 retransmissions cost the stream almost all of its speed. Explain, with the congestion window, why a few lost segments are so expensive.

## Part E · Refused, timed out, and the firewall's memory (30 min)

You will make the same failed connection three ways, time each one, and read the connection-tracking entry a stateful firewall keeps. Remove the delay first so timings are clean:

```bash
pkill -x iperf3
for ns_if in "cli veth-c" "srv veth-s"; do set -- $ns_if; ip netns exec $1 tc qdisc del dev $2 root 2>/dev/null; done
```

**E1 · Nothing listens: refused.** Port 9200 has no listener. `time` prints how long the command took; `-m 5` makes `curl` give up after 5 seconds.

```bash
ip netns exec srv tcpdump -Z root -n -i veth-s -c 2 -w /tmp/rst.pcap "tcp port 9200" 2>/dev/null &
sleep 1
time ip netns exec cli curl -sS -m 5 http://10.2.0.2:9200/ ; echo "exit=$?"
sleep 1; tcpdump -n -r /tmp/rst.pcap
```

```text
curl: (7) Failed to connect to 10.2.0.2 port 9200 after 0 ms: Couldn't connect to server
real	0m0.440s
exit=7
09:25:31.596232 IP 10.2.0.1.46860 > 10.2.0.2.9200: Flags [S], seq 2190244387, win 64240, options [mss 1460,sackOK,TS val 1562994316 ecr 0,nop,wscale 10], length 0
09:25:31.596259 IP 10.2.0.2.9200 > 10.2.0.1.46860: Flags [R.], seq 0, ack 2190244388, win 0, length 0
```

One SYN, and 27 microseconds later the kernel of `srv` answers with `[R.]`, a reset. `curl` fails at once ("after 0 ms"; the 0.44 s of `real` is mostly starting the programs). Refused is a fast, clear answer: the host is there, the port is closed.

**E2 · A firewall drops the SYN: timed out.** Add an `nft` rule on the server that silently drops packets to port 9200, and capture again:

```bash
ip netns exec srv nft add table inet fw
ip netns exec srv nft "add chain inet fw in { type filter hook input priority 0 ; }"
ip netns exec srv nft add rule inet fw in tcp dport 9200 drop
ip netns exec srv tcpdump -Z root -n -i veth-s -w /tmp/drop.pcap "tcp port 9200" 2>/dev/null &
sleep 1
time ip netns exec cli curl -sS -m 5 http://10.2.0.2:9200/ ; echo "exit=$?"
pkill -x tcpdump; sleep 0.5
tcpdump -n -ttt -r /tmp/drop.pcap
```

```text
curl: (28) Connection timed out after 5029 milliseconds
real	0m5.154s
exit=28
 00:00:00.000000 IP 10.2.0.1.46868 > 10.2.0.2.9200: Flags [S], seq 2215103069, win 64240, ...
 00:00:01.022713 IP 10.2.0.1.46868 > 10.2.0.2.9200: Flags [S], seq 2215103069, win 64240, ...
 00:00:01.020180 IP 10.2.0.1.46868 > 10.2.0.2.9200: Flags [S], seq 2215103069, win 64240, ...
 00:00:01.027449 IP 10.2.0.1.46868 > 10.2.0.2.9200: Flags [S], seq 2215103069, win 64240, ...
 00:00:01.033319 IP 10.2.0.1.46868 > 10.2.0.2.9200: Flags [S], seq 2215103069, win 64240, ...
```

Five SYNs with the same sequence number, one second apart, and no answer: the client kernel retransmits its SYN and `curl` gives up at its 5-second limit. Without `-m`, the kernel decides. The [ip-sysctl documentation](https://docs.kernel.org/networking/ip-sysctl.html) gives `tcp_syn_retries` = 6 and `tcp_syn_linear_timeouts` = 4: the first four retries come one second apart, then the wait doubles, and the attempt fails after 131 seconds. A program that does not set its own connect timeout can hang that long.

**E3 · A firewall rejects: refused again.** Replace `drop` with `reject with tcp reset`, and the firewall itself sends the reset:

```bash
ip netns exec srv nft flush chain inet fw in
ip netns exec srv nft add rule inet fw in tcp dport 9200 reject with tcp reset
time ip netns exec cli curl -sS -m 5 http://10.2.0.2:9200/ ; echo "exit=$?"
ip netns exec srv nft delete table inet fw
```

```text
curl: (7) Failed to connect to 10.2.0.2 port 9200 after 0 ms: Couldn't connect to server
exit=7
real	0m0.561s
```

The client cannot tell this from E1. A firewall that drops makes callers wait; one that rejects lets them fail fast and try elsewhere.

**E4 · What a stateful firewall remembers.** A rule that matches `ct state established,related` asks the kernel's connection tracker about every packet. Loading such a rule turns tracking on in the `srv` namespace. Open one long connection and list the table:

```bash
ip netns exec srv nft add table inet fw
ip netns exec srv nft "add chain inet fw in { type filter hook input priority 0 ; policy accept ; }"
ip netns exec srv nft add rule inet fw in ct state established,related accept
ip netns exec srv nc -lk 9300 >/dev/null &
sleep 0.5
(sleep 60) | ip netns exec cli nc 10.2.0.2 9300 &
sleep 1
ip netns exec srv conntrack -L | grep 9300
ip netns exec srv conntrack -C
cat /proc/sys/net/netfilter/nf_conntrack_max
```

```text
tcp      6 431999 ESTABLISHED src=10.2.0.1 dst=10.2.0.2 sport=55496 dport=9300 src=10.2.0.2 dst=10.2.0.1 sport=9300 dport=55496 [ASSURED] mark=0 use=1
1
262144
```

This is the entry the theory reads field by field: the original direction, the reply direction, `[ASSURED]` because traffic flowed both ways, and 431 999 seconds (5 days) left before an idle established entry is forgotten. `conntrack -C` counts the entries, 1 here; the limit on this machine is 262 144.

1. A caller sees `Connection refused` from one service and `Connection timed out` from another. What do you know about each server from that alone?
2. In E2, why does every retransmitted SYN carry the same sequence number?
3. Your wallet API calls a database through a firewall that drops instead of rejecting. The API has no connect timeout. What do users see while the database is unreachable, and for how long?
4. If the conntrack table filled up, what would happen to E4's existing connection, and what to a new one? Use the theory section on the conntrack table.

## Checkpoint

You are done with Parts A to E when all of these hold. The capture files are still in `/tmp`, and `sweep.csv` and `loss.csv` are in `~/cn-lab/vol2`. Paste the commands and your results into `~/cn-lab/vol2/lab-2.3.md`.

| Check | Expected |
| --- | --- |
| `tcpdump -n -r /tmp/hs.pcap 2>/dev/null \| grep -c "Flags \[S"` | `2` (the SYN and the SYN-ACK of Part B) |
| `tcpdump -n -r /tmp/hs.pcap 2>/dev/null \| grep -c "Flags \[F"` | `2` (one FIN from each side) |
| `tcpdump -n -r /tmp/udp2.pcap 2>/dev/null \| grep -c "port 5999 unreachable"` | `1` (the ICMP answer of Part C) |
| `wc -l < ~/cn-lab/vol2/sweep.csv` | `7` (a header and six delays); the rate falls at every step after 0 ms |
| `wc -l < ~/cn-lab/vol2/loss.csv` | `6` (a header and five loss rates); the 1% median is well under a tenth of the 0% one |
| `tcpdump -n -r /tmp/rst.pcap 2>/dev/null \| grep -c "Flags \[R.\]"` | `1` (the reset of E1) |
| `tcpdump -n -r /tmp/drop.pcap 2>/dev/null \| grep -c "Flags \[S\]"` | `5` (one SYN and four retries in 5 seconds) |
| `ip netns exec srv nft list chain inet fw in \| grep -c "dport 9200"` | `0`: only the E4 rule `ct state established,related accept` is left |
| Notebook | Answers to the questions of Parts A to E, your `sweep.csv` and `loss.csv`, and one sentence on how your shape compares with the two charts |

## Break it: a client runs out of ports

A client that opens a new connection for every request, and closes it first, leaves a TIME-WAIT socket behind each time. Each one holds a local port for 60 seconds. A busy client can run out of ports even though the server is fine. Here the range is narrowed to 100 ports so it happens in seconds.

**1. Make a small load generator.** Save it as `~/cn-lab/vol2/burst.py`. It connects to `srv` on port 9100 N times, closing each socket at once, and stops at the first error.

```python
import socket, sys
n = int(sys.argv[1]); ok = 0
for i in range(n):
    s = socket.socket()
    try:
        s.connect(("10.2.0.2", 9100))
    except OSError as e:
        print(f"connection {i + 1} failed: {e}")
        break
    ok += 1
    s.close()
print("connected", ok, "times")
```

**2. Run it with the default range.**

```bash
ip netns exec srv nc -lk 9100 >/dev/null &
sleep 0.5
ip netns exec cli sysctl net.ipv4.ip_local_port_range net.ipv4.tcp_tw_reuse
ip netns exec cli python3 ~/cn-lab/vol2/burst.py 300
ip netns exec cli ss -tan state time-wait | tail -n +2 | wc -l
```

```text
net.ipv4.ip_local_port_range = 32768	60999
net.ipv4.tcp_tw_reuse = 2
connected 300 times
299
```

All 300 connections work, and about 300 TIME-WAIT sockets are left (the last one may still be closing). The range has 28 232 ports, so nothing is near the edge.

**3. Cause it.** Wait 60 seconds so those entries expire, then shrink the range to 100 ports and run again:

```bash
sleep 60
ip netns exec cli sysctl -w net.ipv4.ip_local_port_range="40000 40099"
ip netns exec cli python3 ~/cn-lab/vol2/burst.py 300
```

```text
net.ipv4.ip_local_port_range = 40000 40099
connection 101 failed: [Errno 99] Cannot assign requested address
connected 100 times
```

**4. Diagnose it.** Error 99 is `EADDRNOTAVAIL`: the kernel found no free local port for the 5-tuple. The server never saw connection 101. Count what holds the ports, and look at their timers:

```bash
ip netns exec cli ss -tan state time-wait | tail -n +2 | wc -l
ip netns exec cli ss -tano state time-wait | head -3
```

```text
100
Recv-Q Send-Q Local Address:Port  Peer Address:PortProcess
0      0           10.2.0.1:40000     10.2.0.2:9100 timer:(timewait,49sec,0)
0      0           10.2.0.1:40001     10.2.0.2:9100 timer:(timewait,52sec,0)
```

Exactly 100 TIME-WAIT sockets, one on every port of the range, each with under a minute left. Same server address, same server port, same client address: the client port is the only part of the 5-tuple left to vary, and every value is taken.

**5. Fix it, three ways.** The best fix is in the client: reuse connections (HTTP keep-alive, a connection pool) instead of opening one per request. The second is a wide port range, which is the default. The third is a kernel switch. The [ip-sysctl documentation](https://docs.kernel.org/networking/ip-sysctl.html) lists `tcp_tw_reuse` values 0 (off), 1 (global) and 2 (loopback only, the default), and warns it "should not be changed without advice/request of technical experts". Try it here, where nothing is at stake:

```bash
ip netns exec cli sysctl -w net.ipv4.tcp_tw_reuse=1
ip netns exec cli python3 ~/cn-lab/vol2/burst.py 300
ip netns exec cli ss -tan state time-wait | tail -n +2 | wc -l
```

```text
net.ipv4.tcp_tw_reuse = 1
connected 300 times
100
```

All 300 connect through only 100 ports: the kernel reused TIME-WAIT ports whose timestamps prove the new connection cannot be confused with the old one. Put both settings back:

```bash
ip netns exec cli sysctl -w net.ipv4.ip_local_port_range="32768 60999" net.ipv4.tcp_tw_reuse=2
```

1. The error appeared in the client, not the server, and the server's logs were clean. Which command would you run first on a real client that reports `Cannot assign requested address`?
2. Why did TIME-WAIT pile up on the client and not on the server in this test? Use the state diagram in the theory.
3. A colleague proposes `tcp_tw_reuse=1` on every server in production. Give one reason to fix the client instead.

## Clean up

Deleting a namespace removes its interfaces, its `netem` and `nft` settings and its sysctl values; the background programs and files go separately.

```bash
pkill -x iperf3; pkill -x nc; pkill -x tcpdump; pkill -f "http[.]server"
ip netns del cli; ip netns del srv
rm -rf /tmp/www /tmp/*.pcap /tmp/iperf.txt
ip netns list
```

The last command prints nothing. If you used the container, `exit` removes everything else.
