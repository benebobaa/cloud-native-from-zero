#!/usr/bin/env bash
# Print compressed (pull) and unpacked size of a local image. Usage: ./measure_image.sh wallet:v1
# Needs docker, jq, tar, gzip. Reads the OCI layout written by `docker save` (Docker 29, containerd image store).
set -euo pipefail
d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
docker save "$1" | tar -x -C "$d"
b=$d/blobs/sha256
top=$(jq -r '.manifests[0].digest' "$d/index.json" | cut -d: -f2)
man=$(jq -r 'if .manifests then (.manifests[] | select(.platform.architecture != "unknown") | .digest) else empty end' "$b/$top" | head -1 | cut -d: -f2)
man=${man:-$top}
gz=0; raw=0; n=0
for l in $(jq -r '.layers[].digest' "$b/$man" | cut -d: -f2); do
  gz=$((gz + $(stat -c%s "$b/$l"))); raw=$((raw + $(gzip -dc "$b/$l" | wc -c))); n=$((n + 1))
done
printf '%-20s layers=%-3s compressed=%-9s unpacked=%s\n' "$1" "$n" "$gz" "$raw"
