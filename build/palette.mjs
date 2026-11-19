// Claude Docs widget colours → benelabs.tech's strict black-and-white ramp (see the site's brand.md).
// Categorical colours become greys of decreasing weight, so series stay distinguishable by tone.
// The build warns about any --cds-* variable missing here; add it rather than guessing in the diagram.
export const PALETTE = {
  '--cds-text-primary': '#171717',
  '--cds-text-secondary': '#525252',
  '--cds-text-tertiary': '#737373',
  '--cds-chart-axis': '#737373',
  '--cds-chart-grid': '#e2e2e2',
  '--cds-chart-categorical-1': '#000000',
  '--cds-chart-categorical-2': '#525252',
  '--cds-chart-categorical-3': '#8a8a8a',
  '--cds-chart-categorical-4': '#b0b0b0',
  '--cds-chart-categorical-5': '#2e2e2e',
  '--cds-chart-categorical-6': '#6b6b6b',
  '--cds-chart-categorical-7': '#a3a3a3',
  '--cds-chart-categorical-8': '#c7c7c7',
  '--cds-chart-muted': '#b0b0b0',
  '--cds-chart-reference': '#171717',
  '--cds-chart-reference-tint': '#efefef',
  '--cds-chart-status-critical': '#000000',
  '--cds-chart-status-warning': '#525252',
  '--cds-chart-status-good': '#8a8a8a',
  '--cds-bg-primary': '#ffffff',
  '--cds-bg-secondary': '#f7f7f7',
  '--cds-border': '#e2e2e2',
};
