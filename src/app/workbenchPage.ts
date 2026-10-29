/**
 * The workbench page: the components of the overlay's tire model with what
 * they do, a switch and the numbers behind each, a picker for the recording's
 * channels, and the chart that answers. Every value from the file or the model
 * goes in as text, never as markup.
 */
export const WORKBENCH_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tire Lab workbench</title>
<style>
:root { --bg: #fff; --ink: #111827; --ink2: #4b5563; --line: #d1d5db; --accent: #1d4ed8; --card: #f3f4f6; --warn: #92400e; --ok: #166534; --bad: #b91c1c; }
@media (prefers-color-scheme: dark) { :root { --bg: #111827; --ink: #f3f4f6; --ink2: #9ca3af; --line: #374151; --accent: #60a5fa; --card: #1f2937; --warn: #fbbf24; --ok: #4ade80; --bad: #f87171; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.45 system-ui, sans-serif; }
header { padding: 12px 16px; border-bottom: 1px solid var(--line); }
h1 { font-size: 18px; margin: 0; }
.muted { color: var(--ink2); font-size: 12px; }
.layout { display: grid; grid-template-columns: minmax(320px, 440px) 1fr; gap: 16px; padding: 12px 16px; align-items: start; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
.side { max-height: calc(100vh - 90px); overflow: auto; padding-right: 6px; }
.main { position: sticky; top: 8px; }
iframe { width: 100%; height: calc(100vh - 150px); min-height: 480px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
details { background: var(--card); border: 1px solid var(--line); border-radius: 8px; margin: 0 0 8px; }
summary { padding: 8px 10px; cursor: pointer; display: flex; gap: 8px; align-items: center; }
summary .t { font-weight: 600; flex: 1; }
.badge { font-size: 11px; color: var(--ink2); border: 1px solid var(--line); border-radius: 10px; padding: 0 7px; }
.body { padding: 0 10px 10px; }
.body p { margin: 4px 0; }
.lbl { font-weight: 600; font-size: 12px; color: var(--ink2); }
.ins { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; margin: 2px 0 6px; }
.in-ok { color: var(--ok); } .in-no { color: var(--bad); }
.param { display: grid; grid-template-columns: 1fr 110px; gap: 2px 8px; align-items: center; padding: 4px 0; border-top: 1px solid var(--line); }
.param .d { grid-column: 1 / -1; color: var(--ink2); font-size: 12px; }
.param.changed .n { color: var(--accent); font-weight: 600; }
.dim { opacity: .45; }
input[type=number], input[type=search] { font: inherit; width: 100%; padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--ink); }
button { font: inherit; border: 1px solid var(--line); border-radius: 6px; padding: 5px 10px; background: var(--bg); color: var(--ink); cursor: pointer; }
.chans { max-height: 220px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; margin-top: 6px; }
.chans label { display: flex; gap: 6px; align-items: baseline; }
table { border-collapse: collapse; font-size: 12px; margin: 6px 0; }
th, td { border-bottom: 1px solid var(--line); padding: 2px 10px; text-align: right; }
th:first-child, td:first-child { text-align: left; }
#err { color: var(--bad); }
</style>
</head>
<body>
<header>
  <h1>Model workbench</h1>
  <div class="muted" id="car"></div>
  <div class="muted" id="shown"></div>
</header>
<div class="layout">
  <div class="side">
    <details open id="chdet"><summary><span class="t">Channels from the recording</span><span class="badge" id="chcount"></span></summary>
      <div class="body">
        <p class="muted">Tick the channels to chart beside the model. The defaults are the tire temperatures and the signals that drive the heat.</p>
        <input type="search" id="chfilter" placeholder="Filter by name or description">
        <div class="chans" id="chans"></div>
      </div>
    </details>
    <div class="row"><button id="reset" type="button">Reset everything</button> <span class="muted" id="status"></span></div>
    <p class="muted">Dotted lines are the unchanged model, dashed lines the model as you have changed it. Switching a component off sets its heat coefficients to zero.</p>
    <div id="comps"></div>
  </div>
  <div class="main">
    <div id="summary"></div>
    <p id="err" role="alert"></p>
    <iframe id="frame" sandbox="allow-scripts" title="Chart"></iframe>
  </div>
</div>
<script>
(function () {
  var token = new URLSearchParams(location.search).get('t') || '';
  var $ = function (id) { return document.getElementById(id); };
  var info = null, values = {}, off = {}, chosen = {}, timer = null, runId = 0;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function api(path, body) {
    var opts = body === undefined ? { headers: { 'x-token': token } }
      : { method: 'POST', headers: { 'x-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body) };
    return fetch(path, opts).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.statusText); return j; }); });
  }
  function fmt(v) { return String(Number(v.toPrecision(5))); }
  function schedule() { clearTimeout(timer); $('status').textContent = 'changed'; timer = setTimeout(run, 500); }

  function run() {
    var id = ++runId;
    $('status').textContent = 'running…';
    $('err').textContent = '';
    var req = { values: values, off: Object.keys(off).filter(function (k) { return off[k]; }), channels: Object.keys(chosen).filter(function (k) { return chosen[k]; }) };
    api('/api/workbench', req).then(function (r) {
      if (id !== runId) return;
      $('status').textContent = 'done';
      $('frame').src = '/workbench/chart?t=' + encodeURIComponent(token) + '&n=' + id;
      showSummary(r.difference);
    }).catch(function (e) { if (id !== runId) return; $('status').textContent = ''; $('err').textContent = e.message; });
  }
  function showSummary(rows) {
    var box = $('summary'); box.textContent = '';
    var changed = Object.keys(values).length > 0 || Object.keys(off).some(function (k) { return off[k]; });
    if (!changed) { box.appendChild(el('p', 'muted', 'Nothing changed: the dashed lines lie on the dotted ones.')); return; }
    var t = el('table'), h = el('tr');
    ['Changed minus unchanged, deg C', 'mean |diff|', 'largest |diff|', 'mean', 'at the end'].forEach(function (x) { h.appendChild(el('th', '', x)); });
    t.appendChild(h);
    rows.forEach(function (r) {
      var tr = el('tr'), s = r.stats;
      tr.appendChild(el('td', '', r.corner.toUpperCase()));
      [s.mae, s.max, s.bias, r.last].forEach(function (v) { tr.appendChild(el('td', '', v === null ? '–' : v.toFixed(1))); });
      t.appendChild(tr);
    });
    box.appendChild(t);
  }

  function buildChannels() {
    var q = $('chfilter').value.trim().toLowerCase(), box = $('chans'); box.textContent = '';
    var shown = 0;
    info.channels.forEach(function (c) {
      if (q && (c.name + ' ' + c.desc).toLowerCase().indexOf(q) < 0) return;
      if (shown++ >= 300) return;
      var lab = el('label'), cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = !!chosen[c.name];
      cb.addEventListener('change', function () { chosen[c.name] = cb.checked; updateCount(); schedule(); });
      lab.appendChild(cb);
      lab.appendChild(el('span', '', c.name + (c.unit ? ' [' + c.unit + ']' : '')));
      if (c.desc) lab.appendChild(el('span', 'muted', c.desc));
      box.appendChild(lab);
    });
    if (shown > 300) box.appendChild(el('p', 'muted', 'More channels match; narrow the filter.'));
    updateCount();
  }
  function updateCount() { $('chcount').textContent = Object.keys(chosen).filter(function (k) { return chosen[k]; }).length + ' of ' + info.channels.length; }

  function buildComponents() {
    var root = $('comps'); root.textContent = '';
    info.description.components.forEach(function (c) {
      var d = el('details'), s = el('summary');
      if (c.switchable) {
        var sw = document.createElement('input'); sw.type = 'checkbox'; sw.checked = !off[c.id]; sw.title = 'Switch this component on or off';
        sw.addEventListener('click', function (e) { e.stopPropagation(); });
        sw.addEventListener('change', function () { off[c.id] = !sw.checked; d.classList.toggle('dim', !sw.checked); schedule(); });
        s.appendChild(sw);
      }
      s.appendChild(el('span', 't', c.title));
      s.appendChild(el('span', 'badge', c.model));
      d.appendChild(s);
      var b = el('div', 'body');
      b.appendChild(el('p', '', c.what));
      var how = el('p'); how.appendChild(el('span', 'lbl', 'How: ')); how.appendChild(document.createTextNode(c.how)); b.appendChild(how);
      if (c.inputs.length) {
        var ins = el('div', 'ins'); ins.appendChild(el('span', 'lbl', 'Reads: '));
        c.inputs.forEach(function (n) {
          var a = info.availability[n], span = el('span', a ? (a.present ? 'in-ok' : 'in-no') : '', n + (a ? (a.present ? ' ✓' + (a.unit ? ' [' + a.unit + ']' : '') : ' ✗ not in this file') : ''));
          ins.appendChild(span);
        });
        b.appendChild(ins);
      }
      c.params.forEach(function (p) {
        var row = el('div', 'param'), inp = document.createElement('input');
        row.appendChild(el('span', 'n', p.label + (p.unit ? ' (' + p.unit + ')' : '')));
        inp.type = 'number'; inp.step = 'any'; inp.min = '0'; inp.value = fmt(values[p.id] !== undefined ? values[p.id] : p.default);
        inp.addEventListener('input', function () {
          var v = parseFloat(inp.value);
          if (!isFinite(v) || v === p.default) delete values[p.id]; else values[p.id] = v;
          row.classList.toggle('changed', values[p.id] !== undefined);
          schedule();
        });
        row.appendChild(inp);
        row.appendChild(el('span', 'd', p.description + ' Default ' + fmt(p.default) + '.'));
        b.appendChild(row);
      });
      d.appendChild(b);
      root.appendChild(d);
    });
  }

  $('chfilter').addEventListener('input', buildChannels);
  $('reset').addEventListener('click', function () { values = {}; off = {}; buildComponents(); schedule(); });
  api('/api/tuning').then(function (i) {
    info = i;
    $('car').textContent = 'Car: ' + (i.description.car || 'not named in the file (default profile)');
    $('shown').textContent = 'The number the overlay shows comes from ' + i.description.shownBy;
    i.defaultChannels.forEach(function (n) { chosen[n] = true; });
    buildChannels(); buildComponents(); run();
  }).catch(function (e) { $('err').textContent = e.message; });
})();
</script>
</body>
</html>
`;
