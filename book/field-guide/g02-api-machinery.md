# 2 · API machinery

## How the API machinery cards fit together

{{diagram g02-api-machinery-01.jsx | API machinery cards by role · 11 cards}}
The top row is what a request passes through; the lower rows are the objects and mechanisms that request acts on. Chapter 5.1 teaches all eleven cards; API Priority and Fairness is card-only.

| Card | One-line job | Chapter | Exam domain |
| --- | --- | --- | --- |
| Objects, spec and status | Desired state versus observed state | 5.1 | KCNA Kubernetes Fundamentals |
| Labels, selectors and annotations | How objects are grouped and found | 5.1 | KCNA Kubernetes Fundamentals |
| Namespace | Scope for names, quotas and access | 5.1 | KCNA Kubernetes Fundamentals |
| Owner references and garbage collection | Who owns what, and cascading delete | 5.1 | KCNA Kubernetes Fundamentals |
| Finalizers | Hold deletion until cleanup is done | 5.1 | KCNA Kubernetes Fundamentals |
| Watch and resourceVersion | How clients follow changes | 5.1 | KCNA Kubernetes Fundamentals |
| Server-side apply and field managers | Who owns which field | 5.1 | KCNA Kubernetes Fundamentals |
| API groups, versions and deprecation | Where an API lives and how it retires | 5.1 | CKAD Application Observability and Maintenance: API deprecations |
| Event | What happened to an object | 5.1 | KCNA Kubernetes Fundamentals; see the Logs, events and kubectl debug card for the CKA and CKAD debugging competency |
| Lease | Heartbeats and leader election | 5.1 | KCNA Kubernetes Fundamentals |
| API Priority and Fairness | Request queueing and limits | card only | KCNA Kubernetes Fundamentals |
