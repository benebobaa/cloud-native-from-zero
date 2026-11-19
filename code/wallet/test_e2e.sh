#!/usr/bin/env bash
# End-to-end self-check for wallet v1. Usage: ./test_e2e.sh [base-url]
set -euo pipefail
URL=${1:-http://localhost:8080}
j() { curl -fsS -H 'Content-Type: application/json' "$@"; }

j "$URL/readyz" >/dev/null
j -X POST "$URL/accounts" -d '{"name":"alice","balance":100}' >/dev/null
j -X POST "$URL/accounts" -d '{"name":"bob","balance":50}' >/dev/null
T="t-$RANDOM-$$"
j -X POST "$URL/transfers" -d "{\"id\":\"$T\",\"from\":\"alice\",\"to\":\"bob\",\"amount\":30}" >/dev/null
j -X POST "$URL/transfers" -d "{\"id\":\"$T\",\"from\":\"alice\",\"to\":\"bob\",\"amount\":30}" >/dev/null  # duplicate: must not apply twice
j -X POST "$URL/transfers" -d "{\"id\":\"$T-big\",\"from\":\"bob\",\"to\":\"alice\",\"amount\":100000}" >/dev/null  # must be rejected

for _ in $(seq 20); do
  s1=$(j "$URL/transfers/$T" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
  s2=$(j "$URL/transfers/$T-big" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
  [ "$s1" != pending ] && [ "$s2" != pending ] && break
  sleep 0.5
done
a=$(j "$URL/accounts/alice" | python3 -c 'import json,sys; print(json.load(sys.stdin)["balance"])')
b=$(j "$URL/accounts/bob"   | python3 -c 'import json,sys; print(json.load(sys.stdin)["balance"])')
echo "transfer=$s1 big=$s2 alice=$a bob=$b"
[ "$s1" = settled ] && [ "$s2" = rejected ] && [ $((a + b)) -eq 150 ] && echo "PASS" || { echo "FAIL"; exit 1; }
