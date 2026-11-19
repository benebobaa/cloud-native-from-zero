# Review 2.1

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** Every host already has an IP address. Why does Ethernet need MAC addresses as well? What does each of the two addresses identify, and how far does each travel?
2. **Concept.** A switch receives a frame whose destination MAC is not in its table. What does it do with the frame, and what does it do with the frame's source MAC? Why does nobody need to configure addresses into a switch?
3. **Concept.** In four sentences, explain what an ARP request asks, who answers, and where the answer is kept. Why is the request broadcast but the reply not?
4. **Trace.** A host `10.0.1.1` pings `10.0.1.2` for the first time and the capture shows, in this order: (a) `aa:00:01 > ff:ff:ff:ff:ff:ff ARP Request who-has 10.0.1.2 tell 10.0.1.1`, (b) `bb:00:02 > aa:00:01 ARP Reply 10.0.1.2 is-at bb:00:02`, (c) `aa:00:01 > bb:00:02 ICMP echo request`, (d) `bb:00:02 > aa:00:01 ICMP echo reply`. A third host `cc:00:03` is on the same switch. Which of the four frames does it capture, and what entry, if any, does it add to its neighbour cache?
5. **Trace.** A switch has an empty MAC table; host A is on port 1, B on port 2, C on port 3. These frames arrive in order: (1) A to B, unicast; (2) B to A, unicast; (3) C to the broadcast address; (4) A to C, unicast. For each frame say out of which ports the switch sends it, and write the MAC table after each frame.
6. **Debug.** A service at `10.0.1.2` answers some clients but not others, and `arping -c 3 -I eth0 10.0.1.2` prints replies from two different MAC addresses. Explain what is wrong, how you find the second machine from the switch, and what stops it happening again.
7. **Debug.** `ping` between two hosts works, a small `curl` works, but a 2 MB download hangs after a few packets. Which layer do you suspect, which `ping` command confirms it, and what do you compare on the path?
8. **Design.** A site runs 2000 hosts in one flat subnet. Last month a cabling mistake caused a broadcast storm, and kernel logs now complain about the neighbour table. Propose a redesign using this chapter's ideas and name one cost of it.

**Read the diagram.** Open the diagram "a switch and its MAC table" in the theory tab. In panel 2, s2's reply goes only to port 1. (a) Which of the switch's three rules sends it there, and which earlier step made that rule possible? (b) Suppose s1's table entry had expired just before step 2. What would s3 see, and which output in Lab 2.1 Part B3 shows the same thing? (c) What would the table look like if s3 had sent one frame between step 1 and step 2?

## Hints

| Q | Hint |
| --- | --- |
| 1 | Think about how many links a packet crosses. Which address is rewritten at every hop, and which is not? Ch 2.2 returns to this. |
| 2 | Re-read the three rules in part 3 of the theory. Which ones use the source MAC, and which the destination? |
| 3 | See the ARP sequence diagram and the RFC 826 receive rule: who adds an entry? |
| 4 | A switch floods broadcasts. Then look at the rule that says only the target of a request adds a new entry. |
| 5 | Draw a table with columns frame, rule used, ports out, table after. Learn first, then flood or forward. |
| 6 | Two owners of one IP. See Break it in Lab 2.1: which command lists replies, and which lists the MAC table? |
| 7 | The ping that sends a full-size packet with the do-not-fragment flag. Compare the MTU of every link and of every VLAN or tunnel in between. |
| 8 | Smaller broadcast domains mean fewer hosts per ARP table. Think of VLANs plus routing (Ch 2.2), and of spanning tree. |
