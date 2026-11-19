// Stand-in for the Claude Docs widget runtime, so chart modules render to static SVG at build time.
// <claude.Visualize sources={{name: {kind:'data', data:[…]}}}>{({name, datum}) => <svg …/>}</claude.Visualize>
// Only inline data sources are supported; a blob-backed chart must have its rows inlined first.
const datum = () => ({}); // interactive hover hooks in the editor; nothing to do in a static page

function Visualize({ sources = {}, children }) {
  const data = {};
  for (const [name, src] of Object.entries(sources)) {
    if (src?.kind !== 'data') throw new Error(`source "${name}" is kind "${src?.kind}"; inline its rows to build a static page`);
    data[name] = src.data;
  }
  return typeof children === 'function' ? children({ ...data, datum }) : children;
}

export const claude = { Visualize };
