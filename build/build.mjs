// Build the book into static HTML pages that sit inside benelabs.tech.
//
//   node build/build.mjs                       → ./dist (preview: python3 -m http.server -d dist)
//   node build/build.mjs --out <site>/cloud-native-from-zero
//
// Inputs:  book/book.json (all volumes), book/vol-N/volume.json (tabs), book/vol-N/<slug>.md,
//          book/vol-N/diagrams/<name>.jsx (+ optional <name>.props.json), book/vol-N/images/*
// Output:  <out>/index.html, <out>/vol-N/index.html (the Overview tab), <out>/vol-N/<slug>.html,
//          <out>/assets/book.css, <out>/vol-N/images/*
// Pages assume <out> is one level below the site root (they link ../styles.css etc.).
import { marked } from 'marked';
import katex from 'katex';
import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { renderDiagram } from './render-diagram.mjs';
import { PALETTE } from './palette.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const OUT = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(ROOT, 'dist/cloud-native-from-zero'));
const STANDALONE = !args.includes('--out'); // dist build also gets a copy of the site stylesheet for preview
const REPO = 'https://github.com/benebobaa/cloud-native-from-zero';
const SITE = 'https://benelabs.tech';

const book = JSON.parse(await readFile(path.join(ROOT, 'book/book.json'), 'utf8'));
const warnings = [];
const warn = (m) => warnings.push(m);

// ---------- helpers --------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Claude Docs doc id → where that volume lives now (published volumes only); unpublished → book index.
const docToVolume = new Map(book.volumes.map((v) => [v.doc, v]));

function rewriteHref(href, depth) {
  const up = '../'.repeat(depth);
  const m = href.match(/^https:\/\/claude\.ai\/(?:code\/)?artifact\/(?:[^/?#]*-)?([A-Za-z0-9]{22}|[0-9a-f-]{36})/);
  if (!m) return href;
  const vol = docToVolume.get(m[1]);
  if (vol && vol.published) return `${up}${vol.slug}/index.html`;
  if (vol) return `${up}index.html#${vol.slug}`;
  warn(`link to a Claude Doc that is not part of the public book: ${href}`);
  return `${up}index.html`;
}

function substitutePalette(svg, where) {
  return svg.replace(/var\((--[a-z0-9-]+)\)/g, (all, name) => {
    if (PALETTE[name]) return PALETTE[name];
    warn(`${where}: unmapped colour ${name}`);
    return '#525252';
  });
}

// ---------- markdown → html ------------------------------------------------
function makeRenderer(depth) {
  const renderer = new marked.Renderer();
  const seen = new Map();
  renderer.heading = function ({ tokens, depth: level }) {
    const text = this.parser.parseInline(tokens);
    let id = slugify(text) || 'section';
    const n = seen.get(id) || 0;
    seen.set(id, n + 1);
    if (n) id = `${id}-${n + 1}`;
    return `<h${level} id="${id}">${text}</h${level}>\n`;
  };
  const baseTable = marked.Renderer.prototype.table;
  renderer.table = function (token) {
    return `<div class="table-wrap">${baseTable.call(this, token)}</div>\n`;
  };
  // ```latex blocks → MathML (rendered natively by browsers; no script or font download)
  const baseCode = marked.Renderer.prototype.code;
  renderer.code = function (token) {
    if (token.lang === 'latex' || token.lang === 'tex') {
      try {
        return `<div class="math">${katex.renderToString(token.text, { displayMode: true, output: 'mathml', throwOnError: true })}</div>\n`;
      } catch (e) {
        warn(`latex failed (${e.message.split('\n')[0]}), shown as code: ${token.text.slice(0, 60)}`);
      }
    }
    return baseCode.call(this, token);
  };
  const baseLink = marked.Renderer.prototype.link;
  renderer.link = function (token) {
    const html = baseLink.call(this, { ...token, href: rewriteHref(token.href, depth) });
    return /^https?:\/\//.test(token.href) && !token.href.startsWith(SITE) && !/claude\.ai\/(code\/)?artifact/.test(token.href)
      ? html.replace('<a ', '<a rel="noopener" ')
      : html;
  };
  return renderer;
}

async function renderMarkdown(md, volDir, slug, depth) {
  // the doc title (first "# " line) becomes the page <h1>; return it separately
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let title = null;
  const h1 = lines.findIndex((l) => /^# /.test(l));
  if (h1 !== -1 && lines.slice(0, h1).every((l) => !l.trim())) {
    title = lines[h1].slice(2).trim();
    lines.splice(h1, 1);
  }
  // the doc byline ("Nov 16, 2026 · @Author") is editor metadata, not book content
  const by = lines.findIndex((l) => l.trim());
  if (by !== -1 && /^[A-Z][a-z]{2} \d{1,2}, \d{4}( · @.*)?\s*$/.test(lines[by].trim())) lines.splice(by, 1);
  // diagrams: {{diagram file.jsx | caption}}
  let n = 0;
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\{\{diagram\s+([^|}]+?)\s*(?:\|\s*(.*?))?\s*\}\}\s*$/);
    if (!m) { out.push(line); continue; }
    n += 1;
    const file = path.join(volDir, 'diagrams', m[1]);
    const caption = m[2] || '';
    if (!existsSync(file)) { warn(`${slug}: missing diagram ${m[1]}`); continue; }
    try {
      const svg = substitutePalette(await renderDiagram(file, { idPrefix: `${slug}-${n}` }), `${slug}/${m[1]}`);
      out.push('', `<figure class="diagram">${svg}${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`, '');
    } catch (e) {
      warn(`${slug}: diagram ${m[1]} failed: ${e.message.split('\n')[0]}`);
      out.push('', `<p class="meta">[diagram not available: ${esc(caption)}]</p>`, '');
    }
  }
  const html = marked.parse(out.join('\n'), { gfm: true, renderer: makeRenderer(depth) });
  return { title, html };
}

// ---------- page chrome ----------------------------------------------------
function page({ depth, title, description, kicker, body, canonical }) {
  const up = '../'.repeat(depth);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title === book.title ? esc(title) : `${esc(title)} | ${esc(book.title)}`}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}/${canonical}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${up}../styles.css">
<link rel="stylesheet" href="${up}assets/book.css">
<link rel="icon" href="data:,">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<nav class="nav" aria-label="Primary">
<div class="wrap nav-inner">
<a class="nav-brand" href="${up}../index.html">Benediktus Satriya</a>
<ul class="nav-links">
<li><a href="${up}../index.html">Work</a></li>
<li><a href="${up}../experience.html">Experience</a></li>
<li><a href="${up}../log.html">Log</a></li>
<li><a href="${up}../learn.html" aria-current="page">Learn</a></li>
<li><a href="${up}../about.html">About</a></li>
</ul>
</div>
</nav>
<main class="page" id="main">
<header>
<p class="kicker">${kicker}</p>
<h1>${esc(title)}</h1>
</header>
${body}
<footer class="lesson-footer">
<p class="nav meta">Cloud Native from Zero · text <a href="${REPO}/blob/main/LICENSE">CC BY-SA 4.0</a>, code <a href="${REPO}/blob/main/LICENSE-CODE">MIT</a> · <a href="${REPO}">source on GitHub</a> · written with Claude, labs run on real clusters (see each lab's "Versions tested" line).</p>
</footer>
</main>
</body>
</html>
`;
}

const KIND_LABEL = { overview: 'Overview', chapter: 'Theory', lab: 'Lab', review: 'Review', milestone: 'Milestone', glossary: 'Glossary', extra: '', group: 'Group', card: 'Card' };

// ---------- build ----------------------------------------------------------
await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, 'assets'), { recursive: true });
await cp(path.join(ROOT, 'site/book.css'), path.join(OUT, 'assets/book.css'));

const published = book.volumes.filter((v) => v.published);
let pages = 0;

for (const vol of published) {
  const volDir = path.join(ROOT, 'book', vol.slug);
  const meta = JSON.parse(await readFile(path.join(volDir, 'volume.json'), 'utf8'));
  const outDir = path.join(OUT, vol.slug);
  await mkdir(outDir, { recursive: true });
  if (existsSync(path.join(volDir, 'images'))) await cp(path.join(volDir, 'images'), path.join(outDir, 'images'), { recursive: true });

  const isGuide = vol.kind === 'guide';
  const tabs = meta.tabs;
  const bySlug = new Map(tabs.map((t) => [t.slug, t]));
  const fileOf = (t) => (t.kind === 'overview' ? 'index.html' : `${t.slug}.html`);
  const volLabel = isGuide ? vol.title : `Vol ${vol.number} · ${vol.title}`;
  const volShort = isGuide ? 'Field Guide' : `Vol ${vol.number}`;

  for (const [i, tab] of tabs.entries()) {
    let title = null, html;
    if (tab.hold) {
      html = `<div class="callout note"><p class="callout-title">Being re-verified</p><p>${esc(tab.hold)}</p></div>`;
    } else {
      const mdPath = path.join(volDir, `${tab.slug}.md`);
      if (!existsSync(mdPath)) { warn(`${vol.slug}/${tab.slug}: no markdown yet`); continue; }
      ({ title, html } = await renderMarkdown(await readFile(mdPath, 'utf8'), volDir, `${vol.slug}-${tab.slug}`, 1));
    }

    // chapter strip: Theory · Lab · Review for the chapter this tab belongs to
    const chapterSlug = tab.kind === 'chapter' ? tab.slug : (bySlug.get(tab.parent)?.kind === 'chapter' ? tab.parent : null);
    let strip = '';
    if (chapterSlug) {
      const family = tabs.filter((t) => t.slug === chapterSlug || t.parent === chapterSlug);
      strip = `<nav class="chapter-tabs" aria-label="This chapter">${family
        .map((t) => (t.slug === tab.slug
          ? `<span aria-current="page">${KIND_LABEL[t.kind]}</span>`
          : `<a href="${fileOf(t)}">${KIND_LABEL[t.kind]}</a>`))
        .join('')}</nav>`;
    }

    // contents table on the overview page; a group page lists its cards
    let toc = '';
    if (tab.kind === 'overview') {
      const rows = tabs.filter((t) => t.kind !== 'overview' && !t.parent).map((t) => {
        const kids = tabs.filter((k) => k.parent === t.slug);
        return `<tr><td><a href="${fileOf(t)}"><strong>${esc(t.title)}</strong></a></td><td>${kids.map((k) => `<a href="${fileOf(k)}">${esc(k.title)}</a>`).join(' · ')}</td></tr>`;
      });
      const head = isGuide ? '<th>Group</th><th>Cards</th>' : '<th>Part</th><th>Practice</th>';
      toc = `<section><h2 id="contents">Contents</h2><div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div></section>`;
    } else if (tab.kind === 'group') {
      const kids = tabs.filter((k) => k.parent === tab.slug);
      toc = `<section><h2 id="cards">Cards in this group</h2><ul>${kids.map((k) => `<li><a href="${fileOf(k)}">${esc(k.title)}</a></li>`).join('')}</ul></section>`;
    }

    const prev = tabs[i - 1], next = tabs[i + 1];
    const pager = `<nav class="pager" aria-label="Previous and next">${prev ? `<a rel="prev" href="${fileOf(prev)}">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a rel="next" href="${fileOf(next)}">${esc(next.title)} →</a>` : `<a href="../index.html">The whole book →</a>`}</nav>`;

    const pageTitle = tab.kind === 'overview' ? volLabel : (title || tab.title);
    let crumb = '';
    if (tab.kind === 'card') {
      const g = bySlug.get(tab.parent);
      crumb = ` · <a href="${fileOf(g)}">${esc(g.title.split(' · ')[1] || g.title)}</a>`;
    } else if (tab.kind !== 'overview') {
      crumb = ` · ${esc(isGuide ? (tab.title.split(' · ')[1] || tab.title) : tab.title.split(' · ')[0])}`;
    }
    const kicker = `<a href="../index.html">Cloud Native from Zero</a> · <a href="index.html">${volShort}</a>${crumb}`;
    const description = `${tab.kind === 'overview' ? '' : `${tab.title} — `}Cloud Native from Zero, ${volLabel}. A free, hands-on book from Linux to Kubernetes.`;
    await writeFile(path.join(outDir, fileOf(tab)), page({
      depth: 1,
      title: pageTitle,
      description,
      kicker,
      body: `${strip}<article class="book-body">${html}</article>${toc}${pager}`,
      canonical: `cloud-native-from-zero/${vol.slug}/${fileOf(tab)}`,
    }));
    pages += 1;
  }
}

// ---------- book index -----------------------------------------------------
const intro = marked.parse(await readFile(path.join(ROOT, 'book/index.md'), 'utf8'), { gfm: true, renderer: makeRenderer(0) });
const row = (v, first) => `<tr id="${v.slug}"><td>${first}</td><td>${v.published ? `<a href="${v.slug}/index.html"><strong>${esc(v.title)}</strong></a>` : `<strong>${esc(v.title)}</strong>`}</td><td>${esc(v.summary)}</td><td class="meta">${v.published ? 'Published' : 'Coming'}</td></tr>`;
const volRows = book.volumes.filter((v) => v.kind !== 'guide').map((v) => row(v, `<code>${v.number}</code>`)).join('');
const guides = book.volumes.filter((v) => v.kind === 'guide');
const guideSection = guides.length
  ? `<section><h2 id="reference">Reference</h2><p>Keep this open while you work through Vol 5 to 7, and for exam practice.</p><div class="table-wrap"><table><thead><tr><th></th><th>Guide</th><th>What it is</th><th>Status</th></tr></thead><tbody>${guides.map((v) => row(v, '')).join('')}</tbody></table></div></section>`
  : '';
await writeFile(path.join(OUT, 'index.html'), page({
  depth: 0,
  title: book.title,
  description: book.description,
  kicker: `<a href="../learn.html">Learn</a> · Book`,
  body: `<article class="book-body">${intro}</article><section><h2 id="volumes">The volumes</h2><div class="table-wrap"><table><thead><tr><th>#</th><th>Volume</th><th>What you learn</th><th>Status</th></tr></thead><tbody>${volRows}</tbody></table></div></section>${guideSection}`,
  canonical: 'cloud-native-from-zero/index.html',
}));
pages += 1;

if (STANDALONE) {
  // preview build: put the site stylesheet one level up so ../styles.css resolves
  const siteCss = path.resolve(ROOT, '../jobseeker/personal-page/styles.css');
  if (existsSync(siteCss)) await cp(siteCss, path.join(OUT, '../styles.css'));
}

console.log(`built ${pages} pages → ${OUT}`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of [...new Set(warnings)]) console.log(`  - ${w}`);
}
