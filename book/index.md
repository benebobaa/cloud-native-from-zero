A free, hands-on book that takes you from your first shell command to running Kubernetes like a working operator, on your own laptop, at zero cloud cost.

You only need to know one programming language. The book teaches the rest in order: Linux, then networking, then distributed systems, then containers, then Kubernetes, then the CNCF platform tools teams run in production. Each volume builds on the one before it.

## How it works

Every chapter has three parts, and you do them in this order:

| Part | What you do | Time |
| --- | --- | --- |
| Theory | Read why the thing exists and how it works, with diagrams | about 2 h |
| Lab | Build it by hand first, then run the real tool, then break it on purpose and fix it | 3 to 4 h |
| Review | Answer questions from memory; hints included, answers are not | about 1 h |

One chapter is one week of study. The whole book is 28 weeks, about 200 hours. You can follow it alone, or a lecturer can teach it as a course.

A running case study grows with you: a small digital-wallet service (an API, a Postgres database and a worker). You run it as plain processes in Vol 1, put it in containers in Vol 4, and operate it on Kubernetes by the end.

## What you need

- A laptop with 8 GB of RAM or more
- Ubuntu 24.04 LTS, either installed, in a virtual machine, or in WSL2 on Windows
- Docker, and [kind](https://kind.sigs.k8s.io/) for local Kubernetes clusters (Vol 0 walks you through the setup)

No cloud account is needed.

## Where it leads

The finish line is a Kubernetes operator at the level of the CKA and CKAD exams, with a short tour of platform engineering at the end. The book follows Kubernetes 1.37.

## How this book was made

I wrote this book with Claude, Anthropic's AI model, as my co-author: I set the structure, the standards and the case study, and Claude drafted the chapters with me. Every lab was then run on a real kind cluster and checked against its expected output. Each lab says which tool versions it was tested with; a step that has not been run yet says so.

If you find a mistake, please [open an issue](https://github.com/benebobaa/cloud-native-from-zero/issues).

## For lecturers

Answer keys, teaching notes and timed exam drills are in a separate Instructor Companion. It is not public, so the review questions keep working for students. If you teach with this book, email me and I will share it.

## License

The text is [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/): you may share and adapt it, with credit, under the same license. The code is [MIT](https://opensource.org/license/mit). The source is on [GitHub](https://github.com/benebobaa/cloud-native-from-zero).
