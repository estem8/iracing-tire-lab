/**
 * A single self-contained HTML page for a ChartData: no network, no libraries.
 * The data is embedded as JSON in a non-executing script element, so the only
 * thing interpolated into the page is that JSON, with `<` escaped.
 */
import { CLIENT_SCRIPT } from './client.ts';
import type { ChartData } from './data.ts';

/** U+2028 and U+2029 end a line in older JavaScript, so they are escaped too. */
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

/** JSON that cannot close its script element or break the page. */
const embed = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .split(LINE_SEP)
    .join('\\u2028')
    .split(PARA_SEP)
    .join('\\u2029');

// Colours are the reference categorical palette, both modes checked with the
// dataviz validator. Three light slots (aqua, yellow, magenta) are under 3:1
// on the surface, so values are always reachable in the tooltip and table view.
const STYLE = `
:root {
  color-scheme: light dark;
  --page: #f9f9f7; --surface: #fcfcfb;
  --ink: #0b0b0b; --ink2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11, 11, 11, 0.10);
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100;
  --s5: #e87ba4; --s6: #008300; --s7: #6250d6; --s8: #e34948;
  --other: #898781;
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #0d0d0d; --surface: #1a1a19;
    --ink: #f0efec; --ink2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255, 255, 255, 0.10);
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
    --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 16px; }
h1 { font-size: 18px; font-weight: 600; margin: 0 0 2px; }
.sub, .hint, .note { color: var(--ink2); font-size: 13px; margin: 0; }
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0; }
.toolbar .hint { margin-left: 4px; }
button { font: inherit; color: var(--ink); background: var(--surface);
  border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
button:hover { background: var(--page); }
button.link { border: 0; background: none; color: var(--ink2); padding: 2px 6px; text-decoration: underline; }
button:focus-visible, canvas:focus-visible, input:focus-visible { outline: 2px solid var(--s1); outline-offset: 2px; }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 12px 12px 4px; margin: 0 0 12px; }
.cap { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.unit { font-size: 13px; font-weight: 600; color: var(--ink2); margin: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 6px 0 4px; }
.chip { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; cursor: pointer; color: var(--ink2); }
.chip.off { color: var(--muted); }
.chip.off .key { opacity: 0.3; }
.key { display: inline-block; width: 16px; height: 2px; border-radius: 1px; flex: none; }
.plot { position: relative; height: 200px; }
.plot.collapsed { height: 48px; }
.plot.collapsed canvas { display: none; }
canvas { display: block; width: 100%; height: 100%; touch-action: pan-y; }
.empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--muted); }
.tip { position: absolute; pointer-events: none; background: var(--surface); border: 1px solid var(--border);
  border-radius: 6px; padding: 6px 8px; font-size: 12px; white-space: nowrap; z-index: 2; }
.tip-t { color: var(--ink2); margin-bottom: 2px; }
.tip-r { display: flex; align-items: center; gap: 6px; }
.tip-v { color: var(--ink); font-weight: 600; }
.tip-n { color: var(--ink2); }
table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--grid); }
th[scope="col"] { color: var(--muted); font-weight: 500; font-size: 12px; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
#tires { max-width: 440px; margin: 0 0 16px; padding: 10px; border-radius: 16px; color: #fff;
  background: linear-gradient(180deg, rgb(0 0 0 / 0.82), rgb(6 44 48 / 0.82)); }
#tires h2 { margin: 0 0 2px; color: #fff; }
.tires-note { color: rgb(255 255 255 / 0.65); font-size: 11px; margin: 0 0 8px; }
.tire-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ot-card { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ot-row { display: flex; align-items: center; gap: 4px; }
.ot-side { flex: none; width: 2.6em; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 13px; }
.ot-press { display: flex; flex-direction: column; align-items: center; line-height: 1.1; }
.ot-press b { font-size: 0.9em; font-variant-numeric: tabular-nums; }
.ot-press span { font-size: 0.55em; font-weight: 700; text-transform: uppercase; color: rgb(255 255 255 / 0.5); }
.ot-tire { flex: 1; min-width: 0; display: flex; justify-content: center; }
.ot-tire svg { width: 100%; max-width: 110px; aspect-ratio: 5 / 7; overflow: visible; }
.ot-wear { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4%; padding: 0 9%; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; text-align: center; }
.ot-line { text-align: center; font-size: 10px; color: rgb(255 255 255 / 0.55); }
[hidden] { display: none !important; }
`;

export const renderChartHtml = (data: ChartData): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IBT telemetry chart</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <h1 id="title"></h1>
  <p class="sub" id="sub"></p>
  <div class="toolbar">
    <button type="button" id="reset">Reset zoom</button>
    <button type="button" id="table-toggle" aria-pressed="false">Table view</button>
    <span class="hint">Tick a series to show or hide it. Drag on a chart to zoom, double-click to reset. With a chart focused, arrow keys read values.</span>
  </div>
  <section id="tires" hidden></section>
  <div id="charts"></div>
  <section id="table" hidden>
    <table>
      <thead><tr>
        <th scope="col">Series</th><th scope="col">Unit</th>
        <th scope="col" class="num">Points</th><th scope="col" class="num">Missing</th>
        <th scope="col" class="num">Min</th><th scope="col" class="num">Mean</th><th scope="col" class="num">Max</th>
        <th scope="col" class="num">First</th><th scope="col" class="num">Last</th>
      </tr></thead>
      <tbody id="table-body"></tbody>
    </table>
    <p class="note">Summary over the plotted points only. Every record: <code>tire-lab export</code>.</p>
  </section>
</div>
<script type="application/json" id="data">${embed(data)}</script>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>
`;
