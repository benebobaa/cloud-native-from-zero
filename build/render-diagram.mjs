// Render one diagram module (a JSX file whose default export returns an <svg>) to static SVG markup.
// The modules come from the book's Claude Docs widgets; they use CSS variables (--cds-*) for colour,
// which assets/book.css maps onto the site's black-and-white palette.
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function renderDiagram(file, { idPrefix = 'd' } = {}) {
  const result = await build({
    entryPoints: [file],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    loader: { '.jsx': 'jsx', '.js': 'jsx' },
    inject: [path.join(import.meta.dirname, 'claude-shim.jsx')], // provides the free identifier `claude`
    // react is resolved from this repo's node_modules, not next to the diagram file
    nodePaths: [path.resolve(import.meta.dirname, '..', 'node_modules')],
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const Component = mod.default;
  if (typeof Component !== 'function') throw new Error(`${file}: no default export function`);
  let svg = renderToStaticMarkup(createElement(Component, await loadProps(file)));
  // drop the editor-only attributes
  svg = svg.replace(/\sdata-claude-[a-z-]+="[^"]*"/g, '');
  // marker/gradient ids must be unique per page: prefix every id and its url(#…) / href="#…" references
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    svg = svg
      .replace(new RegExp(`id="${esc}"`, 'g'), `id="${idPrefix}-${id}"`)
      .replace(new RegExp(`url\\(#${esc}\\)`, 'g'), `url(#${idPrefix}-${id})`)
      .replace(new RegExp(`href="#${esc}"`, 'g'), `href="#${idPrefix}-${id}"`);
  }
  return svg;
}

// A diagram that draws from data gets it from a sibling <name>.props.json, if present.
async function loadProps(file) {
  const p = file.replace(/\.jsx?$/, '.props.json');
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}
