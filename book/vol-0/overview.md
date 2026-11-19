# Cloud Native from Zero · Vol 0: Orientation & Lab Setup

Volume 0 takes one week. It shows the whole 28-week journey, explains how CNCF projects fit together, and gets your lab running.

## Outcomes

By the end of this week you have a working lab and a mental map of everything the next 27 weeks will teach.

1. Explain, in your own words, what problem cloud-native computing solves and why it took 60 years of computing history to get here.
2. Name the layers of a modern cloud-native stack, from CPU to platform, and say which volume of this book teaches each.
3. Explain what the CNCF is, what its maturity levels (sandbox, incubating, graduated) mean, and why a graduated project carries lower adoption risk (though not zero risk).
4. Explain why Kubernetes is built as a set of plug-in interfaces (CRI, CNI, CSI and the API) and name one CNCF project that plugs into each.
5. Run a terminal on Ubuntu 24.04, use git, and start and delete a local Kubernetes cluster with kind.
6. Describe the digital-wallet app you will build, run and operate throughout the book.

## The journey at a glance

Semester 1 builds the foundations Kubernetes stands on; semester 2 builds Kubernetes and the CNCF platform on top of them.

{{diagram overview-01.jsx | the journey · 8 volumes stacked as layers, 2 semesters}}

Read it bottom up. Kubernetes (Vol 5) only makes sense once you know Linux processes, network namespaces and the Raft consensus algorithm (Vols 1–3), because Kubernetes is built from them.

## How to use this book

Every chapter is one week and always runs in the same order: theory first, then lab, then review.

| Part | Where | Time | What you do |
| --- | --- | --- | --- |
| Theory | The chapter tab | \~2 h | Read why the thing exists, how it works underneath, and how industry runs it |
| Lab | Sub-tab `Lab N.M` | 3–4 h | Build it by hand first, then use the real tool; finish when the Checkpoint output matches |
| Review | Sub-tab `Review N.M` | \~1 h | Answer the questions without notes; use the hints only when stuck |
| Milestone | Tab `Milestone`, end of each volume | 4–6 h | Take the digital-wallet app one step further; this is graded |

**Prerequisites.** You can write a small program in one language (Python, Java, Go, C or JavaScript) and know arrays, maps and functions. You do not need any operating systems, networking or terminal experience; Volumes 1 and 2 teach exactly the parts the rest of the book needs.

**Rule for labs.** Type the commands; do not paste them. Read every error message to the end before searching for it. When a lab says Break it, break it on purpose: finding the fault is the real lesson.

**Going deeper boxes** point to papers and kernel documents. They are optional for self-study; your lecturer may assign them.

**Versions tested.** Ubuntu 24.04 LTS and Kubernetes 1.37 ([Kubernetes releases](https://kubernetes.io/releases/), checked 2026-11-16). Each lab lists the exact tool versions it was tested on. If your version differs, the idea is the same, but a flag or an output line may differ.
