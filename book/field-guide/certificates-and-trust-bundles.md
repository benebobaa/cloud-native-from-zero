# Certificates and trust bundles

## What and why

Three objects carry certificates. A CertificateSigningRequest (CSR) asks a signer to issue a certificate, for example for a user. A ClusterTrustBundle publishes CA certificates cluster-wide so workloads can trust them. A PodCertificateRequest lets the kubelet obtain a certificate for one Pod. The Kubernetes docs list ClusterTrustBundle and PodCertificateRequest as Stable since v1.37 ([source](https://kubernetes.io/docs/reference/access-authn-authz/certificate-signing-requests/)).

**Acts on it:** a signer issues certificates (the built-in signers run in kube-controller-manager) and the kubelet creates PodCertificateRequests.

## Diagram

{{diagram certificates-and-trust-bundles-01.jsx | Certificate objects and their signer · 3 kinds}}

Pick the object by who asks and who needs trust: a person, every workload, or one Pod.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1, openssl (2026-11-17). The CSR flow below is the one in the Authentication card; here the focus is the objects. The commands run on a kubeadm-style control plane (kind uses kubeadm).

```bash
openssl req -new -key jane.key -out jane.csr -subj "/CN=jane/O=dev"
cat <<EOF | kubectl apply -f -
apiVersion: certificates.k8s.io/v1
kind: CertificateSigningRequest
metadata: {name: jane}
spec:
  request: $(base64 -w0 jane.csr)
  signerName: kubernetes.io/kube-apiserver-client
  expirationSeconds: 86400
  usages: [client auth]
EOF
kubectl certificate approve jane
kubectl get csr jane -o jsonpath='{.status.certificate}' | base64 -d | openssl x509 -noout -subject -issuer -dates
```

```text
$ kubectl get csr
NAME        AGE     SIGNERNAME                                    REQUESTOR                              REQUESTEDDURATION   CONDITION
csr-qf76q   7m13s   kubernetes.io/kube-apiserver-client-kubelet   system:bootstrap:abcdef                <none>              Approved,Issued
csr-tbgzm   7m28s   kubernetes.io/kube-apiserver-client-kubelet   system:node:cnlab-control-plane        <none>              Approved,Issued
jane        6m57s   kubernetes.io/kube-apiserver-client           kubernetes-admin                       24h                 Approved,Issued
subject=O=dev, CN=jane
issuer=CN=kubernetes
notBefore=Nov 17 04:39:56 2026 GMT
notAfter=Nov 18 04:39:56 2026 GMT
$ kubectl get clustertrustbundles
NAME                                                            SIGNERNAME
demo-roots                                                      <none>
kubernetes.io:kube-apiserver-serving:5533b674f204c7e63dc1ef31   kubernetes.io/kube-apiserver-serving
$ docker exec cnlab-control-plane kubeadm certs check-expiration | head -7
CERTIFICATE                EXPIRES                  RESIDUAL TIME   CERTIFICATE AUTHORITY   EXTERNALLY MANAGED
admin.conf                 Nov 17, 2027 04:44 UTC   364d            ca                      no
apiserver                  Nov 17, 2027 04:44 UTC   364d            ca                      no
apiserver-etcd-client      Nov 17, 2027 04:44 UTC   364d            etcd-ca                 no
```

The two kubelet CSRs were created and approved by the cluster itself when the nodes joined. A `ClusterTrustBundle` (`certificates.k8s.io/v1` in 1.37) was created from a CA file with `spec.trustBundle`; the built-in one for the `kubernetes.io/kube-apiserver-serving` signer is already there. `PodCertificateRequest` (namespaced, `certificates.k8s.io/v1`) exists as an API: `kubectl explain` documents it, and its description says the one well-known signer, `kubernetes.io/kube-apiserver-client-pod`, "is currently unimplemented"; it was not run.

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| CSR `spec.request` | PEM `CERTIFICATE REQUEST`, base64-encoded again in YAML | required |
| CSR `spec.signerName` | Who signs: `kubernetes.io/kube-apiserver-client` (user client certs), `kubernetes.io/kube-apiserver-client-kubelet`, `kubernetes.io/kubelet-serving`, or your own `example.com/...` | required |
| CSR `spec.usages` | Key usages, for example `client auth` or `server auth`; must suit the signer | none |
| CSR `spec.expirationSeconds` | Requested lifetime; signers may shorten it | signer maximum: kube-controller-manager `--cluster-signing-duration`, 8760h |
| CSR `spec.username` / `groups` | Set by the API server to the creator; read-only | filled in |
| CSR `status.conditions` / `status.certificate` | `Approved` or `Denied`, then the signed certificate (base64 PEM) | empty until acted on |
| ClusterTrustBundle `spec.trustBundle` | One or more PEM CA certificates | required |
| ClusterTrustBundle `spec.signerName` | Links the bundle to a signer; setting it needs `attest` permission on that signer | none |
| Projected `clusterTrustBundle` | Pod volume source: `name`, or `signerName` plus `labelSelector`, written to `path` | `optional: false` |
| Projected `podCertificate` | Kubelet makes a key and a PodCertificateRequest for `signerName`, `keyType`; writes `credentialBundlePath` | lifetime 86400 s |
| PodCertificateRequest `spec` | Created by the kubelet: pod, node, ServiceAccount names and UIDs, `stubPKCS10Request`, `signerName` | `maxExpirationSeconds` 86400 |

Fields and defaults are from the [v1.37.0 OpenAPI spec](https://github.com/kubernetes/kubernetes/tree/v1.37.0/api/openapi-spec/v3) (`certificates.k8s.io/v1`, `core/v1`). Signer names: [Certificates and Certificate Signing Requests](https://kubernetes.io/docs/reference/access-authn-authz/certificate-signing-requests/); the 8760h default: [kube-controller-manager flags](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/). The OpenAPI spec says the documented PodCertificateRequest signer `kubernetes.io/kube-apiserver-client-pod` is not implemented yet, so you need a third-party signer.

## kubectl

```
openssl genrsa -out jane.key 2048
openssl req -new -key jane.key -out jane.csr -subj "/CN=jane/O=dev-team"   # CN = user, O = group
kubectl apply -f csr.yaml                                       # request: $(base64 -w0 jane.csr)
kubectl get csr                                                 # CONDITION: Pending, Approved,Issued, Denied
kubectl certificate approve jane                                # or: kubectl certificate deny jane
kubectl get csr jane -o jsonpath='{.status.certificate}' | base64 -d > jane.crt
openssl x509 -in jane.crt -noout -subject -issuer -dates
kubectl config set-credentials jane --client-certificate=jane.crt --client-key=jane.key --embed-certs=true
kubectl get clustertrustbundles
kubectl get podcertificaterequests -A
kubectl explain certificatesigningrequest.spec
docker exec cnlab-control-plane kubeadm certs check-expiration   # control-plane certificates (on the node)
```

## How it fails

All rows were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubectl get csr` shows `Pending` for ever (a CSR with `signerName: example.com/custom`) | Nobody approved it, or no controller implements that signer; only the built-in `kubernetes.io/*` signers are signed by kube-controller-manager | `kubectl certificate approve <name>` for built-in signers; for a custom signer run its controller. `kubectl certificate deny <name>` ends it (`Denied` in the test) |
| `Approved,Failed`; condition `reason: SignerValidationFailure`, message `invalid usage for client certificate: server auth` | The CSR asked for usages the signer does not allow: `kubernetes.io/kube-apiserver-client` allows only client auth (a `usages: [server auth]` CSR is accepted by the API but fails at signing) | Create a new CSR with `usages: [client auth]`; a CSR cannot be edited |
| `The CertificateSigningRequest "shortlived" is invalid: spec.expirationSeconds: Invalid value: 60: may not specify a duration less than 600 seconds (10 minutes)` | The minimum requested lifetime is 10 minutes | Use `expirationSeconds: 600` or more |

Certificates also fail by age: `kubeadm certs check-expiration` shows each control-plane certificate's `RESIDUAL TIME` (`364d` here); kubeadm client certificates last one year (the CAs ten; kubeadm does not rotate CAs) and are renewed by `kubeadm certs renew` or during a kubeadm control-plane upgrade; the kubelet's own client certificate rotates by itself ([kubeadm certificates](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-certs/)).

## Related

- **Cards:** Authentication, kubeadm and cluster bootstrap (group 1), kubelet (group 1), Downward API and projected volumes (group 5), RBAC.
- **Chapter and lab:** 5.5 for CertificateSigningRequest; ClusterTrustBundle and PodCertificateRequest are card only.
- **Exam:** no curriculum line names them (checked in the CKA and CKAD v1.37 curriculum PDFs, [cncf/curriculum](https://github.com/cncf/curriculum), 2026-11-17); `kubeadm certs` still matters for the CKA lifecycle and troubleshooting domains.
