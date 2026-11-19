# Lab 4.1 · Containerising the Wallet

## Goal

You will open the wallet image by hand, fetch it from a registry with `curl`, rebuild it on three smaller bases and measure what you saved, then find a "deleted" secret inside an image.

**Versions tested** (2026-11-16, Docker Desktop 4.96.3 on WSL2, Ubuntu 26.04): Docker Engine 29.9.2 with the containerd image store, jq 1.8.1, `registry:2` (Distribution 2.8.3), `python:3.12-slim` (Python 3.12.16, Debian 13), `python:3.12-alpine`, `gcr.io/distroless/python3-debian13:nonroot` (Python 3.13), crane v0.22.1 (optional). **Not run:** the same steps on a Docker with the classic overlay2 image store, where `docker save` writes an older layout; check yours with `docker info -f '{{.DriverStatus}}'`, which should mention `io.containerd.snapshotter.v1`.

**Before you start:** you need the `wallet/` folder from Vol 3 in `~/cn-lab/wallet`, Docker running, and `jq` (`sudo apt install -y jq`). Vol 4 adds four files to `wallet/`: `Dockerfile.slim`, `Dockerfile.alpine`, `Dockerfile.distroless` and `.dockerignore`; the lab shows each one. Everything uses port 15000 or 18080 on `127.0.0.1` and removes itself at the end.

### What you will build

{{diagram lab-4-1-01.jsx | what you will see in Lab 4.1 · one panel per part}}
## Part A · Open an image

You will turn `wallet:v1` into files and read them in the order a runtime does: index, manifest, config, layers.

**Step 1: the view Docker gives you.**

```bash
cd ~/cn-lab/wallet
docker build -t wallet:v1 .
docker image ls wallet:v1
docker history wallet:v1 --format 'table {{.CreatedBy}}\t{{.Size}}'
```

```text
IMAGE       ID             DISK USAGE   CONTENT SIZE   EXTRA
wallet:v1   dea5424c6f51        209MB         51.6MB

CREATED BY                                      SIZE
CMD ["python3" "api.py"]                        0B
EXPOSE [8080/tcp]                               0B
USER 10001                                      0B
COPY app/ /app/ # buildkit                      24.6kB
WORKDIR /app                                    8.19kB
RUN /bin/sh -c useradd --uid 10001 --no-crea…   49.2kB
RUN /bin/sh -c pip install --no-cache-dir "p…   23.5MB
CMD ["python3"]                                 0B
RUN /bin/sh -c set -eux;  for src in idle3 p…   16.4kB
RUN /bin/sh -c set -eux;   savedAptMark="$(a…   41.4MB
ENV PYTHON_SHA256=b5796915dc45ff745cfb4e990a…   0B
ENV PYTHON_VERSION=3.12.16                      0B
ENV GPG_KEY=7169605F62C751356D054A26A821E680…   0B
RUN /bin/sh -c set -eux;  apt-get update;  a…   4.93MB
ENV LANG=C.UTF-8                                0B
ENV PATH=/usr/local/bin:/usr/local/sbin:/usr…   0B
# debian.sh --arch 'amd64' out/ 'trixie' '@1…   87.7MB
```

Rows of `0B` are metadata (`ENV`, `CMD`, `USER`) and create no layer; the eight rows with a size are the eight layers. Two numbers describe the same image: `CONTENT SIZE` (51.6 MB) is what the compressed blobs weigh, `DISK USAGE` (209 MB) adds the unpacked layers, about 158 MB when you add up the `docker history` column.

**Step 2: export it and open the archive.**

```bash
mkdir -p ~/cn-lab/img && cd ~/cn-lab/img
docker save wallet:v1 -o wallet-v1.tar
mkdir v1 && tar -xf wallet-v1.tar -C v1
cd v1
ls
cat oci-layout
```

```text
blobs  index.json  manifest.json  oci-layout
{"imageLayoutVersion":"1.0.0"}
```

`oci-layout`, `index.json` and `blobs/sha256/` are the three entries the [image layout spec](https://github.com/opencontainers/image-spec/blob/main/image-layout.md) requires. `manifest.json` is an extra file Docker adds for older tools. The archive is 51.6 MB: the compressed blobs plus these small files and the tar headers (51,643,904 bytes on the test machine, 28,415 more than the eight layers alone).

**Step 3: follow the chain by digest.** Your digests will differ from the ones below, because they depend on the build time; the sizes and the shape will match.

```bash
jq -c '.manifests[0] | {mediaType, digest, size}' index.json
IDX=$(jq -r '.manifests[0].digest' index.json | cut -d: -f2)
jq -c '.manifests[] | {digest, size, platform}' blobs/sha256/$IDX
```

```text
{"mediaType":"application/vnd.oci.image.index.v1+json","digest":"sha256:dea5424c6f5118fe2490a7f9fbe304e73227002982e12786b9565c24b15d4507","size":856}
{"digest":"sha256:9ca9f5f63c679aeeb93bb04c2acd07f7d2b0f8ab54c20a014597a31a203e01ed","size":1812,"platform":{"architecture":"amd64","os":"linux"}}
{"digest":"sha256:ab2be7ff5a59f952981bd07d7c2b12aa845390e9bb31df7a09da929b02b1dc47","size":837,"platform":{"architecture":"unknown","os":"unknown"}}
```

`index.json` points at an image index. The index lists the real amd64 manifest and a second, `unknown/unknown` entry: an attestation manifest that BuildKit attaches to describe how the image was built. Now the manifest and the config:

```bash
MAN=$(jq -r '.manifests[] | select(.platform.architecture=="amd64") | .digest' blobs/sha256/$IDX | cut -d: -f2)
jq -c '{config: .config.digest, layers: [.layers[].size]}' blobs/sha256/$MAN
CFG=$(jq -r .config.digest blobs/sha256/$MAN | cut -d: -f2)
jq -c '.config | {User, Cmd, WorkingDir}' blobs/sha256/$CFG
sha256sum blobs/sha256/$CFG
```

```text
{"config":"sha256:357249cb118d13eab4b96fb4117d89f3be57c1efdff0b177bcc6b9078233509b","layers":[29856132,1289792,12122550,248,8342359,1184,93,3131]}
{"User":"10001","Cmd":["python3","api.py"],"WorkingDir":"/app"}
357249cb118d13eab4b96fb4117d89f3be57c1efdff0b177bcc6b9078233509b  blobs/sha256/357249cb118d13eab4b96fb4117d89f3be57c1efdff0b177bcc6b9078233509b
```

The hash that `sha256sum` prints equals the file's name. That is content addressing: nobody can change the config without changing its name. Finally, open the last layer and measure all eight:

```bash
LAST=$(jq -r '.layers[-1].digest' blobs/sha256/$MAN | cut -d: -f2)
tar -tzvf blobs/sha256/$LAST
for d in $(jq -r '.layers[].digest' blobs/sha256/$MAN | cut -d: -f2); do
  printf '%s  compressed=%s  unpacked=%s\n' "${d:0:12}" "$(stat -c%s blobs/sha256/$d)" "$(gzip -dc blobs/sha256/$d | wc -c)"
done
```

```text
drwxr-xr-x 0/0               0 2026-11-16 14:10 app/
-rw-r--r-- 0/0            5695 2026-11-16 14:09 app/api.py
-rw-r--r-- 0/0            1190 2026-11-16 14:09 app/db.py
-rw-r--r-- 0/0            2175 2026-11-16 14:10 app/worker.py
37fb86c2a767  compressed=29856132  unpacked=81295360
68bced9e0afa  compressed=1289792  unpacked=4118528
2dc99d2d0a39  compressed=12122550  unpacked=38150656
05e0eee5572e  compressed=248  unpacked=5120
b6879fbc074a  compressed=8342359  unpacked=22011904
d1dd29c4f454  compressed=1184  unpacked=13824
579815d98c71  compressed=93  unpacked=1536
85cc2c4c8c76  compressed=3131  unpacked=13312
```

Answer in your notes: (1) Which layer is the largest and which Dockerfile instruction made it? (2) How big is the layer with the wallet's own code, compressed? (3) The compressed sizes add up to 51,615,489 bytes: where have you seen a number that rounds to it?

## Part B · Ask a registry with curl

You will start a registry, push the image to it and fetch the same files over HTTP, as `docker pull` would.

```bash
docker run -d --name lab41-registry -p 127.0.0.1:15000:5000 registry:2
docker tag wallet:v1 localhost:15000/wallet:v1
docker push localhost:15000/wallet:v1
curl -s localhost:15000/v2/_catalog
curl -s localhost:15000/v2/wallet/tags/list
```

```text
...
2dc99d2d0a39: Pushed
b6879fbc074a: Pushed
37fb86c2a767: Pushed
v1: digest: sha256:dea5424c6f5118fe2490a7f9fbe304e73227002982e12786b9565c24b15d4507 size: 856
{"repositories":["wallet"]}
{"name":"wallet","tags":["v1"]}
```

The digest `docker push` prints is the digest of the index. Ask the registry for the same index by tag, then hash what you get:

```bash
R=localhost:15000
IDXT=application/vnd.oci.image.index.v1+json
MANT=application/vnd.oci.image.manifest.v1+json
curl -s -D- -o /dev/null -H "Accept: $IDXT" $R/v2/wallet/manifests/v1 | grep -i -E '^(HTTP|content-type|docker-content-digest)'
curl -s -H "Accept: $IDXT" $R/v2/wallet/manifests/v1 | sha256sum
```

```text
HTTP/1.1 200 OK
Content-Type: application/vnd.oci.image.index.v1+json
Docker-Content-Digest: sha256:dea5424c6f5118fe2490a7f9fbe304e73227002982e12786b9565c24b15d4507
dea5424c6f5118fe2490a7f9fbe304e73227002982e12786b9565c24b15d4507  -
```

The registry's digest, the pushed digest and the hash of the bytes agree. Now walk down to a layer and download it:

```bash
M=$(curl -s -H "Accept: $IDXT" $R/v2/wallet/manifests/v1 | jq -r '.manifests[] | select(.platform.architecture=="amd64") | .digest')
L=$(curl -s -H "Accept: $MANT" $R/v2/wallet/manifests/$M | jq -r '.layers[-1].digest')
curl -s $R/v2/wallet/blobs/$L | sha256sum
curl -s $R/v2/wallet/blobs/$L | tar -tz
```

```text
85cc2c4c8c76e1e474cd982a8f8820c0dccbacd5a59e7fed6132b64a8a915511  -
app/
app/api.py
app/db.py
app/worker.py
```

The layer you fetched hashes to its own name, and it is the wallet's code. Last, push the Alpine build you will make in Part C and watch what the registry does not store twice. If you have not built it yet, come back to this step after Part C:

```bash
docker tag wallet:alpine localhost:15000/wallet:alpine
docker push localhost:15000/wallet:alpine 2>&1 | tail -7
```

```text
1a977db379d2: Pushed
85cc2c4c8c76: Layer already exists
113b91713f05: Pushed
ab4bf5b31a50: Pushed
alpine: digest: sha256:edd3bc3cab7609a76e0d4ee50eb8146a360654436c8f041e60ddfe3cba492ffd size: 856
```

The wallet's code layer has the same digest in both images, so the registry already had it. *Optional:* `crane` is one Go binary that speaks this API for you (`go install github.com/google/go-containerregistry/cmd/crane@latest`, v0.22.1 tested):

```bash
crane ls --insecure localhost:15000/wallet
crane manifest --insecure localhost:15000/wallet:alpine --platform linux/amd64 | jq -c '[.layers[].size]'
```

```text
v1
alpine
[3853673,411985,13779381,248,7380868,897,93,3131]
```

## Part C · Shrink the wallet

You will build the wallet on three more bases, measure every image and prove that each one still works.

**Step 1: send less to the builder.** Create `.dockerignore` in `wallet/`. The first line excludes everything, the second takes `app/` back; Docker always sends the Dockerfile itself.

```bash
cd ~/cn-lab/wallet
cat > .dockerignore <<'EOF'
# Send only what the Dockerfiles COPY.
*
!app/
**/__pycache__
EOF
```

**Step 2: write three Dockerfiles.** Save each one next to `Dockerfile`.

```dockerfile
# Dockerfile.slim: multi-stage build on the slim base
FROM python:3.12-slim AS build
RUN pip install --no-cache-dir --target /deps "psycopg[binary]==3.2.3"

FROM python:3.12-slim
COPY --from=build /deps /usr/local/lib/python3.12/site-packages
RUN useradd --uid 10001 --no-create-home wallet
WORKDIR /app
COPY app/ /app/
USER 10001
EXPOSE 8080
CMD ["python3", "api.py"]
```

```dockerfile
# Dockerfile.alpine: the same app on Alpine (musl libc)
FROM python:3.12-alpine
RUN pip install --no-cache-dir "psycopg[binary]==3.2.3"
RUN adduser -D -H -u 10001 wallet
WORKDIR /app
COPY app/ /app/
USER 10001
EXPOSE 8080
CMD ["python3", "api.py"]
```

```dockerfile
# Dockerfile.distroless: no shell, no package manager. Build and runtime
# stages use the same Debian release and Python minor version (3.13).
FROM python:3.13-slim-trixie AS build
RUN pip install --no-cache-dir --target /deps "psycopg[binary]==3.2.3"

FROM gcr.io/distroless/python3-debian13:nonroot
COPY --from=build /deps /deps
ENV PYTHONPATH=/deps
WORKDIR /app
COPY app/ /app/
EXPOSE 8080
CMD ["api.py"]
```

The distroless image already runs Python as its entry point, so its `CMD` is only the script name, and it runs as the non-root user 65532 without a `useradd`. Build all three:

```bash
docker build -f Dockerfile.slim -t wallet:slim .
docker build -f Dockerfile.alpine -t wallet:alpine .
docker build -f Dockerfile.distroless -t wallet:distroless .
docker image ls wallet
```

```text
IMAGE               ID             DISK USAGE   CONTENT SIZE   EXTRA
wallet:alpine       edd3bc3cab76        102MB         25.4MB
wallet:distroless   e7d4059dd353        109MB         27.4MB
wallet:slim         48b7d1ea2c91        196MB         48.2MB
wallet:v1           dea5424c6f51        209MB         51.6MB   U
```

(Your image IDs will differ.) **Step 3: measure with the numbers a registry cares about.** `wallet/measure_image.sh` runs `docker save` and adds the layer sizes the way you did by hand in Part A: compressed bytes are what a node downloads, unpacked bytes are what lands on its disk.

```bash
for t in v1 slim alpine distroless; do ./measure_image.sh wallet:$t; done
```

```text
wallet:v1            layers=8   compressed=51615489  unpacked=145610240
wallet:slim          layers=8   compressed=48229704  unpacked=137082880
wallet:alpine        layers=8   compressed=25430276  unpacked=70476800
wallet:distroless    layers=51  compressed=27422225  unpacked=75456512
```

{{diagram lab-4-1-02.jsx | measured 2026-11-16 with wallet/measure_image.sh · Docker 29.9.2 · 4 images, 2 measures}}
- **Multi-stage on slim saves little: 3.4 MB compressed.** The slim base has no compiler to leave behind. The saving comes from side effects of running `pip`: it writes bytecode caches for the standard library into its layer. Check it: the `pip install` layer of `wallet:v1` holds 548 `.pyc` files, the `/deps` layer of `wallet:slim` holds 81 (`tar -tzf <layer> | grep -c '\.pyc$'`).
- **Alpine halves the image.** Its root filesystem and Python layers weigh 3.9 MB and 0.4 MB compressed, against 29.9 MB and 1.3 MB for Debian's.
- **Distroless lands next to Alpine,** 27.4 MB, in 51 small layers, with no shell at all.

**Step 4: prove each image still works.** Start Postgres, the API and the worker from the new image, then run the wallet's own end-to-end test. The `try_image` function runs one image and cleans up:

```bash
docker network create lab41-net
docker run -d --name lab41-db --network lab41-net -e POSTGRES_USER=wallet -e POSTGRES_PASSWORD=wallet -e POSTGRES_DB=wallet postgres:17
DB=postgresql://wallet:wallet@lab41-db:5432/wallet
try_image() {   # usage: try_image <tag> <worker command...>
  img=$1; shift
  docker run -d --name lab41-api --network lab41-net -e DATABASE_URL=$DB -p 127.0.0.1:18080:8080 wallet:$img
  docker run -d --name lab41-worker --network lab41-net -e DATABASE_URL=$DB wallet:$img "$@"
  sleep 3; echo "== wallet:$img"; ./test_e2e.sh http://127.0.0.1:18080 | tail -2
  docker rm -f lab41-api lab41-worker >/dev/null
  docker exec lab41-db psql -U wallet -qc 'TRUNCATE transfers, accounts CASCADE'
}
try_image alpine python3 worker.py
try_image distroless worker.py
```

```text
== wallet:alpine
transfer=settled big=rejected alice=70 bob=80
PASS
== wallet:distroless
transfer=settled big=rejected alice=70 bob=80
PASS
```

Both pass, so a smaller image changed nothing the wallet can observe. What did it cost? Try to open a shell in the distroless image:

```bash
docker run --rm --entrypoint sh wallet:distroless -c 'echo hi'
```

```text
docker: Error response from daemon: failed to create task for container: ... runc create failed: unable to start container process: error during container init: exec: "sh": executable file not found in $PATH
```

The error comes from `runc`, the program you will run by hand in Lab 4.2. Remove the test containers: `docker rm -f lab41-db && docker network rm lab41-net`.

## Part D · Why the order of steps matters

You will make one edit to the wallet's code and time two Dockerfiles that differ only in step order.

```bash
cd ~/cn-lab
rm -rf wallet-cache && cp -r wallet wallet-cache && cd wallet-cache
cat > Dockerfile.bad <<'EOF'
FROM python:3.12-slim
WORKDIR /app
COPY app/ /app/
RUN pip install --no-cache-dir "psycopg[binary]==3.2.3"
RUN useradd --uid 10001 --no-create-home wallet
USER 10001
CMD ["python3", "api.py"]
EOF
docker build -q -t wallet:cache-good . && docker build -q -f Dockerfile.bad -t wallet:cache-bad .
echo "# edit $(date +%s%N)" >> app/api.py
time (docker build --progress=plain -t wallet:cache-good . 2>&1 | grep -E 'RUN|COPY|CACHED')
time (docker build --progress=plain -f Dockerfile.bad -t wallet:cache-bad . 2>&1 | grep -E 'RUN|COPY|CACHED')
```

The first `docker build` of each Dockerfile fills the cache. The edit changes one file, then each Dockerfile is rebuilt:

```text
#6 [2/5] RUN pip install --no-cache-dir "psycopg[binary]==3.2.3"
#6 CACHED
#7 [3/5] RUN useradd --uid 10001 --no-create-home wallet
#7 CACHED
#8 CACHED
#9 [5/5] COPY app/ /app/

real    0m3.591s

#6 CACHED
#7 [3/5] COPY app/ /app/
#8 [4/5] RUN pip install --no-cache-dir "psycopg[binary]==3.2.3"
#9 [5/5] RUN useradd --uid 10001 --no-create-home wallet

real    0m12.216s
```

When the code is copied last, only `COPY` runs. When it is copied first, `COPY` and every step after it run again, including the slow `pip install`. Your times will differ, and `pip` needs the network; the ratio is the point. Clean up with `docker rmi wallet:cache-good wallet:cache-bad`.

## Checkpoint

You are done when each row gives the expected result. Part A rows run in `~/cn-lab/img/v1`, Part B rows need the registry from Part B.

| Check | Command | Expected |
| --- | --- | --- |
| The image has 8 layers | `jq '.layers \| length' blobs/sha256/$MAN` | `8` |
| A blob's name is its hash | `sha256sum blobs/sha256/$CFG` | the printed hash equals the file name |
| The registry serves the bytes you pushed | `curl -s -H "Accept: $IDXT" $R/v2/wallet/manifests/v1 \| sha256sum` | the same 64 characters that `docker push` printed after `digest: sha256:` |
| Images share a layer | `docker push localhost:15000/wallet:alpine 2>&1 \| grep exists` | one line ending `Layer already exists` |
| Sizes | `./measure_image.sh wallet:alpine` | compressed under 30,000,000 and unpacked under 80,000,000; `wallet:slim` within 10% of `wallet:v1` |
| Both new images work | `try_image alpine python3 worker.py` | `PASS` (and `PASS` for distroless) |
| Order controls the cache | the two timed builds of Part D | `pip install` shows `CACHED` in the good order and runs again in the bad one |
| Secrets stay in layers | the `for` loop of Break it | prints the password for `leak:bad`, prints nothing for `leak:fixed` |

Clean up: `docker rm -f lab41-registry`, then `docker rmi localhost:15000/wallet:v1 localhost:15000/wallet:alpine`. Keep `wallet:v1` and `wallet:alpine`; Labs 4.2 and 4.3 use them.

## Break it: a deleted secret

Teams often copy a `.env` file into an image, use it during the build, and delete it in the next step. You will show that the deletion hides the file but does not remove it.

```bash
mkdir -p ~/cn-lab/leak && cd ~/cn-lab/leak
echo "DB_PASSWORD=hunter2-not-a-real-secret" > .env
cat > Dockerfile <<'EOF'
FROM alpine:3.22
COPY .env /app/.env
RUN . /app/.env && echo "configured" && rm /app/.env
CMD ["ls", "-a", "/app"]
EOF
docker build -q -t leak:bad .
docker run --rm leak:bad
docker save leak:bad -o bad.tar && mkdir bad && tar -xf bad.tar -C bad
for f in bad/blobs/sha256/*; do
  tar -tzf $f 2>/dev/null | grep -q 'app/.env$' && { echo "found in ${f##*/}" | cut -c1-30; tar -xzOf $f app/.env; }
done
```

```text
sha256:efc38472e362f75dadf285ed90c54d7afde7ed52e3c5b0355cc2aef1c6dc2964
.
..
found in a4e3e34fef4894069ca8a
DB_PASSWORD=hunter2-not-a-real-secret
```

The running container shows an empty `/app`, yet anyone who can pull the image can read the password from the second layer. Now build it the right way, with a BuildKit secret mount that exists only while one step runs:

```bash
cat > Dockerfile.fixed <<'EOF'
FROM alpine:3.22
RUN --mount=type=secret,id=dbpw . /run/secrets/dbpw && echo "configured with a ${#DB_PASSWORD}-character password"
CMD ["ls", "-a", "/app"]
EOF
docker build --progress=plain --secret id=dbpw,src=.env -f Dockerfile.fixed -t leak:fixed . 2>&1 | grep configured
docker save leak:fixed -o fixed.tar && mkdir fixed && tar -xf fixed.tar -C fixed
for f in fixed/blobs/sha256/*; do tar -xzOf $f 2>/dev/null | grep -a hunter2; done; echo "matches: $(grep -rl hunter2 fixed | wc -l)"
```

```text
#5 0.399 configured with a 25-character password
matches: 0
```

Answer in your notes: (1) Why does `docker run` show no `.env` although the layer holds it? (2) What can someone do who has only `docker pull` access to this image? (3) The password was already pushed to a shared registry. What do you do first, and why is rebuilding the image not enough? Remove the test images with `docker rmi leak:bad leak:fixed`.
