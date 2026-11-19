# Review 7.1

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** Explain the words *chart*, *release* and *revision* in three sentences. Where does Helm keep the history of a release, and why does that let `helm rollback` work from a different laptop?
2. **Concept.** Give two situations where Kustomize is the better tool and two where Helm is. For each, say what makes it better there.
3. **Concept.** State the four OpenGitOps principles in your own words. Which two does a CI job that runs `kubectl apply` against the production cluster break?
4. **Trace.** A developer merges a commit that changes the wallet API from `replicas: 2` to `replicas: 4`. Argo CD has auto-sync on and no webhook. List every step until the fourth Pod is `Running`. Name the component that acts at each step, and say which step can take the longest by default.
5. **Trace.** The `overlays/prod` file in the theory patches `wallet-api` only. Predict the replicas, memory limit and `env` label of `wallet-api` and the replicas of `wallet-worker` in `kubectl kustomize overlays/prod`. Which of these come from the base?
6. **Debug.** After a release, `kubectl -n argocd get applications` shows the wallet as `Synced` and `Degraded`. List the commands you run, in order, and the likely causes. Then explain why fixing it with `kubectl edit` would be wrong even if it worked.
7. **Debug.** An Application has been `OutOfSync` for an hour. The diff shows one line: `spec.replicas` is `2` in git and `5` live. KEDA is installed. Explain what is happening and give two different fixes.
8. **Design.** The wallet team wants dev, staging and prod, with every image tested in dev first. Design the repository layout, the path of an image tag from CI to prod, who may write to which branch or folder, where the database password lives, and how you roll back at 3 a.m.

**Read the diagram.** In the *push versus pull* diagram, an attacker steals the credentials held by the CI system. What can they do in the push lane? What can they do in the pull lane? What does the direction of the arrow between Argo CD and the Git repository mean for the cluster's firewall rules?

## Hints

| Q | Hint |
| --- | --- |
| 1 | Re-read the table of three words, then the paragraph on where Helm stores state. |
| 2 | Use the comparison table: who consumes the YAML, and how many options does it need? |
| 3 | The four principles are in the GitOps section; ask which ones need an agent that runs continuously. |
| 4 | Follow the Argo CD components diagram, numbers 1 to 4, then the controllers from Vol 5 for the Pods. Look for the default polling interval. |
| 5 | A patch changes only what its `target` selects; everything else is the base. |
| 6 | Sync status and health status are separate answers. Start with `kubectl describe` on a Pod. |
| 7 | Two controllers own the same field. Look at the In production table. |
| 8 | Separate CI's job from CD's job; think about what is in git and what must never be. |
