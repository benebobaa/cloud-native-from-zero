# Review 2.2

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** A host has the address `10.1.2.77/26`. Write the first and last address of its subnet, say how many addresses the subnet has, and say what the host does with a packet for `10.1.2.130` and with one for `10.1.2.100`.
2. **Concept.** A routing table holds `10.0.0.0/8 via A`, `10.1.0.0/16 via B`, `10.1.2.0/24 via C` and `default via D`. Which next hop gets a packet for `10.1.2.9`, for `10.1.9.9`, for `10.9.9.9` and for `8.8.8.8`? State the rule you used and say why the default route never wins against the others.
3. **Trace.** A packet leaves host `a` with TTL 64 and crosses three routers to reach its destination. What TTL does the destination see? On each of the four links, say which of these fields changes: source IP, destination IP, source MAC, destination MAC, TTL. What would `traceroute` print for each router?
4. **Trace.** Two hosts behind one masquerading router, `10.1.1.10` and `10.1.1.11`, both open a TCP connection from source port 40000 to `203.0.113.10:443`. Write the source and destination of the first packet on the private side and on the public side for both hosts, and say what the router must do so that the two replies can be told apart.
5. **Debug.** A Linux VM is supposed to route between two subnets. A client on one side pings a server on the other and gets no reply and no error. Give the first two commands you run on the VM, what each would show if the cause were the most likely one, and the fix.
6. **Debug.** Users report that small web pages load but uploading a 1 MB file hangs. `ping` works. A firewall team recently tightened a router between the networks so that it passes only the ICMP messages that ping needs. Explain the mechanism in this chapter's words, name the lab command that proves it, and give two different fixes.
7. **Debug.** In a Kubernetes cluster, existing connections to the Internet work but new outbound connections time out during the evening peak. Pods reach the Internet through a NAT device. Name two different limits the device may have reached, the command that compares one of them with its ceiling, and three changes you could make.
8. **Design.** You must plan address ranges for five Kubernetes clusters and three VPCs that will one day be connected to each other and to the office network. Each cluster needs room for 2000 Pods and 500 Services. Give the prefix length for each cluster's Pod range and Service range, state three rules your plan follows, and explain why fixing a mistake after the clusters exist is expensive.

**Read the diagram.** In the theory diagram "The most specific matching route wins", add a fifth row, `10.1.2.128/26 via 10.1.1.55`. Which cells in the two destination columns (`10.1.2.10` and `10.1.2.200`) change? What would `ip route get 10.1.2.130` print, and what would change if you removed the `/25` row?

## Hints

| Q | Hint |
| --- | --- |
| 1 | A `/26` leaves 6 host bits, so subnets are 64 addresses wide. Which multiple of 64 sits just below 77? |
| 2 | Several rules match; compare the prefix lengths. The default route is `0.0.0.0/0`: how many bits does it match? |
| 3 | Part 3 and the hop diagram: what the router rewrites in the Ethernet header, and what it does to TTL. Each router that drops TTL to zero sends ICMP Time Exceeded. |
| 4 | NAT part and the conntrack line: the reply direction is stored. What identifies a flow besides the addresses? |
| 5 | Part A of the lab: one kernel setting, and a capture on both interfaces of the VM. |
| 6 | Path MTU part, the black-hole paragraph, and Break it. Which packets does `ping` send, and which does a 1 MB upload need? |
| 7 | In production, row 3, and the NAT part: one limit is a table, the other a count of ports per destination. |
| 8 | Remember kind's and kubeadm's defaults, the AWS peering limitation, and `2^(32-n)`. Plan before the first cluster is built. |
| Diagram | Which prefix does `.200` fall into: a `/26` starting at 128 covers which last-byte values? |
