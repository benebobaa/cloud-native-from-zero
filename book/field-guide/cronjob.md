# CronJob

## What and why

A nightly backup or an hourly cleanup is a Job that must start itself. A **CronJob** holds a Job template and a cron-style schedule. At each tick the CronJob controller (in `kube-controller-manager`) creates a Job from the template; that Job then creates Pods, so a CronJob owns Jobs and a Job owns Pods.

What happens when ticks are missed or overlap is a policy, not an accident: `concurrencyPolicy` decides whether a new Job may start while the last one still runs, and `startingDeadlineSeconds` limits how late a missed run may still start. Old Jobs are pruned to the history limits.

## Diagram

{{diagram cronjob-01.jsx | CronJob → Job → Pod and the schedule timeline}}
The CronJob controller creates a Job at each schedule tick; `concurrencyPolicy` decides what happens when the previous Job is still running.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16).

```yaml
apiVersion: batch/v1
kind: CronJob
metadata: {name: tick}
spec:
  schedule: "* * * * *"          # every minute
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 2
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
          - {name: c, image: "alpine:3.21", command: ["sh","-c","date; echo tick"]}
```

```
$ kubectl apply -f cj.yaml; kubectl get cronjob tick
NAME   SCHEDULE    TIMEZONE   SUSPEND   ACTIVE   LAST SCHEDULE   AGE
tick   * * * * *   <none>     False     0        <none>          0s
$ sleep 75; kubectl get cronjob tick; kubectl get jobs; kubectl get pods
tick   * * * * *   <none>     False     0        55s             82s
tick-29913618   Complete   1/1   3s   59s
tick-29913618-xsc9d   0/1   Completed           0   61s
tick-29913619-h92vw   0/1   ContainerCreating   0   1s
$ kubectl logs job/tick-29913618
Mon Nov 16 08:18:00 UTC 2026
tick
$ kubectl patch cronjob tick -p '{"spec":{"suspend":true}}'; kubectl create job manual --from=cronjob/tick
cronjob.batch/tick patched
job.batch/manual created
```

The Job name is the CronJob name plus the scheduled time in minutes since the epoch (`29913618`); a suspended CronJob creates no more Jobs, but `kubectl create job --from` still runs its template once.

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.schedule` | Cron expression: minute, hour, day of month, month, day of week | required |
| `spec.timeZone` | IANA time zone name for the schedule | the controller manager's zone |
| `spec.concurrencyPolicy` | `Allow`, `Forbid` (skip the tick) or `Replace` (cancel the running Job) | `Allow` |
| `spec.startingDeadlineSeconds` | How late a missed run may still start; missed runs count as failed | none |
| `spec.suspend` | Create no new Jobs; running Jobs are not affected | false |
| `spec.successfulJobsHistoryLimit` | Finished successful Jobs kept | 3 |
| `spec.failedJobsHistoryLimit` | Finished failed Jobs kept | 1 |
| `spec.jobTemplate` | The Job to create at each tick | required |

Defaults are from `kubectl explain` and the v1.37.0 OpenAPI spec.

## kubectl

```
kubectl apply -f cj.yaml
kubectl create cronjob tick --image=alpine:3.21 --schedule='* * * * *' -- date     # imperative; not run in this form
kubectl get cronjob tick                    # LAST SCHEDULE, ACTIVE
kubectl get jobs                            # the Jobs it created, newest last
kubectl events --for cronjob/tick           # SuccessfulCreate, SawCompletedJob, JobAlreadyActive
kubectl create job manual --from=cronjob/tick       # run now, outside the schedule
kubectl patch cronjob tick -p '{"spec":{"suspend":true}}'
kubectl logs job/tick-29913618
kubectl delete cronjob tick                 # also deletes its Jobs
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `The CronJob "badcron" is invalid: spec.schedule: Invalid value: "every 5 minutes": expected exactly 5 fields, found 3: [every 5 minutes]` | The schedule is not a 5-field cron expression | Write `"*/5 * * * *"` |
| `The CronJob "badtz" is invalid: spec.timeZone: Invalid value: "Mars/Olympus": unknown time zone Mars/Olympus` | `timeZone` must be an IANA name known to the API server | Use a name such as `Europe/Amsterdam` |
| With `concurrencyPolicy: Forbid` and a Job that takes 100 s on a one-minute schedule, `kubectl events --for cronjob/slowjob` repeats `JobAlreadyActive: Not starting job because prior execution is running and concurrency policy is Forbid`; some ticks have no Job | The previous Job was still running, so the tick was skipped | Make the work shorter, lengthen the schedule, or choose `Allow` or `Replace` on purpose |

## Related

- **Cards:** Job; Pod; Owner references and garbage collection (group 2: history pruning); Event (group 2); kube-controller-manager and its controllers (group 1).
- **Chapter and lab:** Chapter 5.2 and Lab 5.2 (Vol 5); Linux cron and systemd timers, the same idea on one machine, are in Chapter 1.3 (Vol 1).
- **Exam domain:** KCNA Kubernetes Fundamentals; CKAD Application Design and Build, choose a workload resource.
