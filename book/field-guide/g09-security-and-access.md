# 9 · Security and access

Security in Kubernetes is a pipeline: the API server asks who you are, what you may do and whether the object is acceptable, and only then stores it.

{{diagram g09-security-and-access-01.jsx | Request path · 3 gates, audit, storage}}

Read the top row left to right; the cards below each box explain it.

| Card | Part of the pipeline | Chapter | Exam |
| --- | --- | --- | --- |
| Authentication | Who is calling | 5.5 | CKAD Environment, Configuration and Security (authentication, authorization, admission) |
| ServiceAccount | Identity for Pods | 5.5 | CKAD Environment, Configuration and Security (ServiceAccounts) |
| RBAC | What a subject may do | 5.5 | CKA Cluster Architecture (RBAC); CKAD (authorization) |
| Access reviews | Ask the authorizer a question | 5.5 | CKA and CKAD (`kubectl auth can-i`) |
| SecurityContext and capabilities | Limits on the Pod's process | 1.5, 6.3 | CKAD Environment, Configuration and Security (SecurityContexts, capabilities) |
| Pod Security Admission | Namespace-level Pod rules | 6.3 | CKAD (admission control) |
| Admission webhooks | Custom admission code | 6.3 | CKAD (admission control) |
| ValidatingAdmissionPolicy | Accept or reject with CEL | 6.3 | CKAD (admission control) |
| MutatingAdmissionPolicy | Change objects with CEL | 6.3 | CKAD (admission control) |
| Certificates and trust bundles | Certificates for people, workloads and Pods | 5.5 (CSR); card only (ClusterTrustBundle, PodCertificateRequest) | No curriculum line; used in CKA tasks that create users |
| Audit logging | Record requests | 6.3 | No curriculum line |
| Encrypting Secrets at rest | Protect etcd contents | 6.3 | No curriculum line |
