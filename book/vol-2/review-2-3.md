# Review 2.3

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** A server listens on port 443 and 10 000 clients are connected to it. How many sockets does the server process hold, which of them are listening sockets, and what makes the 10 000 connections different from each other for the kernel? Then say what limits how many connections one client machine can open to that one server address and port, and give the number for a default Linux.
2. **Concept.** A client reports "connection refused" for one service, "connection timed out" for a second, and "connection reset by peer" in the middle of a download from a third. For each message say which packet (or which silence) the client saw, what is probably wrong, and the first command you run on the server.
3. **Trace.** A client with starting sequence number 1000 connects to a server with starting number 7000, sends a request of 84 bytes, and receives a 12 000-byte response as two segments of 7240 and 4760 bytes. Then the client closes. Write the sequence and acknowledgement numbers of: the SYN-ACK, the server's acknowledgement of the request, the two response segments, the client's acknowledgement of the whole response, the client's FIN and the server's acknowledgement of it. Compare with the trace in the theory.
4. **Trace.** A transfer between two data centres has a 1 Gbit/s link and a 40 ms round trip. Compute the bandwidth-delay product. The receiver advertises a window of 65 535 bytes and window scaling is off. What is the highest throughput you can get, and what would the same host reach with `wscale 10` and a large enough buffer? Which row of the Lab 2.3 sweep chart shows the same effect?
5. **Debug.** A batch job opens a new connection to one API for every request, closes it, and at about 600 requests per second starts logging `connect: Cannot assign requested address`. `ss -s` shows tens of thousands of sockets in TIME-WAIT. Explain the arithmetic behind the failure, say which side holds the TIME-WAIT sockets and why that matters, and rank three fixes by how much they really help.
6. **Debug.** A service has been up for three weeks and now fails to accept connections with "too many open files". `ss -tan state close-wait | wc -l` prints 3 100. Say which side closed first, whose bug this is, which command names the process and which names the sockets of one process, and what the code most likely forgot.
7. **Debug.** At every traffic peak, new connections to a gateway time out at random while established connections keep working. `dmesg` prints `nf_conntrack: table full, dropping packet`. Explain the mechanism, give the two commands that show how close you are to the limit, list three mitigations with one cost each, and say why you could not reproduce this limit in a network namespace in Lab 2.3.
8. **Design.** Pick TCP or UDP for each, and name the one design decision or tuning knob that matters most: (a) the wallet's balance API, (b) a lookup service answering 100-byte questions at 50 000 per second, (c) a live price ticker where a price older than one second is useless, (d) a 10 GB audit export between two regions 150 ms apart. For (c), say what happens to it behind a firewall that allows only TCP 443.

**Read the diagram.** Open the theory diagram "TCP connection states · normal open and close". The client calls `close` first. List the states each side passes through, in order. Which side ends in TIME\_WAIT, and for how long on Linux? At which box does a server whose application forgot `close` stay forever, and what does `ss` print for it? In the Part B trace both FINs crossed on the wire: which side then holds a TIME\_WAIT socket?

## Hints

| Q | Hint |
| --- | --- |
| 1 | Part 1: listening socket versus accepted socket, the 5-tuple, and `ip_local_port_range`. A 5-tuple has five values; which one is fixed for all the clients of one server address and port? |
| 2 | In production rows 4 and 5, and Lab 2.3 Part E. A reset is an answer, a timeout is silence. Which one means "the host is alive"? |
| 3 | Part 2: a SYN and a FIN each use one sequence number; an acknowledgement number is the next byte expected, not the last byte received. The two response segments add up to 12 000. |
| 4 | Part 4, the BDP formula and `throughput <= window / round-trip time`. Convert bytes to bits. Compare with the sweep chart of Lab 2.3 Part D. |
| 5 | Part 3 (TIME\_WAIT on the side that closes first), In production row 1, and Lab 2.3 Break it. Divide the number of ports by the wait. |
| 6 | Part 3: CLOSE\_WAIT. `ss -tanp state close-wait` and `ls -l /proc/PID/fd`, from the command table. |
| 7 | Part 6 and In production row 2. `conntrack -C` and `sysctl net.netfilter.nf_conntrack_max`; Lab 2.3 Part E shows what a namespace allows. |
| 8 | Part 5, the table of UDP uses, the QUIC paragraph, and the BDP part. Ask of each: who should repeat a lost message, and does a late answer still have value? |
| Diagram | Left column for the side that closes first, right column for the other. The box after the last ACK has a timer; the box a forgetful application never leaves is named after what the OTHER side did. |
