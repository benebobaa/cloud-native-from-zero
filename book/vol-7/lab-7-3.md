# Lab 7.3 · A Tiny Operator and KEDA

## Goal

Extend Kubernetes twice. First you add a new kind, `WalletAccount`, and write a small operator that turns each object of that kind into a real account in the wallet. Then you install KEDA and let the size of the transfer backlog decide how many workers run.

{{diagram lab-7-3-01.jsx | what you will build · Lab 7.3}}

Both loops have the same shape as every Kubernetes controller: observe, compare, act.

**Versions tested.** Kubernetes 1.37.0 on kind v0.33.0, kubectl 1.37.1, Helm v4.3.1, KEDA chart and app 2.21.0 (`kedacore/keda`), Kubernetes Python client 37.0.2 (Python 3.14 on the laptop, Python 3.12 in the image), Postgres 17. Test machine: Ubuntu 26.04 on WSL2 with Docker Desktop; the operator image was loaded with `docker save` and `kind load image-archive`. Not run: Crossplane and Backstage (their cards come from the project documentation), a finalizer (the lab operator sets none), Ubuntu 24.04 itself.

**Python note for Ubuntu 24.04.** `pip install` into the system Python is refused there. Make a virtual environment first: `sudo apt install -y python3-venv`, then `python3 -m venv ~/opvenv && ~/opvenv/bin/pip install kubernetes==37.0.2`. On the test machine the library was installed with `pip install --target` instead, which gives the same result.

## Setup

You need the wallet running in namespace `wallet` from the dev overlay of Lab 7.1, in a fresh cluster. The operator talks to the wallet's own API, so open a tunnel to it and keep it open for the whole lab.

```bash
export KUBECONFIG=$PWD/kubeconfig
kind create cluster --name cnlab --image kindest/node:v1.37.0
docker save wallet:v1 -o wallet-v1.tar && kind load image-archive wallet-v1.tar --name cnlab
kubectl create namespace wallet
kubectl apply -k ~/wallet-gitops/kustomize/overlays/dev -n wallet
kubectl -n wallet rollout status deployment/wallet-api
kubectl -n wallet port-forward svc/wallet-api 8080:80 &
```

## Part A · A new kind: the CRD

A CustomResourceDefinition teaches the API server a new kind and gives it a schema. Save this as `walletaccount-crd.yaml`. Compare it with the table in the theory: group, names, one version with a status subresource, printer columns, and a schema that requires `owner` and bounds `openingBalance`.

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: walletaccounts.cnlab.example.com
spec:
  group: cnlab.example.com
  scope: Namespaced
  names: {kind: WalletAccount, plural: walletaccounts, singular: walletaccount, shortNames: [wa]}
  versions:
  - name: v1
    served: true
    storage: true
    subresources: {status: {}}
    additionalPrinterColumns:
    - {name: Owner, type: string, jsonPath: .spec.owner}
    - {name: Balance, type: integer, jsonPath: .status.balance}
    - {name: Ready, type: string, jsonPath: .status.phase}
    schema:
      openAPIV3Schema:
        type: object
        properties:
          spec:
            type: object
            required: [owner]
            properties:
              owner: {type: string, minLength: 1}
              openingBalance: {type: integer, minimum: 0, default: 0}
          status:
            type: object
            properties:
              phase: {type: string}
              balance: {type: integer}
```

```bash
kubectl apply -f walletaccount-crd.yaml
kubectl get crd walletaccounts.cnlab.example.com
kubectl explain walletaccount.spec
```

```text
NAME                               SCOPE        VERSIONS      CREATED AT
walletaccounts.cnlab.example.com   Namespaced   v1(storage)   2026-11-17T04:25:10Z

GROUP:      cnlab.example.com
KIND:       WalletAccount
VERSION:    v1

FIELD: spec <Object>
FIELDS:
  openingBalance	<integer>
  owner	<string> -required-
```

Create the object from the theory, and then break the schema two ways. No controller exists yet, so nothing acts on `carol`.

```bash
cat > carol.yaml <<'EOF'
apiVersion: cnlab.example.com/v1
kind: WalletAccount
metadata: {name: carol}
spec: {owner: carol, openingBalance: 250}
EOF
kubectl -n wallet apply -f carol.yaml
kubectl -n wallet get walletaccounts
kubectl -n wallet apply -f - <<'EOF'
apiVersion: cnlab.example.com/v1
kind: WalletAccount
metadata: {name: bad1}
spec: {owner: bad1, openingBalance: -5}
EOF
kubectl -n wallet apply -f - <<'EOF'
apiVersion: cnlab.example.com/v1
kind: WalletAccount
metadata: {name: typo}
spec: {owner: typo, openingBalanc: 100}
EOF
kubectl -n wallet apply --validate=false -f - <<'EOF'
apiVersion: cnlab.example.com/v1
kind: WalletAccount
metadata: {name: typo}
spec: {owner: typo, openingBalanc: 100}
EOF
kubectl -n wallet get walletaccount typo -o jsonpath='{.spec}'; echo
kubectl -n wallet delete walletaccount typo
```

```text
walletaccount.cnlab.example.com/carol created
NAME    OWNER   BALANCE   READY
carol   carol
The WalletAccount "bad1" is invalid: spec.openingBalance: Invalid value: -5: spec.openingBalance in body should be greater than or equal to 0
Error from server (BadRequest): ... strict decoding error: unknown field "spec.openingBalanc"
walletaccount.cnlab.example.com/typo created
{"openingBalance":0,"owner":"typo"}
```

Read the last two results together. With default validation, kubectl 1.37 refuses the misspelled field. With `--validate=false` the object is accepted, the unknown field is pruned, and the default `0` is filled in: the misspelling vanished without an error. That is the behaviour a script or a controller sees when it posts raw JSON, which is why a schema is worth less than a test that reads the object back.

## Part B · The operator, on your laptop first

An operator is a program that watches your kind and makes the world match. Save this as `walletaccount_operator.py`. Do not call it `operator.py`: a file with that name hides Python's own `operator` module and the program dies on `import json`. That happened on the first try on the test machine.

```python
#!/usr/bin/env python3
"""walletaccount-operator: makes every WalletAccount object exist as a row in the wallet.

Loop: list all objects (the resync), reconcile each, then watch for changes for RESYNC seconds.
Reconcile is idempotent: it only creates the account when the API says it does not exist.
"""
import json
import os
import urllib.error
import urllib.request

from kubernetes import client, config, watch

GROUP, VERSION, PLURAL = "cnlab.example.com", "v1", "walletaccounts"
WALLET_API = os.environ.get("WALLET_API", "http://localhost:8080")
NAMESPACE = os.environ.get("NAMESPACE", "wallet")
RESYNC = int(os.environ.get("RESYNC_SECONDS", "30"))


def wallet(method, path, body=None):
    req = urllib.request.Request(WALLET_API + path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {}


def reconcile(api, obj):
    name, spec = obj["metadata"]["name"], obj["spec"]
    try:
        code, acct = wallet("GET", f"/accounts/{spec['owner']}")
        if code == 404:                                   # desired: exists. actual: missing. act.
            wallet("POST", "/accounts", {"name": spec["owner"], "balance": spec.get("openingBalance", 0)})
            print(f"created account {spec['owner']} for WalletAccount/{name}", flush=True)
            code, acct = wallet("GET", f"/accounts/{spec['owner']}")
        status = {"phase": "Ready", "balance": acct["balance"]} if code == 200 else {"phase": "Error"}
    except (urllib.error.URLError, OSError) as e:
        status = {"phase": "Error"}
        print(f"wallet API unreachable for WalletAccount/{name}: {e}", flush=True)
    if obj.get("status") != status:                        # write only when something changed
        api.patch_namespaced_custom_object_status(GROUP, VERSION, NAMESPACE, PLURAL, name, {"status": status})
        print(f"WalletAccount/{name} status -> {status}", flush=True)


def main():
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()                          # on your laptop: your kubeconfig
    api = client.CustomObjectsApi()
    print(f"operator up: wallet API {WALLET_API}, namespace {NAMESPACE}", flush=True)
    while True:
        for obj in api.list_namespaced_custom_object(GROUP, VERSION, NAMESPACE, PLURAL)["items"]:
            reconcile(api, obj)
        for event in watch.Watch().stream(api.list_namespaced_custom_object, GROUP, VERSION, NAMESPACE,
                                          PLURAL, timeout_seconds=RESYNC):
            if event["type"] in ("ADDED", "MODIFIED"):
                reconcile(api, event["object"])


if __name__ == "__main__":
    main()
```

Read it against the loop in the theory: `reconcile` compares desired (the object) with actual (the wallet API), acts only when they differ, and writes `status` only when it changed. Run it, and read the object from two sides:

```bash
~/opvenv/bin/python walletaccount_operator.py &
kubectl -n wallet get walletaccounts
curl -s localhost:8080/accounts/carol
kubectl -n wallet patch walletaccount carol --type merge -p '{"spec":{"openingBalance":999}}'
kubectl -n wallet get walletaccounts
kubectl -n wallet delete walletaccount carol
curl -s localhost:8080/accounts/carol
```

```text
operator up: wallet API http://localhost:8080, namespace wallet
created account carol for WalletAccount/carol
WalletAccount/carol status -> {'phase': 'Ready', 'balance': 250}
NAME    OWNER   BALANCE   READY
carol   carol   250       Ready
{"name": "carol", "balance": 250}
...                                  (after the patch)
carol   carol   250       Ready      <- still 250: the wallet has no "set balance" call
walletaccount.cnlab.example.com "carol" deleted from wallet namespace
{"name": "carol", "balance": 250}      <- the account outlives the object
```

Two behaviours to explain in your notes. The patched `openingBalance` changed nothing, because the operator only creates; and deleting the object left the account behind, because no finalizer or delete call exists. Both are design decisions, not bugs: the theory's section on finalizers says what a stricter operator would add.

## Part C · The operator in the cluster

A program on your laptop stops when you close the lid. Package it as an image and run it as a Deployment, with a ServiceAccount that may do exactly what it needs and nothing more.

```dockerfile
# Dockerfile
FROM python:3.12-slim
RUN pip install --no-cache-dir kubernetes==37.0.2
RUN useradd --uid 10001 --no-create-home walletop
COPY walletaccount_operator.py /app/walletaccount_operator.py
USER 10001
CMD ["python3", "/app/walletaccount_operator.py"]
```

```yaml
# operator-deploy.yaml
apiVersion: v1
kind: ServiceAccount
metadata: {name: walletaccount-operator, namespace: wallet}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: {name: walletaccount-operator, namespace: wallet}
rules:
- apiGroups: [cnlab.example.com]
  resources: [walletaccounts]
  verbs: [get, list, watch]
- apiGroups: [cnlab.example.com]
  resources: [walletaccounts/status]
  verbs: [patch]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: {name: walletaccount-operator, namespace: wallet}
roleRef: {apiGroup: rbac.authorization.k8s.io, kind: Role, name: walletaccount-operator}
subjects: [{kind: ServiceAccount, name: walletaccount-operator, namespace: wallet}]
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: walletaccount-operator, namespace: wallet}
spec:
  replicas: 1
  selector: {matchLabels: {app: walletaccount-operator}}
  template:
    metadata: {labels: {app: walletaccount-operator}}
    spec:
      serviceAccountName: walletaccount-operator
      containers:
      - name: operator
        image: wallet-operator:v1
        imagePullPolicy: IfNotPresent
        env: [{name: WALLET_API, value: "http://wallet-api"}]
        resources: {requests: {cpu: 10m, memory: 48Mi}, limits: {memory: 128Mi}}
```

```bash
kill %2      # stop the laptop operator (the second background job; check with jobs)
docker build -t wallet-operator:v1 .
docker save wallet-operator:v1 -o wallet-operator-v1.tar && kind load image-archive wallet-operator-v1.tar --name cnlab
kubectl apply -f operator-deploy.yaml
kubectl -n wallet rollout status deployment/walletaccount-operator
cat <<'EOF' | kubectl -n wallet apply -f -
apiVersion: cnlab.example.com/v1
kind: WalletAccount
metadata: {name: dave}
spec: {owner: dave, openingBalance: 40}
EOF
kubectl -n wallet get walletaccounts
kubectl -n wallet logs deploy/walletaccount-operator
kubectl auth can-i patch walletaccounts --subresource=status --as system:serviceaccount:wallet:walletaccount-operator -n wallet
kubectl auth can-i delete walletaccounts --as system:serviceaccount:wallet:walletaccount-operator -n wallet
```

```text
NAME   OWNER   BALANCE   READY
dave   dave    40        Ready
operator up: wallet API http://wallet-api, namespace wallet
created account dave for WalletAccount/dave
WalletAccount/dave status -> {'phase': 'Ready', 'balance': 40}
yes         <- may patch status
no          <- may not delete
```

The `--subresource=status` flag matters. `kubectl auth can-i patch walletaccounts/status` treats `status` as an object name and answers `no` even when the permission exists. That cost a wrong answer on the first try on the test machine.

## Part D · KEDA: the backlog decides how many workers run

The wallet worker settles transfers. One worker is enough for a trickle and too slow for a flood. KEDA turns "how many rows are pending in Postgres" into a metric the Horizontal Pod Autoscaler understands. Install KEDA with the chart version from the theory:

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm install keda kedacore/keda --version 2.21.0 -n keda --create-namespace
kubectl -n keda wait --for=condition=available deployment --all --timeout=240s
kubectl -n keda get pods
```

```text
keda-admission-webhooks-6c974699d8-2q6xv           1/1   Running
keda-operator-577d8b5b4b-bjwqk                     1/1   Running
keda-operator-metrics-apiserver-6d56b644bb-fb6mt   1/1   Running
```

Save this as `scaledobject.yaml`. The `TriggerAuthentication` hands KEDA the database password from the same Secret the wallet Pods use, so no password appears in this file. The Secret's name is the one Kustomize generated, with its hash suffix, so the file contains a variable that you fill in with `envsubst`.

```yaml
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata: {name: wallet-db-auth, namespace: wallet}
spec:
  secretTargetRef:
  - {parameter: password, name: "${WALLET_SECRET}", key: POSTGRES_PASSWORD}   # the Secret the Pods use; no password in this file
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: {name: wallet-worker, namespace: wallet}
spec:
  scaleTargetRef: {name: wallet-worker}
  minReplicaCount: 1
  maxReplicaCount: 5
  pollingInterval: 5
  cooldownPeriod: 30
  triggers:
  - type: postgresql
    authenticationRef: {name: wallet-db-auth}
    metadata:
      host: wallet-postgres.wallet.svc.cluster.local
      port: "5432"
      userName: wallet
      dbName: wallet
      sslmode: disable
      query: "SELECT count(*) FROM transfers WHERE status = 'pending'"
      targetQueryValue: "2000"
```

```bash
export WALLET_SECRET=$(kubectl -n wallet get secret -l purpose=lab-only -o jsonpath='{.items[0].metadata.name}')
echo $WALLET_SECRET
envsubst < scaledobject.yaml | kubectl apply -f -
kubectl -n wallet get scaledobject,hpa
```

```text
wallet-db-dg6b9c9668
...
NAME                                 ... MIN   MAX   READY   ACTIVE   ... TRIGGERS     AUTHENTICATIONS
scaledobject.keda.sh/wallet-worker   ... 1     5     True    False    ... postgresql   wallet-db-auth

NAME                                                         REFERENCE                  TARGETS      MINPODS   MAXPODS   REPLICAS
horizontalpodautoscaler.autoscaling/keda-hpa-wallet-worker   Deployment/wallet-worker   0/2k (avg)   1         5         1
```

KEDA created the HPA `keda-hpa-wallet-worker` for you. It reads `0/2k (avg)`: no backlog, a target of 2,000 per Pod. `ACTIVE False` means the trigger sees no work, which is normal at the minimum of 1 replica. KEDA also prints two warnings when you apply the file, that `pollingInterval` and `cooldownPeriod` are "not relevant": because `minReplicaCount` is 1, the HPA (not KEDA) drives scaling, and `cooldownPeriod` only matters when scaling to zero. The theory said so, and now the tool agrees.

**A trap seen on the first try.** The first version of the file used the name `wallet-db` for the Secret. KEDA then reported `error establishing postgreSQL connection ... password authentication failed for user "wallet"`, because Kustomize had renamed the Secret to `wallet-db-<hash>`. A name generated by a tool is a name you must look up, not guess.

Now create a flood. Insert 30,000 pending transfers in one statement, and watch in a second terminal:

```bash
kubectl -n wallet get scaledobject,hpa,deploy -w            # terminal 2
kubectl -n wallet exec wallet-postgres-0 -- psql -U wallet -d wallet -qc \
  "INSERT INTO transfers(id,src,dst,amount) SELECT 'bulk-'||g,'alice','bob',1 FROM generate_series(1,30000) g"
```

{{diagram lab-7-3-02.jsx | kubectl and psql samples every ~5 s · Lab 7.3 run on kind 1.37, 2026-11-17 · data: data/vol7-keda-backlog-2026-11-17.csv}}

Read the chart in three steps. **Scale out is fast but not instant.** The formula asks for 5 Pods as soon as the backlog exceeds 8,000 (the dashed line), yet the HPA took two steps: 1 to 4 Pods by second 14, and 5 at second 27. I did not determine why the first step stopped at 4. **Draining was quick.** Five workers cleared about 30,000 rows in roughly a minute, around 450 rows per second. **Scale in is slow.** The backlog was empty at second 66, and the first Pod left at second 339, 273 seconds later; the last extra Pods were gone by second 356. KEDA's `cooldownPeriod: 30` did not shorten that, as its warning said. The HPA applies its own scale-down stabilization window, 300 seconds by default (it uses the highest recommendation of that window), which is described in the [HPA documentation](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/). If you need faster scale-in, set `advanced.horizontalPodAutoscalerConfig.behavior.scaleDown.stabilizationWindowSeconds` in the ScaledObject.

## Checkpoint

| # | Command | Expected |
| --- | --- | --- |
| 1 | `kubectl get crd walletaccounts.cnlab.example.com` | the CRD exists, scope `Namespaced`, version `v1` |
| 2 | `kubectl -n wallet apply -f` an object with `openingBalance: -5` | `Invalid value: -5 ... should be greater than or equal to 0` |
| 3 | `kubectl -n wallet get walletaccounts` while the operator runs | `carol`/`dave` with `READY Ready` and the balance filled in |
| 4 | delete the `WalletAccount`, then `curl -s localhost:8080/accounts/<owner>` | the account is still there (no finalizer, by design) |
| 5 | `kubectl auth can-i patch walletaccounts --subresource=status --as system:serviceaccount:wallet:walletaccount-operator -n wallet` | `yes` |
| 6 | `kubectl -n wallet get scaledobject,hpa` | `READY True`, HPA `keda-hpa-wallet-worker` with `0/2k (avg)` when idle |
| 7 | the 30,000-row insert and `kubectl -n wallet get deploy wallet-worker -w` | replicas rise to 5 within about 30 s; the backlog reaches 0 within about 70 s |

## Break it

Take away one permission and watch an operator fail in a way the object itself does not show. Remove the `walletaccounts/status` rule from the Role, then create an account:

```bash
kubectl -n wallet patch role walletaccount-operator --type json -p '[{"op":"remove","path":"/rules/1"}]'
cat <<'EOF' | kubectl -n wallet apply -f -
apiVersion: cnlab.example.com/v1
kind: WalletAccount
metadata: {name: erin}
spec: {owner: erin, openingBalance: 10}
EOF
kubectl -n wallet get walletaccounts
kubectl -n wallet logs deploy/walletaccount-operator | tail -3
curl -s localhost:8080/accounts/erin
kubectl auth can-i patch walletaccounts --subresource=status --as system:serviceaccount:wallet:walletaccount-operator -n wallet
```

```text
NAME   OWNER   BALANCE   READY
dave   dave    40        Ready
erin   erin                       <- no Ready, no balance
... "walletaccounts.cnlab.example.com \"erin\" is forbidden: User \"system:serviceaccount:wallet:walletaccount-operator\" cannot patch resource \"walletaccounts/status\" in API group \"cnlab.example.com\" in the namespace \"wallet\""
{"name": "erin", "balance": 10}     <- but the account exists
no
```

The operator did its real work (the account exists) and then died on the status write, so the object never shows `Ready`. Check `kubectl -n wallet get pods`: the operator's `RESTARTS` counter climbs, because an uncaught exception ends the process and the kubelet starts it again. Fix it by restoring the rule, and prove the fix with the same `can-i` command:

```bash
kubectl apply -f operator-deploy.yaml
kubectl auth can-i patch walletaccounts --subresource=status --as system:serviceaccount:wallet:walletaccount-operator -n wallet
kubectl -n wallet get walletaccounts      # erin is Ready within about 30 seconds (the next restart or resync)
```

```text
role.rbac.authorization.k8s.io/walletaccount-operator configured
yes
erin   erin   10   Ready
```

**Questions to answer in your notes.** (1) The operator crashed on a 403. What should it do instead, and how would you make that visible to the person who created the object (hint: events and a `status.conditions` entry)? (2) The operator creates accounts but never deletes them. Describe the finalizer flow you would add, and what could go wrong if the operator is down when someone deletes the object. (3) With `minReplicaCount: 0` the `cooldownPeriod` would matter. What would the first transfer after an idle night cost the user, and would you accept that for the wallet worker?

Clean up: `kill %1`, `kind delete cluster --name cnlab`.
