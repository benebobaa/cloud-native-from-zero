# Review 2.4

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** At 10:00 you change the A record of `wallet.example.com` from `198.51.100.10` to `198.51.100.20`. The record's TTL was 3600. Which clients still reach the old address, until when at the latest, and what should you have done the day before? Why does lowering the TTL at 10:00 not help?
2. **Concept.** A Pod's `/etc/resolv.conf` has `search wallet.svc.cluster.local svc.cluster.local cluster.local` and `options ndots:5`. The Pod looks up `api.payments.example.com`. List the A queries in the order the stub sends them, say which one succeeds, and give two different ways to make the lookup cost one query.
3. **Trace.** The round trip between client and server is 50 ms. Count the round trips, and estimate the time, until the first byte of the reply arrives for: (a) plain HTTP on a new connection, (b) HTTPS with TLS 1.3 on a new connection, (c) HTTPS with TLS 1.2 on a new connection, (d) a second request on the kept-alive connection of (b). Ignore DNS. Check your method against the Part D chart.
4. **Trace.** Someone captures the client's link while it runs `curl --cacert ca.crt https://wallet.lab.test/alice` over TLS 1.3. For each item, say whether the observer can read it and why: both IP addresses, the server name, the ALPN list, the server certificate, the path `/alice`, the status code, the balance, the number of bytes sent each way.
5. **Debug.** On Monday at 08:00 every client of an internal API fails. The API's access log shows only lines with status 400 and an empty request, and nobody changed the server. Give the first two commands you run, what each prints if the cause is the most likely one, the fix that needs no restart, and the check that would have warned you a month earlier.
6. **Debug.** A health check runs `curl https://10.0.3.7/health` from a new container image and fails with exit code 60. The same URL with the service's name works from your laptop. There may be two separate causes. Name both, the message curl prints for each, and the fix for each.
7. **Debug.** Three wallet replicas sit behind a TCP (L4) load balancer. The mobile gateway calls them with gRPC. One replica runs at 90% CPU while the other two are idle; restarting the busy one moves the load to another replica. Explain the mechanism, and compare two fixes with their costs.
8. **Design.** The wallet will be reached as `wallet.example.com` by phones and as `wallet.internal` by other services. Decide where TLS ends (an L4 or an L7 balancer, or the wallet itself), which names go into the certificate's SAN list, how certificates are renewed and how you learn about expiry before users do, and the DNS TTL plan for moving to a new load balancer next month. Give one reason for each choice.

**Read the diagram.** Open the theory diagram "A client trusts a certificate only if five checks pass". For each of the three errors you caused in Lab 2.4 Break it, give the number of the check that failed and the line in the Server certificate or Root CA box that carries the cause. Then predict which check, and which program, complains first if someone replaces `wallet.key` with a newly made key but keeps `wallet.crt`.

## Hints

| Q | Hint |
| --- | --- |
| 1 | Part 1 and In production, row 1. A cache keeps an answer for the TTL it received with it, not the TTL the record has now. |
| 2 | resolv.conf, search and ndots in part 1, and Lab 2.4 Part A step 4. Count the dots in the name; a trailing dot changes everything. |
| 3 | TCP costs one round trip before a request can leave (Ch 2.3). Then read the TLS diagram and the Part D chart: how many round trips does each handshake add? |
| 4 | The tshark lines in part 3 and Lab 2.4 Part C step 6. Only the two Hello messages are in the clear. |
| 5 | Lab 2.4 Break it, steps 2 to 4: what the server logs, what `openssl s_client` and `openssl x509 -enddate` print, and what `nginx -s reload` does. |
| 6 | Two of the three checks in Break it step 5. Which one depends on the name you dialled, and which one on the files inside the image? |
| 7 | Part 5 and its diagram. When does an L4 balancer choose a backend, and how many connections does a gRPC client open? |
| 8 | The L4 and L7 table, the certificate checks, the ACME preview, In production rows 1 and 4, and the project cards. |
| Diagram | The diagram marks each line of the Server certificate box that a check reads with that check's number (1 to 5; the issuer and the signature both serve check 1). The subject line serves no check. For the key: what must the server prove with its private key during the handshake, and which program loads the key first? |
