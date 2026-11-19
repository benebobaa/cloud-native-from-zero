# Review 2.5

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** Name the four Linux objects that together make one Pod's network on a node, say which of them lives inside the Pod's network namespace, and explain why all containers of a Pod can reach each other on `127.0.0.1` while two Pods cannot.
2. **Concept.** A packet from a Pod to a host outside the cluster passes through the node. List the netfilter hooks it meets, in order. Say at which hook the masquerade rule acts and why a rule at `input` would never see this packet. Then explain why the rule must leave Pod-to-Pod traffic alone.
3. **Trace.** Pod p1 (`10.244.1.2`, node A `172.29.0.2`) sends a 1 000-byte IP packet to p3 (`10.244.2.2`, node B `172.29.0.3`) through the VXLAN tunnel of Lab 2.5. Write, for the packet on the pod's side and for the packet on the underlay: the source and destination IP addresses, whose MAC addresses appear, and the size of the outer IP packet. Which hop lowers the TTL, and by how much in total?
4. **Trace.** Lab 2.5 Part B printed this conntrack entry: `icmp 1 27 src=10.244.1.2 dst=172.29.0.3 type=8 code=0 id=2514 src=172.29.0.3 dst=172.29.0.2 type=0 code=0 id=2514`. Which address did node B see as the source? What does the right half say about the reply? What happens to the reply if the entry expired during a slow transfer, and why does the same fate not hit a Pod-to-Pod packet in the tunnel?
5. **Debug.** After a firewall change between two nodes, Pods on the same node talk to each other but Pods on different nodes do not; the nodes still ping each other. Give the capture you run on each node, what you expect to see for each of three causes (UDP 4789 blocked, a wrong `remote` in the tunnel, a missing route), and the one-line fix for each.
6. **Debug.** Between two Pods on different nodes, a 200-byte request works but a 2 MB upload stops after the handshake. Pings with a small payload work. Name the cause, the three commands that prove it (with the output each one prints if you are right) and two fixes, one at the Pod and one at the firewall. Say which you prefer and why.
7. **Debug.** A node has run Pods for a month. New Pods now fail with `no IP addresses available in range`, though only 30 Pods are running on a node whose Pod range is a /24. Using what Lab 2.5 Part D showed about `host-local`, explain the mechanism, how you confirm it with two commands, and how it relates to `DEL` and `GC`.
8. **Design.** You are asked to network three new nodes for the wallet: 40 Pods per node, the nodes on one Layer-2 switch with MTU 1500. Choose the Pod CIDR plan, overlay or routed (and the Pod MTU), the scope of the masquerade rule, and what must sit in the CNI configuration. Give one reason for each choice, and say what changes if the three nodes sit in different subnets behind a router.

**Read the diagram.** Open the theory diagram "the netfilter packet path · five hooks". Mark the path of three packets: (a) a Pod's packet to another node, (b) a packet from another node to a process on this node, (c) the answer that process creates. For each, name the hooks in order. At which hook does the masquerade rule of Lab 2.5 act, and why does it act on (a) only?

## Hints

| Q | Hint |
| --- | --- |
| 1 | Part 1 and Part 2 of the theory: namespace, veth pair (two ends), bridge, route. Which end of the veth pair is renamed to `eth0`? |
| 2 | Part 3: the hooks, and the priority table. Masquerade is source NAT; it must run once the output interface is known. In Lab 2.5 Part B, read the rule word by word. |
| 3 | Part 4 and the drawing of the VXLAN frame: 14 + 20 + 8 + 8 bytes of overhead. TTL: count routers, not wires. |
| 4 | Part 3, "Conntrack": two halves, the second is the reply as it will arrive. For the last part, compare with the conntrack line on node B in Lab 2.5 Part C. |
| 5 | Lab 2.5 Part C, the capture on `eth0` with `udp port 4789`, on both nodes; and `bridge fdb show dev vxlan0`, `ip route`. |
| 6 | Break it of Lab 2.5, and Ch 2.2 (path MTU discovery). Compare ping sizes with `-M do`; look at the counter of the drop rule. |
| 7 | Lab 2.5 Part D, steps D3 and D4, and In production row 6. Look at `/var/lib/cni/networks/NAME` and compare it with the running Pods. |
| 8 | Part 4 ("A limit of the lab" and the MTU paragraph), Part 7 (the Kubernetes network model), and the project cards. Think of three nodes: how many tunnel peers does each node need? |
| Diagram | The five hooks are prerouting, input, forward, output, postrouting. Each of the three packets takes a different route through them. Where is the output interface known for the first time? |
