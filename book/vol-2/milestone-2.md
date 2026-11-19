# Milestone 2 · The Wallet on the Network

## Goal

Milestone 2 gives the wallet a name and a certificate you issued yourself, and runs the whole thing inside network namespaces you wired by hand. You finish when a `curl` in a client namespace reads a balance from `https://wallet.lab.test` and verifies the server against your own CA.

Budget about 6 hours. You reuse `cni.sh` from Lab 2.5, the DNS and CA steps from Lab 2.4, and the wallet v0 file from Lab 1.1. You need no new tools.

Work in a container started with `-v ~/cn-lab:/root/cn-lab` (see the Overview), or on a VM, so that the repository and `pki/` stay on your machine when the container ends. Copy `cni.sh` from Lab 2.5 into `~/cn-lab/vol2/milestone2/` first; `docker cp node-a:/root/cn-lab/vol2/cni/cni.sh ~/cn-lab/vol2/milestone2/` does it. Run `bring-up.sh` with its output sent to a file or to the terminal, never through a pipe such as `| tail`: the daemons it starts keep the pipe open and the command never returns.

## Deliverables

Hand in one git repository, `~/cn-lab/vol2/milestone2/`, with exactly these parts:

| Path | What it is |
| --- | --- |
| `bring-up.sh` | Builds everything from nothing: bridge, three pods, DNS, CA, certificate, wallet, nginx. Safe to run twice in a row |
| `tear-down.sh` | Removes every namespace, link, nftables table and process that `bring-up.sh` made |
| `verify.sh` | The self-check below, unchanged |
| `pki/ca.crt` | Your CA certificate. The private key `ca.key` must **not** be in the repository (add it to `.gitignore`) |
| `evidence/` | Captures and command outputs listed under "Evidence" |
| `README.md` | The topology diagram you drew, and half a page: the life of one request, layer by layer |

## What you will build

Three pods on one bridge. The client asks the dns pod for an address, then opens HTTPS to nginx in the wallet pod. nginx terminates TLS and passes plain HTTP to wallet v0 over loopback; wallet v0 itself is not reachable from the network.

{{diagram milestone-2-01.jsx | Milestone 2 topology · 3 pods, 1 bridge, NAT out}}
## Requirements

Fix these names and addresses so that `verify.sh` works for everyone.

| # | Requirement | Fixed values |
| --- | --- | --- |
| R1 | The client resolves `wallet.lab.test` through a DNS server in the dns pod, not through `/etc/hosts` | dns pod `10.244.1.53`, answer `10.244.1.10` |
| R2 | `https://wallet.lab.test/alice` returns `{"account": "alice", "balance": 100}` when the client trusts `pki/ca.crt` | client pod `10.244.1.20` |
| R3 | Without your CA the same request fails with curl exit code 60 |  |
| R4 | The certificate names `wallet.lab.test` in its subject alternative name; the IP address is rejected | wallet pod `10.244.1.10` |
| R5 | Plain HTTP on port 80 answers `301` to the HTTPS address |  |
| R6 | Port 8080 of the wallet is not reachable from the other pods (wallet v0 stays on `127.0.0.1`) |  |
| R7 | The server refuses TLS 1.1 and older | TLS 1.2 and 1.3 allowed |
| R8 | The server certificate is valid for 90 days at most |  |
| R9 | Pods can reach the outside through one masquerade rule scoped to the pod subnet |  |
| R10 | The three pods hang off a bridge you created with your own functions from Lab 2.5 | bridge `cni0`, subnet `10.244.1.0/24` |
| R11 | `bring-up.sh` twice in a row, then `tear-down.sh`, leaves `ip netns list`, `ip link`, `nft list tables` and the running processes as they were before (in a container, killed processes can linger as zombies, state `Z` in `ps -eo stat,comm`, because PID 1 never calls `wait`; ignore those) |  |

## The self-check

Save this as `verify.sh` and run it as root next to your scripts. It checks R1 to R10; R11 is checked by hand. The script reports evidence for your grader; a green run is necessary but is not the grade.

```bash
#!/bin/bash
# Milestone 2 self-check. Run as root next to bring-up.sh. Prints PASS/FAIL per check.
cd "$(dirname "$0")"; W=$PWD; CA=$W/pki/ca.crt; n=0; ok=0
check() { n=$((n+1)); if eval "$2" >/dev/null 2>&1; then ok=$((ok+1)); echo "PASS  $1"; else echo "FAIL  $1"; fi; }
C="ip netns exec client"
check "1 name resolves to the wallet pod"          "[ \"\$($C dig +short wallet.lab.test)\" = 10.244.1.10 ]"
check "2 HTTPS with your CA returns the balance"   "$C curl -sf --cacert $CA https://wallet.lab.test/alice | grep -q '\"balance\": 100'"
check "3 HTTPS without the CA is refused (exit 60)" "$C curl -s https://wallet.lab.test/alice; [ \$? -eq 60 ]"
check "4 the IP address is rejected (name mismatch)" "$C curl -s --cacert $CA https://10.244.1.10/alice; [ \$? -eq 60 ]"
check "5 plain HTTP redirects to HTTPS (301)"      "[ \"\$($C curl -s -o /dev/null -w '%{http_code}' http://wallet.lab.test/alice)\" = 301 ]"
check "6 the wallet port 8080 is not reachable from the client" "$C curl -s -m 2 http://10.244.1.10:8080/alice; [ \$? -ne 0 ]"
check "7 TLS 1.1 is refused by the server"        "echo | $C openssl s_client -connect 10.244.1.10:443 -servername wallet.lab.test -tls1_1 -cipher 'ALL:@SECLEVEL=0' 2>&1 | grep -q 'alert protocol version'"
check "8 server certificate is valid for <= 90 days" "[ \$(( \$(date -d \"\$(openssl x509 -in $W/pki/wallet.crt -noout -enddate | cut -d= -f2)\" +%s) - \$(date +%s) )) -le \$((91*86400)) ]"
check "9 the wallet pod reaches the outside through NAT" "ip netns exec wallet ping -c1 -W2 $(ip -4 route show default | awk '{print $3}' | head -1)"
check "10 pods are on your bridge, not Docker's" "bridge link | grep -q 'master cni0'"
echo "$ok / $n checks passed"
```

A passing run ends with `10 / 10 checks passed`. Check 9 pings the host's default gateway; if your VM blocks ICMP there, change the target and say so in your README.

## Suggested order

1. **Wire the network (60 min).** Source your `cni.sh`. Run `node_up 1`, `nat_up 1`, then `pod_add` for `wallet`, `dns` and `client` with the fixed addresses. Ping between pods.
2. **Give the pods a job (60 min).** Start dnsmasq in the dns pod with a host record for `wallet.lab.test`. Write `/etc/netns/client/resolv.conf` so `ip netns exec client` uses it. Start wallet v0 inside the wallet pod.
3. **Be your own CA (60 min).** Create the CA, a key and certificate request for the wallet, and sign it with a SAN. Keep every file under `pki/`.
4. **Put TLS in front (60 min).** Write the nginx configuration for ports 80 and 443 and start it in the wallet pod, proxying to `127.0.0.1:8080`.
5. **Make it repeatable (60 min).** Turn your history into `bring-up.sh` and `tear-down.sh`. Run them twice. Fix what breaks: leftover namespaces, `File exists`, a stale nginx.
6. **Collect evidence (60 min).** See below. Then run `verify.sh`.

Two traps cost most students an hour. First, `tcpdump -w` needs `-Z root` or it fails silently (Lab 2.1). Second, `ip netns exec` bind-mounts `/etc/netns/<name>/resolv.conf` only for that namespace; a `resolv.conf` written anywhere else changes nothing.

## Evidence

Put these in `evidence/`, each with one sentence saying what it proves:

- `dns.pcap` and its decoded text: one query and its answer for `wallet.lab.test`, captured inside the dns pod.
- `tls.pcap` and a `tshark` decode that shows the Client Hello with `SNI=wallet.lab.test`, captured inside the wallet pod.
- The output of `nft list table ip cni`, `ip -n client route` and `ip -br addr` for the bridge and each pod.
- The three failure outputs: no trust, IP instead of name, and expired (use `faketime '+120 days'`).
- `curl -v` of one successful request, with the lines for TLS version, ALPN and certificate checks.

## Grading rubric

The grader runs `bring-up.sh` on a clean machine, then `verify.sh`, then reads the evidence.

| Area | Points | Full marks when |
| --- | --- | --- |
| Network wiring (R9, R10) | 20 | three pods created with your own `pod_add` on your own `cni0`; masquerade rule limited to the pod subnet and not applied to pod-to-pod traffic |
| Names (R1) | 15 | answer comes from a DNS server in the dns pod; per-namespace `resolv.conf`; the capture shows query and answer |
| Trust and TLS (R2, R3, R4, R7, R8) | 25 | the client trusts only your CA file; SAN is set; TLS 1.2 or newer; certificate at most 90 days; `ca.key` is not in the repository |
| Exposure (R5, R6) | 10 | HTTP redirects; wallet v0 is reachable only through nginx |
| Repeatability (R11) | 10 | two runs in a row work; tear-down leaves nothing behind |
| Evidence and explanation | 15 | every evidence item present; the half page names, for each hop, which header changed (MAC, IP, TCP, TLS) |
| README and code | 5 | the diagram matches what the scripts build; scripts are readable |
| **Total** | **100** |  |

## Stretch (+10)

Move the client pod to a second host and reach `https://wallet.lab.test` across your VXLAN overlay from Lab 2.5. The name still resolves to `10.244.1.10`, the certificate still verifies, and a capture on the underlay shows UDP port 4789. Write down which MTU you chose and why.
