# Cloud Native from Zero

A free, hands-on book from your first shell command to running Kubernetes at the level of the CKA and CKAD exams. Everything runs on your own laptop, at zero cloud cost.

**Read it at [benelabs.tech/cloud-native-from-zero](https://benelabs.tech/cloud-native-from-zero/index.html).**

| Vol | Title | Status |
| --- | --- | --- |
| 0 | Orientation and Lab Setup | Published |
| 1 | Linux and the Operating System | Published |
| 2 | Networking | Published |
| 3 | Distributed Systems | Published |
| 4 | Containers | Published |
| 5 | Kubernetes Core | Published |
| 6 | Kubernetes Networking and Security | Published |
| 7 | Platform and Capstone | Published |
| | Kubernetes Field Guide | Published: 89 cards, one per built-in resource, component and mechanism, plus CKA, CKAD and KCNA drills |

A page is published once its lab passes a clean run.

## What is in this repo

```
book/
  book.json            all volumes: titles, summaries, published flag
  index.md             the book's front page
  vol-N/
    volume.json        the volume's pages, in reading order
    <page>.md          one page per file (overview, ch-N-M, lab-N-M, review-N-M, milestone-N, glossary)
    diagrams/*.jsx     each diagram as a small JSX module that returns an SVG
    images/            real UI screenshots (Vol 6, Vol 7)
  field-guide/         the Kubernetes Field Guide, same layout
data/                  the measured data behind the charts
code/
  wallet/              the running case study: API + Postgres + worker
build/                 turns book/ into static HTML pages
site/book.css          the page styles (matches benelabs.tech)
```

A page includes a diagram with one line: `{{diagram ch-1-2-01.jsx | caption}}`.

## Build

You need Node.js 20 or newer.

```sh
npm install
npm run build                 # → dist/cloud-native-from-zero/
python3 -m http.server -d dist 4173
# open http://127.0.0.1:4173/cloud-native-from-zero/index.html
```

`npm run build:site` writes straight into the benelabs.tech source folder, which sits next to this repo.

## How this book was made

I wrote this book with Claude, Anthropic's AI model, as my co-author: I set the structure, the standards and the case study, and Claude drafted the chapters with me. Every lab was then run on a real kind cluster and checked against its expected output. Each lab says which tool versions it was tested with.

Found a mistake? [Open an issue](https://github.com/benebobaa/cloud-native-from-zero/issues).

## License

- Text, diagrams and data (`book/`, `data/`): [CC BY-SA 4.0](LICENSE)
- Code (`code/`, `build/`, `site/`): [MIT](LICENSE-CODE)
