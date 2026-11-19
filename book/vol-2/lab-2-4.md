# Lab 2.4 · Your Own CA and the Wallet over HTTPS

## Goal

You will give the wallet a front door inside a private network: names from your own DNS server, HTTP typed by hand, HTTPS signed by your own certificate authority; then measure what each round trip costs and break the certificate three ways.

**Versions tested** (2026-11-16, privileged `ubuntu:24.04` container; kernel 6.18.58.1-microsoft-standard-WSL2 on Docker Desktop): iproute2 6.1.0, tcpdump 4.99.4, nginx 1.24.0, dnsmasq 2.91, OpenSSL 3.0.13, curl 8.5.0, dig 9.18.39, tshark 4.2.2, faketime 0.9.10, Python 3.12.3. A VM or WSL2 distro with Ubuntu 24.04 (kernel 6.8) is **targeted**: same commands, not run. Every output below came from those runs; addresses stay the same, but ports, process IDs, serial numbers, dates and timings differ on your machine.

**Before you start.** You need root on Ubuntu 24.04. The tested route is a throwaway privileged container (on a VM or WSL2, run `sudo -i` first and skip the `docker run`):

```bash
mkdir -p ~/cn-lab && docker run -it --rm --privileged -v ~/cn-lab:/root/cn-lab --name cnlab-vol2 ubuntu:24.04 bash
```

In the container route, the option `-v ~/cn-lab:/root/cn-lab` keeps `~/cn-lab/vol2/` (the wallet, the CA and the nginx file that Milestone 2 reuses) on your own machine, so that it survives when the container ends.

Inside it, install the tools (`tshark` asks a question unless you set `DEBIAN_FRONTEND`):

```bash
apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
  iproute2 tcpdump iputils-ping curl python3 openssl nginx dnsmasq dnsutils \
  netcat-openbsd tshark faketime
```

Network namespaces are private, so nothing here touches the real network. Your files live in `~/cn-lab/vol2/` (`wallet/`, `pki/`, `nginx-wallet.conf`); Milestone 2 reuses the same names. If `ip netns list` shows namespaces from an earlier lab, run that lab's cleanup, or the cleanup block at the end of this lab, before you start.

### What you will build

{{diagram lab-2-4-01.jsx | what you will build in Lab 2.4 · one bridge, three network namespaces}}
## Part A · Names: the network, your DNS server and ndots (45 min)

You will build the lab network, watch the wallet refuse a remote client, run your own DNS server and see one lookup turn into six queries.

**Step 1: the network.** A bridge acts as a virtual switch, and each network namespace acts as a separate host joined to it by a *veth pair*, a virtual cable with one end inside the namespace. The script uses `ip -n NAME <args>`, which is shorthand for `ip netns exec NAME ip <args>`.

```bash
mkdir -p ~/cn-lab/vol2/wallet ~/cn-lab/vol2/pki && cd ~/cn-lab/vol2
cat > labnet.sh <<'NET'
# lab network: bridge br-lab (10.20.0.1/24 = the "host" as gateway) + three hosts
ip link add br-lab type bridge
ip addr add 10.20.0.1/24 dev br-lab
ip link set br-lab up
mk() {   # mk NAME IP
  ip netns add $1
  ip link add v-$1 type veth peer name eth0 netns $1
  ip link set v-$1 master br-lab up
  ip -n $1 addr add $2/24 dev eth0
  ip -n $1 link set eth0 up
  ip -n $1 link set lo up
  ip -n $1 route add default via 10.20.0.1
}
mk client 10.20.0.10
mk dns    10.20.0.53
mk wallet 10.20.0.80
NET
bash labnet.sh
ip -br addr show br-lab
ip netns list
ip netns exec client ping -c 1 10.20.0.80 | tail -2
```

```text
br-lab           UP             10.20.0.1/24 fe80::7465:37ff:fe42:da8b/64
wallet (id: 3)
client (id: 1)
dns (id: 2)
1 packets transmitted, 1 received, 0% packet loss, time 0ms
rtt min/avg/max/mdev = 0.138/0.138/0.138/0.000 ms
```

**Step 2: the wallet, alone in its namespace.** Save wallet v0 from Lab 1.1 (or copy `~/cn-lab/wallet/wallet.py`) and start it inside the `wallet` namespace:

```bash
cd ~/cn-lab/vol2/wallet
cat > wallet.py <<'PY'
#!/usr/bin/env python3
"""wallet v0: one process, balances kept in a JSON file."""
import json, os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

DATA = os.environ.get("WALLET_DATA", "balances.json")
PORT = int(os.environ.get("WALLET_PORT", "8080"))

def load():
    with open(DATA) as f:
        return json.load(f)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        account = self.path.strip("/")
        balances = load()
        if account not in balances:
            self.send_error(404, "no such account")
            return
        body = json.dumps({"account": account, "balance": balances[account]})
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body.encode() + b"\n")

print(f"wallet v0 pid={os.getpid()} port={PORT} data={DATA}", file=sys.stderr, flush=True)
HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
PY
chmod +x wallet.py
echo '{"alice": 100, "bob": 50}' > balances.json
ip netns exec wallet python3 ./wallet.py 2>wallet.log &
sleep 1
ip netns exec client curl -sS -m 3 http://10.20.0.80:8080/alice; echo "exit=$?"
ip netns exec wallet curl -sS http://127.0.0.1:8080/alice
ip netns exec wallet ss -tlnp
```

```text
curl: (7) Failed to connect to 10.20.0.80 port 8080 after 0 ms: Couldn't connect to server
exit=7
{"account": "alice", "balance": 100}
State  Recv-Q Send-Q Local Address:Port Peer Address:PortProcess
LISTEN 0      5          127.0.0.1:8080      0.0.0.0:*    users:(("python3",pid=3622,fd=3)
```

The wallet works inside its own namespace and refuses the client: it listens on `127.0.0.1`, the loopback of *its* namespace. Part B puts nginx in front of it.

**Step 3: your own DNS server.** Start `dnsmasq` in the `dns` namespace. It answers one name and logs every query. Then give the `client` namespace its own `resolv.conf`: `ip netns exec` shows files from `/etc/netns/client/` in place of the ones in `/etc`.

```bash
cd ~/cn-lab/vol2
ip netns exec dns dnsmasq --keep-in-foreground --conf-file=/dev/null --no-resolv --no-hosts \
  --listen-address=10.20.0.53 --bind-interfaces \
  --local=/lab.test/ --local=/cluster.local/ \
  --host-record=wallet.lab.test,10.20.0.80 --local-ttl=60 \
  --log-queries --log-facility=- 2>> dns.log &
sleep 1
mkdir -p /etc/netns/client
echo "nameserver 10.20.0.53" > /etc/netns/client/resolv.conf
ip netns exec client dig wallet.lab.test
```

The interesting lines of the answer (trimmed):

```text
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 56940
;; flags: qr aa rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1
;; QUESTION SECTION:
;wallet.lab.test.		IN	A

;; ANSWER SECTION:
wallet.lab.test.	60	IN	A	10.20.0.80

;; SERVER: 10.20.0.53#53(10.20.0.53) (UDP)
```

`status: NOERROR` means the name exists; `60` is the TTL you set with `--local-ttl`; `aa` marks an answer from a server that is authoritative for the name. Now the other cases, and a packet capture of one lookup:

```bash
ip netns exec client dig +short wallet.lab.test
ip netns exec client dig nosuch.lab.test | grep -E "status|flags"
ip netns exec client getent hosts wallet.lab.test
ip netns exec dns tcpdump -Z root -n -i eth0 -c 2 -w /tmp/dns.pcap "udp port 53" 2>/dev/null &
sleep 1
ip netns exec client dig +short wallet.lab.test > /dev/null
sleep 1; pkill -x tcpdump
tcpdump -n -v -r /tmp/dns.pcap 2>/dev/null
```

```text
10.20.0.80
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 7670
;; flags: qr rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 0, ADDITIONAL: 1
10.20.0.80      wallet.lab.test
08:07:34.267920 IP (tos 0x0, ttl 64, id 6870, offset 0, flags [none], proto UDP (17), length 84)
    10.20.0.10.35949 > 10.20.0.53.53: 44708+ [1au] A? wallet.lab.test. (56)
08:07:34.268083 IP (tos 0x0, ttl 64, id 12552, offset 0, flags [DF], proto UDP (17), length 88)
    10.20.0.53.53 > 10.20.0.10.35949: 44708* 1/0/1 wallet.lab.test. A 10.20.0.80 (60)
```

One UDP packet carries the question (`A? wallet.lab.test.`), one carries the answer (`A 10.20.0.80`), and both hold the same query ID, `44708`. The unknown name got `NXDOMAIN`: "this name does not exist". `getent hosts` resolves the way a normal program does, through the C library, so it asked for both `A` and `AAAA` records, as the server log shows:

```bash
grep -E "query|config" dns.log | tail -6
```

```text
dnsmasq[3629]: query[AAAA] wallet.lab.test from 10.20.0.10
dnsmasq[3629]: config wallet.lab.test is NODATA-IPv6
dnsmasq[3629]: query[A] wallet.lab.test from 10.20.0.10
dnsmasq[3629]: config wallet.lab.test is 10.20.0.80
dnsmasq[3629]: query[A] wallet.lab.test from 10.20.0.10
dnsmasq[3629]: config wallet.lab.test is 10.20.0.80
```

**Step 4: search and ndots, the Kubernetes preview.** Give the client the same `search` and `ndots` settings a Kubernetes Pod gets, empty the log, and resolve the same name once:

```bash
cat > /etc/netns/client/resolv.conf <<'RC'
nameserver 10.20.0.53
search svc.cluster.local cluster.local
options ndots:5
RC
: > dns.log
ip netns exec client getent hosts wallet.lab.test
grep -E "query|config" dns.log
```

```text
10.20.0.80      wallet.lab.test
dnsmasq[3629]: query[AAAA] wallet.lab.test.svc.cluster.local from 10.20.0.10
dnsmasq[3629]: config wallet.lab.test.svc.cluster.local is NXDOMAIN
dnsmasq[3629]: query[AAAA] wallet.lab.test.cluster.local from 10.20.0.10
dnsmasq[3629]: config wallet.lab.test.cluster.local is NXDOMAIN
dnsmasq[3629]: query[AAAA] wallet.lab.test from 10.20.0.10
dnsmasq[3629]: config wallet.lab.test is NODATA-IPv6
dnsmasq[3629]: query[A] wallet.lab.test.svc.cluster.local from 10.20.0.10
dnsmasq[3629]: config wallet.lab.test.svc.cluster.local is NXDOMAIN
dnsmasq[3629]: query[A] wallet.lab.test.cluster.local from 10.20.0.10
dnsmasq[3629]: config wallet.lab.test.cluster.local is NXDOMAIN
dnsmasq[3629]: query[A] wallet.lab.test from 10.20.0.10
dnsmasq[3629]: config wallet.lab.test is 10.20.0.80
```

One lookup, six queries: `wallet.lab.test` has two dots, fewer than `ndots:5`, so the stub tried both search domains before the real name, for `AAAA` and for `A`. The `--local=/cluster.local/` flag makes dnsmasq answer those guesses with `NXDOMAIN` itself. A name that ends in a dot is complete and skips the search list:

```bash
: > dns.log
ip netns exec client getent hosts wallet.lab.test.
grep -c query dns.log
printf 'nameserver 10.20.0.53\n' > /etc/netns/client/resolv.conf
```

```text
10.20.0.80      wallet.lab.test
2
```

Two queries instead of six (`A` and `AAAA` for the one real name). The last line puts the plain `resolv.conf` back.

**Step 5 (optional): a real cache.** If your network allows DNS, ask a public name twice, two seconds apart, and read the TTL column. On the test machine the first answer said `300` and the second `298`: the second came from the resolver's cache.

```bash
dig +noall +answer example.com; sleep 2; dig +noall +answer example.com
```

`dig +trace example.com` shows the walk from the root servers down (diagram in the theory). It was **targeted, not run**: the corporate network of the test machine blocked it.

1. In the capture, which two things in the packets show that the second packet answers the first? Which port is the server's?
2. Why did the unknown name give `NXDOMAIN` and not a timeout? Which flag made dnsmasq answer for `lab.test` itself?
3. In a cluster, a Pod resolves `wallet` (no dots). Which names does it try, and in which order? Use the Kubernetes `resolv.conf` from the theory.
4. `wallet.lab.test` took six queries with `ndots:5`. How many does an external name such as `example.com` take, and what would you change to cut that?

## Part B · HTTP by hand (40 min)

You will put nginx in front of the wallet, type an HTTP request yourself, and see one connection carry two requests.

nginx runs in the `wallet` namespace, so its `proxy_pass` reaches the wallet on that namespace's loopback. The client reaches nginx on the namespace's real address, `10.20.0.80`.

```bash
cd ~/cn-lab/vol2
cat > nginx-wallet.conf <<'NG'
pid /tmp/nginx-wallet.pid;
error_log stderr info;
events {}
http {
  access_log /dev/stdout;
  server {
    listen 80;
    server_name wallet.lab.test;
    location / { proxy_pass http://127.0.0.1:8080; }
  }
}
NG
ip netns exec wallet nginx -t -c $PWD/nginx-wallet.conf
ip netns exec wallet nginx -c $PWD/nginx-wallet.conf > nginx.log 2>&1 &
sleep 1
```

```text
nginx: the configuration file /root/cn-lab/vol2/nginx-wallet.conf syntax is ok
nginx: configuration file /root/cn-lab/vol2/nginx-wallet.conf test is successful
```

**HTTP typed by hand.** `nc` opens a TCP connection and sends whatever you pipe in. `printf` writes the request with the line ends (`\r\n`) that HTTP requires. The name `wallet.lab.test` goes through your DNS server first.

```bash
printf 'GET /alice HTTP/1.1\r\nHost: wallet.lab.test\r\nConnection: close\r\n\r\n' \
  | ip netns exec client nc wallet.lab.test 80
```

```text
HTTP/1.1 200 OK
Server: nginx/1.24.0 (Ubuntu)
Date: Mon, 16 Nov 2026 08:07:36 GMT
Content-Type: application/json
Transfer-Encoding: chunked
Connection: close

25
{"account": "alice", "balance": 100}

0

```

That is the whole protocol: a request line, headers, a blank line, then a status line, headers, a blank line and a body in chunks (`25` is hexadecimal for 37 bytes; the final `0` ends the body).

**The same request with `curl -v`.** The `>` lines are what curl sent, the `<` lines what it received, the `*` lines are curl's own notes. `grep` keeps only those:

```bash
ip netns exec client curl -sv http://wallet.lab.test/alice 2>&1 | grep -E '^[<>*]' | grep -v '^\* Using'
```

```text
* Host wallet.lab.test:80 was resolved.
* IPv6: (none)
* IPv4: 10.20.0.80
*   Trying 10.20.0.80:80...
* Connected to wallet.lab.test (10.20.0.80) port 80
> GET /alice HTTP/1.1
> Host: wallet.lab.test
> User-Agent: curl/8.5.0
> Accept: */*
>
< HTTP/1.1 200 OK
< Server: nginx/1.24.0 (Ubuntu)
< Date: Mon, 16 Nov 2026 08:07:36 GMT
< Content-Type: application/json
< Transfer-Encoding: chunked
< Connection: keep-alive
<
* Connection #0 to host wallet.lab.test left intact
```

The first notes are the DNS lookup (`IPv4: 10.20.0.80`) and the TCP connect. curl asked for `keep-alive` by default and nginx agreed, so the connection stays open. Give curl two URLs and watch it re-use the connection:

```bash
ip netns exec client curl -sv http://wallet.lab.test/alice http://wallet.lab.test/bob 2>&1 \
  | grep -E "Connected|Re-using|^\{|Host:"
```

```text
* Connected to wallet.lab.test (10.20.0.80) port 80
> Host: wallet.lab.test
{ [37 bytes data]
{"account": "alice", "balance": 100}
* Re-using existing connection with host wallet.lab.test
> Host: wallet.lab.test
{ [34 bytes data]
{"account": "bob", "balance": 50}
```

One `Connected`, two requests. Last, ask the wallet itself, without nginx, which HTTP version it speaks:

```bash
ip netns exec wallet curl -sv http://127.0.0.1:8080/alice 2>&1 | grep -E '^< HTTP'
```

```text
< HTTP/1.0 200 OK
```

1. Count the bytes of the body line with `echo '{"account": "alice", "balance": 100}' | wc -c`. Does it match `25`?
2. Which header would a second site on the same IP address rely on, and where in nginx's configuration is the matching name?
3. The wallet speaks HTTP/1.0 and answers one request per connection. What does the client see instead, and who made that difference?
4. Without keep-alive, how many TCP handshakes would curl have needed for the two URLs? Count them in the theory's diagram of HTTP/1.1.

## Part C · Your own CA and HTTPS (60 min)

You will become a certificate authority, sign a certificate for `wallet.lab.test`, serve the wallet over HTTPS with HTTP/2, and look at the handshake on the wire.

**Step 1: a root CA and a server certificate.** Four things happen: make the CA's key and a self-signed root certificate; make the server's key; make a *certificate signing request* (CSR), which holds the server's public key and the name it wants; and sign it with the CA. The `wallet.ext` file gives the certificate its SAN and its purpose. Keep all of it in `pki/`.

```bash
cd ~/cn-lab/vol2/pki
openssl ecparam -name prime256v1 -genkey -noout -out ca.key
openssl req -x509 -new -key ca.key -sha256 -days 365 -subj "/CN=Lab Root CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out ca.crt
openssl ecparam -name prime256v1 -genkey -noout -out wallet.key
openssl req -new -key wallet.key -subj "/CN=wallet.lab.test" -out wallet.csr
cat > wallet.ext <<'EXT'
subjectAltName = DNS:wallet.lab.test
basicConstraints = CA:FALSE
keyUsage = digitalSignature
extendedKeyUsage = serverAuth
EXT
openssl x509 -req -in wallet.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 90 -sha256 \
  -extfile wallet.ext -out wallet.crt
ls
openssl verify -CAfile ca.crt wallet.crt
openssl x509 -in wallet.crt -noout -subject -issuer -dates -ext subjectAltName
openssl x509 -in ca.crt -noout -subject -issuer -ext basicConstraints
```

```text
Certificate request self-signature ok
subject=CN = wallet.lab.test
ca.crt
ca.key
ca.srl
wallet.crt
wallet.csr
wallet.ext
wallet.key
wallet.crt: OK
subject=CN = wallet.lab.test
issuer=CN = Lab Root CA
notBefore=Nov 16 08:07:37 2026 GMT
notAfter=Feb 14 08:07:37 2027 GMT
X509v3 Subject Alternative Name:
    DNS:wallet.lab.test
subject=CN = Lab Root CA
issuer=CN = Lab Root CA
X509v3 Basic Constraints: critical
    CA:TRUE
```

The root's `issuer` equals its `subject`: it is self-signed. The server certificate names the root as `issuer`, carries the SAN, and lasts 90 days. `ca.key` is the secret that must never leave the CA; `wallet.key` never leaves the wallet.

**Step 2: nginx speaks TLS.** Replace the configuration with three `server` blocks: port 80 redirects to HTTPS, port 8000 stays plain HTTP (Part D needs it for comparison), port 443 serves TLS 1.2 and 1.3 with HTTP/2.

```bash
cd ~/cn-lab/vol2
pkill -x nginx; sleep 0.5
cat > nginx-wallet.conf <<'NG'
pid /tmp/nginx-wallet.pid;
error_log stderr info;
events {}
http {
  access_log /dev/stdout;
  server {                       # plain HTTP: redirect to HTTPS
    listen 80;
    server_name wallet.lab.test;
    return 301 https://wallet.lab.test$request_uri;
  }
  server {                       # plain HTTP without redirect, for Part D
    listen 8000;
    location / { proxy_pass http://127.0.0.1:8080; }
  }
  server {                       # HTTPS, TLS 1.2 and 1.3, HTTP/2
    listen 443 ssl http2;
    server_name wallet.lab.test;
    ssl_certificate     /root/cn-lab/vol2/pki/wallet.crt;
    ssl_certificate_key /root/cn-lab/vol2/pki/wallet.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    location / { proxy_pass http://127.0.0.1:8080; }
  }
}
NG
ip netns exec wallet nginx -t -c $PWD/nginx-wallet.conf
ip netns exec wallet nginx -c $PWD/nginx-wallet.conf > nginx.log 2>&1 &
sleep 1
```

The certificate paths assume you are root, so `~` is `/root`; change them if not.

**Step 3: the first HTTPS request.** The client must be told to trust your CA with `--cacert`:

```bash
ip netns exec client curl -sS --cacert pki/ca.crt https://wallet.lab.test/alice
ip netns exec client curl -sv --cacert pki/ca.crt https://wallet.lab.test/alice 2>&1 \
  | grep -E "^\*|^<" | grep -E "TLS|ALPN|subject|issuer|expire|start date|SSL certificate|HTTP/"
```

```text
{"account": "alice", "balance": 100}
* ALPN: curl offers h2,http/1.1
* TLSv1.3 (OUT), TLS handshake, Client hello (1):
* TLSv1.3 (IN), TLS handshake, Server hello (2):
* TLSv1.3 (IN), TLS handshake, Encrypted Extensions (8):
* TLSv1.3 (IN), TLS handshake, Certificate (11):
* TLSv1.3 (IN), TLS handshake, CERT verify (15):
* TLSv1.3 (IN), TLS handshake, Finished (20):
* TLSv1.3 (OUT), TLS change cipher, Change cipher spec (1):
* TLSv1.3 (OUT), TLS handshake, Finished (20):
* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384 / X25519 / id-ecPublicKey
* ALPN: server accepted h2
*  subject: CN=wallet.lab.test
*  start date: Nov 16 08:07:37 2026 GMT
*  expire date: Feb 14 08:07:37 2027 GMT
*  subjectAltName: host "wallet.lab.test" matched cert's "wallet.lab.test"
*  issuer: CN=Lab Root CA
*  SSL certificate verify ok.
* using HTTP/2
* [HTTP/2] [1] OPENED stream for https://wallet.lab.test/alice
* [HTTP/2] [1] [:method: GET]
* [HTTP/2] [1] [:scheme: https]
* [HTTP/2] [1] [:authority: wallet.lab.test]
* [HTTP/2] [1] [:path: /alice]
* [HTTP/2] [1] [user-agent: curl/8.5.0]
* [HTTP/2] [1] [accept: */*]
* TLSv1.3 (IN), TLS handshake, Newsession Ticket (4):
* TLSv1.3 (IN), TLS handshake, Newsession Ticket (4):
< HTTP/2 200
```

These lines are the theory's diagram, in order: the Client Hello, the Server Hello, then four messages curl can name only because it holds the keys, and the two checks that matter, the name (`subjectAltName ... matched`) and the chain (`SSL certificate verify ok`). `ALPN: server accepted h2` is why the request became HTTP/2 streams.

**Step 4: versions and the redirect.**

```bash
ip netns exec client curl -s --http2   -o /dev/null -w "http_version=%{http_version}\n" --cacert pki/ca.crt https://wallet.lab.test/alice
ip netns exec client curl -s --http1.1 -o /dev/null -w "http_version=%{http_version}\n" --cacert pki/ca.crt https://wallet.lab.test/alice
ip netns exec client curl -si http://wallet.lab.test/alice | head -4
ip netns exec client curl -sv --tls-max 1.2 --http1.1 --cacert pki/ca.crt https://wallet.lab.test/alice 2>&1 \
  | grep -E "SSL connection|TLS handshake"
```

```text
http_version=2
http_version=1.1
HTTP/1.1 301 Moved Permanently
Server: nginx/1.24.0 (Ubuntu)
Date: Mon, 16 Nov 2026 08:07:38 GMT
Content-Type: text/html
* TLSv1.2 (OUT), TLS handshake, Client hello (1):
* TLSv1.2 (IN), TLS handshake, Server hello (2):
* TLSv1.2 (IN), TLS handshake, Certificate (11):
* TLSv1.2 (IN), TLS handshake, Server key exchange (12):
* TLSv1.2 (IN), TLS handshake, Server finished (14):
* TLSv1.2 (OUT), TLS handshake, Client key exchange (16):
* TLSv1.2 (OUT), TLS change cipher, Change cipher spec (1):
* TLSv1.2 (OUT), TLS handshake, Finished (20):
* TLSv1.2 (IN), TLS handshake, Finished (20):
* SSL connection using TLSv1.2 / ECDHE-ECDSA-AES256-GCM-SHA384 / X25519 / id-ecPublicKey
```

TLS 1.2 shows `Certificate` and `Server key exchange` as plain messages, and the client's `Client key exchange` comes after the server has spoken: a second round trip.

**Step 5: the same handshake in `openssl s_client`.** It prints the certificate chain and the verification result, which makes it the tool to reach for when `curl` only says "exit 60":

```bash
echo | ip netns exec client openssl s_client -connect 10.20.0.80:443 -servername wallet.lab.test \
  -CAfile pki/ca.crt 2>&1 | grep -E "Protocol|Cipher|Verification|depth|subject|issuer|s:|i:|Server certificate" | head -12
```

```text
depth=1 CN = Lab Root CA
depth=0 CN = wallet.lab.test
 0 s:CN = wallet.lab.test
   i:CN = Lab Root CA
Server certificate
subject=CN = wallet.lab.test
issuer=CN = Lab Root CA
Verification: OK
New, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384
```

`-servername` sends the SNI; without it a server with several certificates could not choose one. Depth 1 is the root, depth 0 the server certificate.

**Step 6: the handshake on the wire.** Capture one connection on the client's side, then read the file with `tshark`:

```bash
ip netns exec client tcpdump -Z root -n -i eth0 -w /tmp/tls.pcap "tcp port 443" 2>/dev/null &
sleep 1
ip netns exec client curl -s --http1.1 --cacert pki/ca.crt https://wallet.lab.test/alice
sleep 1; pkill -x tcpdump
tshark -r /tmp/tls.pcap -Y tls 2>/dev/null
tshark -r /tmp/tls.pcap -Y "tls.handshake.type == 1" -T fields \
  -e tls.handshake.extensions_server_name -e tls.handshake.extensions_alpn_str 2>/dev/null
tshark -r /tmp/tls.pcap -Y "tls.handshake.type == 11" 2>/dev/null | wc -l
```

```text
{"account": "alice", "balance": 100}
    4   0.001596   10.20.0.10 → 10.20.0.80   TLSv1 583 Client Hello (SNI=wallet.lab.test)
    6   0.001984   10.20.0.80 → 10.20.0.10   TLSv1.3 906 Server Hello, Change Cipher Spec, Application Data, Application Data, Application Data, Application Data
    8   0.003345   10.20.0.10 → 10.20.0.80   TLSv1.3 146 Change Cipher Spec, Application Data
    9   0.003514   10.20.0.10 → 10.20.0.80   TLSv1.3 171 Application Data
   10   0.003602   10.20.0.80 → 10.20.0.10   TLSv1.3 369 Application Data
   11   0.003659   10.20.0.80 → 10.20.0.10   TLSv1.3 369 Application Data
   13   0.004601   10.20.0.80 → 10.20.0.10   TLSv1.3 307 Application Data
   14   0.004743   10.20.0.10 → 10.20.0.80   TLSv1.3 90 Application Data
wallet.lab.test	http/1.1
0
```

Only the Client Hello (with the SNI, `wallet.lab.test`) and the Server Hello are readable. The four `Application Data` records inside packet 6 are the encrypted messages `curl -v` named in Step 3, and `tshark` finds **0** Certificate messages. The ALPN list is `http/1.1` only because this request used `--http1.1`. Now repeat with TLS 1.2 forced:

```bash
ip netns exec client tcpdump -Z root -n -i eth0 -w /tmp/tls12.pcap "tcp port 443" 2>/dev/null &
sleep 1
ip netns exec client curl -s --tls-max 1.2 --http1.1 --cacert pki/ca.crt https://wallet.lab.test/alice
sleep 1; pkill -x tcpdump
tshark -r /tmp/tls12.pcap -Y tls 2>/dev/null | cut -c1-110
tshark -r /tmp/tls12.pcap -Y "tls.handshake.type == 11" -T fields -e x509sat.printableString -e x509sat.uTF8String 2>/dev/null
```

```text
{"account": "alice", "balance": 100}
    4   0.001654   10.20.0.10 → 10.20.0.80   TLSv1 289 Client Hello (SNI=wallet.lab.test)
    6   0.002368   10.20.0.80 → 10.20.0.10   TLSv1.2 778 Server Hello, Certificate, Server Key Exchange, Ser
    8   0.003287   10.20.0.10 → 10.20.0.80   TLSv1.2 159 Client Key Exchange, Change Cipher Spec, Encrypted
    9   0.003581   10.20.0.80 → 10.20.0.10   TLSv1.2 117 Change Cipher Spec, Encrypted Handshake Message
   10   0.003928   10.20.0.10 → 10.20.0.80   TLSv1.2 178 Application Data
   11   0.005248   10.20.0.80 → 10.20.0.10   TLSv1.2 314 Application Data
   12   0.005425   10.20.0.10 → 10.20.0.80   TLSv1.2 97 Encrypted Alert
	Lab Root CA,wallet.lab.test
```

This time the certificate travelled in the clear: `tshark` reads the names `Lab Root CA` and `wallet.lab.test` straight out of packet 6.

1. A CSR holds the server's public key and name but not a signature from the CA. Which command added the CA's signature, and which file's secret did it use?
2. In Step 3, which `curl -v` line proves the *name* check and which proves the *chain* check? Which one would fail if you used the IP address, and which if you left out `--cacert`?
3. Why can `tshark` read the certificate in the TLS 1.2 capture but not in the TLS 1.3 capture, and what remains readable in both?
4. Redo Step 6 with `curl --http2` and compare the ALPN list in the Client Hello. Where does the choice between `h2` and `http/1.1` happen?

## Part D · What each round trip costs (45 min)

You will slow the network to a known 20 ms round trip, time 30 requests and chart where the time goes.

`tc netem` adds a fixed delay to every packet leaving an interface. Put 10 ms on all three hosts: a packet from the client to the wallet waits 10 ms, and so does the reply, so one round trip takes about 20 ms. The DNS server is delayed too, so even the lookup costs one round trip.

```bash
cd ~/cn-lab/vol2
for n in client dns wallet; do ip netns exec $n tc qdisc add dev eth0 root netem delay 10ms; done
ip netns exec client tc qdisc show dev eth0
ip netns exec client ping -c 3 -q 10.20.0.80 | tail -1
```

```text
qdisc netem 8044: root refcnt 13 limit 1000 delay 10ms
rtt min/avg/max/mdev = 20.217/20.418/20.754/0.238 ms
```

Now time ten requests in each of three modes. `curl -w` prints, in seconds since the start: `time_namelookup` (DNS done), `time_connect` (TCP connected), `time_appconnect` (TLS handshake done, 0 for plain HTTP) and `time_starttransfer` (first reply byte). The summary script turns those cumulative times into per-phase medians.

```bash
F='%{time_namelookup},%{time_connect},%{time_appconnect},%{time_starttransfer},%{time_total}\n'
echo "mode,run,namelookup,connect,appconnect,starttransfer,total" > meas.csv
for mode in http tls13 tls12; do
  for i in $(seq 1 10); do
    case $mode in
      http)  url=http://wallet.lab.test:8000/alice; opt="";;
      tls13) url=https://wallet.lab.test/alice; opt="--cacert pki/ca.crt --http1.1";;
      tls12) url=https://wallet.lab.test/alice; opt="--cacert pki/ca.crt --http1.1 --tls-max 1.2";;
    esac
    echo "$mode,$i,$(ip netns exec client curl -s -o /dev/null -w "$F" $opt $url)" >> meas.csv
  done
done
for n in client dns wallet; do ip netns exec $n tc qdisc del dev eth0 root; done
head -4 meas.csv
```

```text
mode,run,namelookup,connect,appconnect,starttransfer,total
http,1,0.024232,0.044686,0.000000,0.073577,0.073695
http,2,0.021782,0.042228,0.000000,0.064982,0.065119
http,3,0.022802,0.043517,0.000000,0.067828,0.067968
```

The last loop removes the delay again. Save this as `summarize.py` and run it:

```python
import csv, statistics as st, sys
rows = list(csv.DictReader(open(sys.argv[1])))
print("mode   dns   tcp   tls  request  total   (median ms of %d runs)" % (len(rows)//3))
for mode in ("http", "tls13", "tls12"):
    r = [x for x in rows if x["mode"] == mode]
    f = lambda k: [float(x[k]) * 1000 for x in r]
    nl, co, ap, stt, tot = (f(k) for k in ("namelookup", "connect", "appconnect", "starttransfer", "total"))
    dns = st.median(nl)
    tcp = st.median(c - n for c, n in zip(co, nl))
    tls = st.median(a - c if a > 0 else 0 for a, c in zip(ap, co))
    req = st.median(s - max(c, a) for s, c, a in zip(stt, co, ap))
    print(f"{mode:6} {dns:5.1f} {tcp:5.1f} {tls:5.1f} {req:8.1f} {st.median(tot):6.1f}")
```

```bash
python3 summarize.py meas.csv
```

```text
mode   dns   tcp   tls  request  total   (median ms of 10 runs)
http    23.7  20.6   0.0     25.3   69.9
tls13   21.7  20.6  32.5     23.7  100.0
tls12   21.9  20.6  51.5     23.0  117.0
```

The test machine was busy with other jobs, so your numbers will wobble by a few milliseconds; the shape holds. These medians are the chart's rows:

{{diagram lab-2-4-02.jsx | measured on the test machine, 2026-11-16 · medians of 10 requests per mode from meas.csv; round trip 20.4 ms (ping)}}
Every phase except the handshake costs about one round trip: the lookup (21 to 24 ms), the TCP connect (21 ms, the SYN and its answer) and the request with its reply (23 to 25 ms, including the wallet's own work). The TLS 1.3 handshake took 32.5 ms, about one round trip plus 12 ms of computing; TLS 1.2 took 51.5 ms, about two round trips plus 11 ms. The gap between them, 19 ms, is one round trip. A second request on the same open connection pays only the last phase, which is why keep-alive, HTTP/2 and connection pools matter.

1. Which phases disappear for a second request on a kept-alive connection? How long should it take, according to the chart?
2. The TLS 1.3 handshake took 32.5 ms but the round trip is 20.4 ms. Where did the other 12 ms go? Hint: the server signed and the client verified something.
3. Predict the three totals if you set `delay 50ms` instead of `10ms` (round trip about 100 ms), using whole round trips plus the roughly 12 ms of computing. Then run it and compare.
4. When would the lookup phase cost almost nothing, and which part of the theory's DNS diagram would be responsible?

## Checkpoint

You are done when every check below prints what the right column says, run from a fresh shell in `~/cn-lab/vol2`, and your notebook holds the items in the last row. Timings, ports, PIDs and dates differ on your machine.

| Check | Expected |
| --- | --- |
| `ip netns list` | `client`, `dns` and `wallet`, in any order |
| `ip netns exec client dig +short wallet.lab.test` | `10.20.0.80` |
| `ip netns exec client dig nosuch.lab.test` | `status: NXDOMAIN` and `ANSWER: 0` |
| `getent hosts wallet.lab.test` in `client` with `search svc.cluster.local cluster.local` and `ndots:5`, then `grep -c query dns.log` | `10.20.0.80 wallet.lab.test`, and 6 queries in the log |
| `ip netns exec client curl -s http://wallet.lab.test/alice` with Part B's nginx | `{"account": "alice", "balance": 100}` |
| `openssl verify -CAfile pki/ca.crt pki/wallet.crt` | `pki/wallet.crt: OK` |
| `ip netns exec client curl -s --cacert pki/ca.crt -o /dev/null -w '%{http_version}\n' https://wallet.lab.test/alice` | `2` |
| `tshark -r /tmp/tls.pcap -Y "tls.handshake.type == 11" \| wc -l` on the TLS 1.3 capture | `0` (no Certificate message in the clear) |
| `python3 summarize.py meas.csv` | three rows; `tls13` about one round trip above `http`, `tls12` about two |
| Break it, client clock moved 120 days ahead | `curl: (60) SSL certificate problem: certificate has expired`, and `exit=0` again after the reissue |
| Notebook | Answers to every numbered question in Parts A to D and Break it, plus the DNS capture, the six-query log, the `tshark` lines for TLS 1.3 and 1.2, your `meas.csv` summary and the three Break it error lines |

## Break it: the certificate that expired overnight

An expired certificate stops every client at once, and the server's own log does not say why. You will move the client's clock past the certificate's `notAfter`, read the error from three tools, renew the certificate without restarting nginx, and then cause the two other checks of the theory (name and chain) to fail. Milestone 2 depends on all three. Start where Part D ended: nginx serves HTTPS with the 90-day `wallet.crt`, and the delay is removed.

**1. Cause it.** `faketime` changes the clock of one command only; the server and the certificate stay untouched, exactly as if 120 days had passed for the client.

```bash
cd ~/cn-lab/vol2
ip netns exec client curl -sS --cacert pki/ca.crt https://wallet.lab.test/alice; echo "exit=$?"
ip netns exec client faketime '+120 days' date -u
ip netns exec client faketime '+120 days' curl -sS --cacert pki/ca.crt https://wallet.lab.test/alice; echo "exit=$?"
```

```text
{"account": "alice", "balance": 100}
exit=0
Tue Mar 16 09:26:19 UTC 2027
curl: (60) SSL certificate problem: certificate has expired
More details here: https://curl.se/docs/sslcerts.html
...
exit=60
```

The same command that worked a second ago now fails before any HTTP is sent. Exit code 60 means "Peer certificate cannot be authenticated with known CA certificates" ([curl man page](https://curl.se/docs/manpage.html), EXIT CODES).

**2. Ask the server's side.** Look at what nginx logged for the failed connection:

```bash
tail -2 nginx.log
```

```text
2026/11/16 09:26:19 [info] 3138#3138: *21 client prematurely closed connection while reading client request line, client: 10.20.0.10, server: wallet.lab.test
10.20.0.10 - - [16/Nov/2026:09:26:19 +0000] "" 400 0 "-" "-"
```

The server saw a client that hung up without a request: an empty request line and status 400. The reason lives only on the client side. That is why certificate outages are first reported by users, not by the server's logs.

**3. Diagnose it with the chapter's tools.** `curl -v` shows the TLS alert the client sent, and `openssl s_client` names the failed check and the certificate it failed on:

```bash
ip netns exec client faketime '+120 days' curl -sv --cacert pki/ca.crt https://wallet.lab.test/alice 2>&1 | grep -E "TLS alert|SSL certificate problem"
echo | ip netns exec client faketime '+120 days' openssl s_client -connect 10.20.0.80:443 \
  -servername wallet.lab.test -CAfile pki/ca.crt 2>&1 | grep -E "^depth|verify error|Verify return code" | sort -u
```

```text
* TLSv1.3 (OUT), TLS alert, certificate expired (557):
* SSL certificate problem: certificate has expired
Verify return code: 10 (certificate has expired)
depth=0 CN = wallet.lab.test
depth=1 CN = Lab Root CA
verify error:num=10:certificate has expired
```

`depth=0` is the server certificate and `depth=1` the root that signed it; the error belongs to depth 0. Now read the dates straight from the certificate the server sends, with the real clock. `-checkend N` asks "will it still be valid N seconds from now?" and sets the exit code, which is what a monitoring check runs:

```bash
echo | ip netns exec client openssl s_client -connect 10.20.0.80:443 -servername wallet.lab.test 2>/dev/null \
  | openssl x509 -noout -subject -enddate
echo | ip netns exec client openssl s_client -connect 10.20.0.80:443 -servername wallet.lab.test 2>/dev/null \
  | openssl x509 -noout -checkend $((30*86400)); echo "exit=$?"
```

```text
subject=CN = wallet.lab.test
notAfter=Feb 14 09:26:13 2027 GMT
Certificate will not expire
exit=0
```

`notAfter` is 90 days after the day you made the certificate; the faked date, 16 March 2027, lies after it. With 30 days of warning the check still passes today. A real monitor runs this daily and alerts when the exit code turns to 1.

**4. Fix it: reissue and reload.** Sign the same request again with a longer life, then tell nginx to reload. `nginx -s reload` makes the running master read its configuration and certificate files again and replace its workers; open connections are not cut.

```bash
cd pki
openssl x509 -req -in wallet.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 200 -sha256 \
  -extfile wallet.ext -out wallet.crt
openssl x509 -in wallet.crt -noout -enddate
cd ..
ip netns exec wallet nginx -c $PWD/nginx-wallet.conf -s reload; echo "reload exit=$?"
ip netns exec client faketime '+120 days' curl -sS --cacert pki/ca.crt https://wallet.lab.test/alice; echo "exit=$?"
```

```text
Certificate request self-signature ok
subject=CN = wallet.lab.test
notAfter=Jun  4 09:26:19 2027 GMT
2026/11/16 09:26:19 [notice] 3203#3203: signal process started
reload exit=0
{"account": "alice", "balance": 100}
exit=0
```

The client, still 120 days in the future, now gets its balance. The private key and the request did not change: renewal is only a new signature with new dates. Run the `-checkend` line again with `$((250*86400))`: it prints `Certificate will expire` and `exit=1`, because 200 days is less than 250.

**5. Break the other two checks.** One command each, today's clock:

```bash
ip netns exec client curl -sS --cacert pki/ca.crt https://10.20.0.80/alice 2>&1 | head -1
ip netns exec client curl -sS https://wallet.lab.test/alice 2>&1 | head -1
ip netns exec client faketime '+400 days' curl -sS --cacert pki/ca.crt https://wallet.lab.test/alice 2>&1 | head -1
```

```text
curl: (60) SSL: no alternative certificate subject name matches target host name '10.20.0.80'
curl: (60) SSL certificate problem: unable to get local issuer certificate
curl: (60) SSL certificate problem: certificate has expired
```

The first fails the **name** check: the client dialled an IP address that is not in the SAN list. The second fails the **chain** check: without `--cacert` the client knows only the system trust store, which does not hold Lab Root CA. The third is a reminder that the root expires too: 400 days is past both the renewed certificate's 200 days and the root's own 365, and renewing the server certificate alone can never go past the root's date. All three share exit code 60, so always read the message.

| Message | Failed check | First command to run | Fix |
| --- | --- | --- | --- |
| `certificate has expired` | Dates (server or CA certificate) | `openssl s_client ... \| openssl x509 -noout -enddate`, and `date` on the client | Reissue and `nginx -s reload`; fix the client's clock if it is wrong |
| `no alternative certificate subject name matches` | Name | `openssl x509 -in wallet.crt -noout -ext subjectAltName` | Call the service by a name in the SAN, or reissue with that name added |
| `unable to get local issuer certificate` | Chain | `openssl s_client` without `-CAfile` shows `Verify return code: 21` | Give the client the CA file, or add the CA to its trust store |

1. Why does the server log a 400 with an empty request instead of a certificate error? Which side decided to close the connection?
2. The reissued certificate has the same key as the old one. Is that safe? When would you make a new key as well?
3. A teammate fixes the IP-address error by adding `--insecure` to the client. What does that switch off, and which of the three checks would still protect the connection?
4. Write the cron line (Ch 1.3) that runs the `-checkend` command every morning at 07:00 and writes a warning to a file when the exit code is 1.

## Clean up

Stop the three servers before you delete their namespaces, then remove the bridge and the per-namespace `resolv.conf`. Keep `~/cn-lab/vol2/`: Milestone 2 reuses `wallet/`, `pki/` and `nginx-wallet.conf`.

```bash
pkill -x nginx; pkill -x dnsmasq; pkill -f "wallet[.]py"
for n in client dns wallet; do ip netns del $n; done
ip link del br-lab
rm -rf /etc/netns /tmp/dns.pcap /tmp/tls.pcap /tmp/tls12.pcap
ip netns list | wc -l; ip -br link show br-lab
```

```text
0
Device "br-lab" does not exist.
```

The pattern `wallet[.]py` matches the text `wallet.py` in the wallet's command line, but not the pattern text itself, so `pkill` cannot hit a shell whose command line contains the pattern. If you used a throwaway container, `exit` removes everything.
