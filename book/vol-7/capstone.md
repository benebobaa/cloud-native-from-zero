# Capstone · Run the Wallet in Production

## The brief

You are the platform team for the wallet. You will deploy it from git, make it observable, harden it, survive a failure you were not told about, and write down what you learned. This is the last graded work of the book, and it uses every volume: containers (4), Kubernetes (5), networking and security (6), and the three chapters of this volume.

**Time.** Plan about 12 hours over one week, alone or in a pair. Parts 1 to 3 take about 9 hours; the chaos window and the postmortem take about 3.

**The one rule that makes it a test.** Some time during the week, the lecturer will break something in your running system. You are told the week, not the day, the hour or the failure. From the moment you submit Parts 1 to 3, your system is on call: keep it running, keep the dashboard open, and keep an incident log (a text file with timestamps).

## Five parts

| # | Part | What you build | Evidence the lecturer checks |
| --- | --- | --- | --- |
| 1 | GitOps deploy | A git repository with the wallet as a Helm chart or Kustomize overlays, and an Argo CD Application with auto-sync, prune and self-heal. The database password is not in git | `kubectl -n argocd get application wallet` shows `Synced` and `Healthy`; `git log` shows at least one change that reached the cluster only through git and one `git revert`; `grep -ri password` over the repository finds no real password |
| 2 | Observability | Prometheus scraping the API, a Grafana dashboard stored in git, a written SLO (SLI as a PromQL query, objective, 30-day error budget in minutes) a fast-burn alert, and an availability alert that watches Pod readiness | The dashboard shows request rate, error ratio and burn rate; `SLO.md` has the arithmetic; both alert rules are in git; the availability alert fires within about a minute when the database is down, and SLO.md says why the fast-burn alert can stay silent in that outage (Lab 7.2) |
| 3 | Security | Non-root containers with no privilege escalation, all capabilities dropped and a read-only root filesystem; a NetworkPolicy so only the API and the worker reach Postgres; resource requests and limits; no service account token where none is needed | `kubectl get pods -o jsonpath` shows the settings; a test Pod outside the wallet cannot connect to `wallet-postgres:5432`; `wallet/test_e2e.sh` still prints `PASS` |
| 4 | Chaos test | You do not build this: the lecturer injects one failure. You detect it, mitigate it, restore service and keep a log | Incident log with timestamps for the first alert, the first human action and full recovery |
| 5 | Blameless postmortem | The template from Ch 7.2, filled in within 48 hours of recovery | `POSTMORTEM.md` with an impact calculation in error-budget minutes, a timeline, contributing causes, and at least three action items with owners |

Start with the order the parts build on each other. Nothing in Part 2 or 3 works until Part 1 does, and Part 4 tests all of them.

{{diagram capstone-01.jsx | capstone at a glance · five parts, three built by you}}

Read it left to right: Part 1 feeds Parts 2 and 3, and the chaos test in Part 4 goes through all three before the postmortem closes the loop.

## Deliverables

| File or item | Content |
| --- | --- |
| Git repository | `chart/` or `kustomize/`, the Argo CD Application, the dashboard JSON, the alert rule, the NetworkPolicy; commit messages that say why |
| `README.md` | How to reach the wallet, the dashboard and Argo CD from a clean laptop (`kind create cluster` to a working system), in numbered commands |
| `SLO.md` | SLI query, objective, error-budget arithmetic, alert thresholds and what a page means |
| `RUNBOOK.md` | One page: symptoms, the first three commands to run, how to roll back, who to tell |
| `incident-log.txt` | Timestamped notes written during the chaos window |
| `POSTMORTEM.md` | The blameless postmortem |
| Screenshots | Argo CD (synced and healthy), the Grafana dashboard during the incident, a Jaeger trace if you did the stretch task |

## Grading rubric (100 points)

| Criterion | Points | Full marks when | Half marks when | Zero when |
| --- | --- | --- | --- | --- |
| Part 1 GitOps | 20 | Everything reaches the cluster through git; self-heal demonstrated; a revert rolled back a bad commit; no secret in git | Works, but one manual `kubectl apply` is still needed or a password is in git | The wallet runs but git does not control it |
| Part 2 Observability | 20 | Dashboard, SLO arithmetic and both alerts are correct and in git; an alert fired during the incident | Dashboard works but the SLO numbers are wrong or the alert never fired | No working metrics |
| Part 3 Security | 15 | All four controls are in place and the e2e test passes | Two or three controls | None, or the wallet broke |
| Part 4 Chaos response | 20 | Detected from an alert or the dashboard, not from the lecturer; mitigated; restored through git where possible; log is complete | Detected late, or fixed by hand with a note | Not detected, or no log |
| Part 5 Postmortem | 15 | Blameless, specific timeline, causes beyond the trigger, action items with owners that would prevent a repeat | Timeline but only the trigger as cause, or blame wording | Missing |
| Repository and documents | 10 | A classmate can rebuild the system from the README alone | Rebuild needs guessing | No README |

**What markers look for in the incident log.** Three times: when the failure began (from the lecturer), when your alert or dashboard showed it, and when the wallet was healthy again. The first gap is your detection time and the second is your recovery time. Both feed the postmortem.
