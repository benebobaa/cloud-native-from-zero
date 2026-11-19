# Job

## What and why

A web server should run forever; a database migration, a report or a data import should run, finish and stop. A **Job** runs Pods until a set number of them have succeeded, retries failed ones, and then records the result. Its Pods use `restartPolicy: Never` or `OnFailure`, never `Always`.

The Job controller (in `kube-controller-manager`) creates up to `parallelism` Pods at a time, counts successes toward `completions`, and gives up after `backoffLimit` failures or when `activeDeadlineSeconds` passes. Finished Pods and the Job are kept so you can read the logs, until you delete them or `ttlSecondsAfterFinished` expires.

## Diagram

{{diagram job-01.jsx | Job outcomes · 1 retry loop, 2 end states}}
The Job controller keeps `parallelism` Pods running until `completions` have succeeded, retrying failed Pods until the back-off or deadline limit ends the Job.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16).

```yaml
apiVersion: batch/v1
kind: Job
metadata: {name: pi-batch}
spec:
  completions: 6
  parallelism: 2
  backoffLimit: 2
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
      - {name: work, image: "alpine:3.21", command: ["sh","-c","echo task $HOSTNAME; sleep 3"]}
```

```
$ kubectl apply -f job.yaml; sleep 5; kubectl get job pi-batch; kubectl get pods -l job-name=pi-batch
NAME       STATUS    COMPLETIONS   DURATION   AGE
pi-batch   Running   0/6           6s         6s
NAME             READY   STATUS              RESTARTS   AGE
pi-batch-8jbfr   0/1     ContainerCreating   0          5s
pi-batch-rdpvr   0/1     ContainerCreating   0          5s
$ kubectl wait --for=condition=complete job/pi-batch --timeout=60s; kubectl get job pi-batch
job.batch/pi-batch condition met
NAME       STATUS     COMPLETIONS   DURATION   AGE
pi-batch   Complete   6/6           47s        47s
$ kubectl logs job/pi-batch | head -2
Found 6 pods, using pod/pi-batch-8jbfr
task pi-batch-8jbfr
```

Two Pods ran at a time until six had succeeded (the first run was slow because the image was still being pulled).

## Key fields

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.completions` | Successful Pods needed; if unset, one success completes the Job | unset |
| `spec.parallelism` | Pods running at the same time | unset (1 Pod at a time) |
| `spec.backoffLimit` | Retries before the Job is marked failed | 6 |
| `spec.activeDeadlineSeconds` | Maximum seconds the Job may stay active | none |
| `spec.ttlSecondsAfterFinished` | Delete the Job this long after it finishes | unset (never) |
| `spec.completionMode` | `NonIndexed`, or `Indexed` (each Pod gets an index 0 to completions-1) | `NonIndexed` |
| `spec.suspend` | Create no Pods while true | false |
| `spec.template.spec.restartPolicy` | `Never` or `OnFailure` (required; `Always` is rejected) | none |

Defaults are from `kubectl explain` and the v1.37.0 OpenAPI spec; `parallelism` unset is treated as 1.

## kubectl

```
kubectl apply -f job.yaml
kubectl create job once --image=alpine:3.21 -- echo hi    # imperative Job
kubectl create job manual --from=cronjob/tick              # run a CronJob's template now
kubectl get job pi-batch                                   # STATUS and COMPLETIONS
kubectl get pods -l job-name=pi-batch                      # the Job's Pods
kubectl logs job/pi-batch                                  # logs of one of its Pods
kubectl wait --for=condition=complete job/pi-batch --timeout=60s
kubectl describe job pi-batch                              # Events and conditions
kubectl get job pi-batch -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.reason}{"\n"}{end}'
kubectl delete job pi-batch                                # also deletes its Pods
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `STATUS Failed`, three Pods in `Error`; conditions `Failed=True BackoffLimitExceeded: Job has reached the specified backoff limit` | The container exits non-zero and `backoffLimit: 2` retries were used up | Read `kubectl logs` of a failed Pod, fix the command, recreate the Job (a Job's template cannot be changed) |
| Condition `FailureTarget=True DeadlineExceeded: Job was active longer than specified deadline` | `activeDeadlineSeconds` (5 s here) passed before the work finished | Raise the deadline or make the work faster |
| `The Job "bad-policy" is invalid: spec.template.spec.restartPolicy: Required value: valid values: "OnFailure", "Never"` | The Pod template left `restartPolicy` at its default `Always`, which a Job rejects | Set `restartPolicy: Never` or `OnFailure` |

## Related

- **Cards:** CronJob; Pod; Pod lifecycle and probes; Finalizers and Owner references (group 2); Logs, events and kubectl debug (group 11).
- **Chapter and lab:** Chapter 5.2 and Lab 5.2 (Vol 5).
- **Exam domain:** KCNA Kubernetes Fundamentals; CKAD Application Design and Build, choose a workload resource.
