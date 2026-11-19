# 5 · Configuration

## How the cards fit together

{{diagram g05-configuration-01.jsx | group 5 · configuration paths into a container}}
ConfigMap, Secret and Downward API data reach the container through env vars or mounted files, optionally merged by a projected volume.

## Cards and where they are taught

| Card | Covers | Chapter | Exam domain |
| --- | --- | --- | --- |
| ConfigMap | non-secret settings as env vars or files | Ch 5.3 | CKA: Workloads and Scheduling (15%); CKAD: Application Environment, Configuration and Security (25%) |
| Secret | small sensitive values, image pull credentials | Ch 5.3 | same as ConfigMap |
| Downward API and projected volumes | Pod fields into the container, merged volumes | not a separate matrix row; see Ch 5.3 | CKAD: Application Environment, Configuration and Security |

Chapter numbers come from the coverage matrix on the How to use tab.
