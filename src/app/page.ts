/**
 * The control page of the app: open a file, see whether iRacing runs, switch
 * iRacing's telemetry recording. One self-contained page, no outside requests;
 * every value from a file or the system goes in as text, never as markup.
 */
export const CONTROL_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tire Lab</title>
<style>
:root { --bg: #fff; --ink: #111827; --ink2: #4b5563; --line: #d1d5db; --accent: #1d4ed8; --card: #f3f4f6; --warn: #92400e; --ok: #166534; }
@media (prefers-color-scheme: dark) { :root { --bg: #111827; --ink: #f3f4f6; --ink2: #9ca3af; --line: #374151; --accent: #60a5fa; --card: #1f2937; --warn: #fbbf24; --ok: #4ade80; } }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 640px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 0 0 8px; }
p { margin: 0 0 8px; }
.muted { color: var(--ink2); font-size: 13px; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-top: 16px; }
button, input[type=text], select { font: inherit; border-radius: 8px; border: 1px solid var(--line); padding: 8px 12px; background: var(--bg); color: var(--ink); }
button { cursor: pointer; }
button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
button:disabled { opacity: .5; cursor: default; }
input[type=text] { width: 100%; box-sizing: border-box; margin: 8px 0; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.switch { display: flex; gap: 10px; align-items: center; cursor: pointer; }
.switch input { width: 20px; height: 20px; }
#error { color: var(--warn); }
.ok { color: var(--ok); }
a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Tire Lab</h1>
  <p class="muted">Runs on this computer only. Close this page and the console window to quit.</p>

  <section>
    <h2>Open a telemetry file</h2>
    <div class="row">
      <button id="pick" class="primary" type="button">Open .ibt file…</button>
    </div>
    <p class="muted">Or paste the path of a file (the sim writes them to Documents\\iRacing\\telemetry):</p>
    <input id="path" type="text" placeholder="C:\\Users\\you\\Documents\\iRacing\\telemetry\\car\\file.ibt" autocomplete="off">
    <div class="row"><button id="open" type="button">Open this path</button></div>
    <p id="result"></p>
    <p id="error" role="alert"></p>
  </section>

  <section id="benchsection" hidden>
    <h2>Model workbench</h2>
    <p class="muted">See what the overlay\u2019s tire model is made of, switch its components on and off, change its numbers and watch the estimate respond. Pick which channels of the file to chart beside it.</p>
    <div class="row"><button id="openbench" type="button">Open the workbench</button></div>
  </section>

  <section id="lapsection" hidden>
    <h2>Laps</h2>
    <p class="muted">Chart a lap by distance round the track. Pick a second lap to compare: it is drawn dashed over the first, with the time difference below.</p>
    <div class="row">
      <label>Lap <select id="lapa"></select></label>
      <label>compare with <select id="lapb"></select></label>
      <button id="openlap" type="button">Chart the lap</button>
    </div>
    <p id="lapnote" class="muted"></p>
  </section>

  <section id="reportsection" hidden>
    <h2>Report a problem</h2>
    <p class="muted">Found a value that does not match the game, a wrong channel or lap, or a failure? Build a report you can read before you save it. Nothing is sent anywhere: you save a file and attach it to an issue yourself. It holds the model\u2019s inputs for the run up to that moment (the temperature depends on the whole run), as plain numbers, with no names, ids, dates or session text.</p>
    <label>What is wrong
      <select id="rkind">
        <option value="mismatch">A tire value does not match the game</option>
        <option value="channel">A channel or its unit is wrong</option>
        <option value="laps">The laps are wrong</option>
        <option value="bug">The program failed</option>
      </select>
    </label>
    <p></p>
    <label>Session time of the moment, seconds <input id="rtime" type="number" min="0" step="any" placeholder="read it off the chart, or pick a lap start below"></label>
    <div class="row"><label>or start of lap <select id="rlap"><option value="">(none)</option></select></label></div>
    <p class="muted">What the game showed at that moment (leave empty if it is not about a value):</p>
    <div id="robs"></div>
    <div class="row"><button id="radd" type="button">Add a value</button></div>
    <p></p>
    <label>Anything else (no names or other personal details; up to 2000 characters)
      <textarea id="rnote" rows="3" maxlength="2000" style="width:100%;box-sizing:border-box"></textarea>
    </label>
    <label class="switch"><input id="rbench" type="checkbox" checked><span>Include the workbench settings I last ran</span></label>
    <div class="row"><button id="rpreview" type="button">Show what will be saved</button></div>
    <p id="rsize" class="muted"></p>
    <pre id="rpre" hidden style="max-height:320px;overflow:auto;white-space:pre-wrap;font-size:12px"></pre>
    <div class="row"><button id="rsave" type="button" class="primary" disabled>Save the report</button></div>
    <p id="rsaved"></p>
  </section>

  <section>
    <h2>iRacing</h2>
    <p id="sim" class="muted">Checking…</p>
    <label class="switch"><input id="rec" type="checkbox"><span>Record telemetry in iRacing</span></label>
    <p class="muted">This sends iRacing the command to start or stop writing an .ibt file, like its own recording key. iRacing only records while you are in the car, and this page cannot read back whether it is recording: it shows the last command it sent.</p>
    <p id="recstate" class="muted"></p>
  </section>

  <section>
    <button id="quit" type="button">Quit Tire Lab</button>
  </section>
</main>
<script>
(function () {
  var token = new URLSearchParams(location.search).get('t') || '';
  var $ = function (id) { return document.getElementById(id); };
  function api(path, body) {
    var opts = body === undefined
      ? { headers: { 'x-token': token } }
      : { method: 'POST', headers: { 'x-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body) };
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.statusText); return j; });
    });
  }
  function fail(e) { $('error').textContent = e && e.message ? e.message : String(e); }
  $('openbench').addEventListener('click', function () {
    window.open('/workbench?t=' + encodeURIComponent(token), '_blank');
  });
  // ---- the report form
  function obsRow() {
    var row = document.createElement('div'); row.className = 'row'; row.style.marginBottom = '6px';
    var corner = document.createElement('select');
    [['lf', 'Left front'], ['rf', 'Right front'], ['lr', 'Left rear'], ['rr', 'Right rear']].forEach(function (c) { var o = document.createElement('option'); o.value = c[0]; o.textContent = c[1]; corner.appendChild(o); });
    var qty = document.createElement('select');
    [['carcass', 'temperature (dash)'], ['tread', 'tread surface temperature'], ['pressure', 'pressure, kPa']].forEach(function (c) { var o = document.createElement('option'); o.value = c[0]; o.textContent = c[1]; qty.appendChild(o); });
    var val = document.createElement('input'); val.type = 'number'; val.step = 'any'; val.placeholder = 'value'; val.style.width = '7em';
    var src = document.createElement('select');
    [['dash', 'cockpit readout'], ['pit-reading', 'pit-stop reading'], ['other', 'other']].forEach(function (c) { var o = document.createElement('option'); o.value = c[0]; o.textContent = c[1]; src.appendChild(o); });
    [corner, qty, val, src].forEach(function (e) { row.appendChild(e); });
    row.read = function () { return val.value === '' ? null : { corner: corner.value, quantity: qty.value, value: parseFloat(val.value), source: src.value }; };
    return row;
  }
  var previewDigest = '';
  function reportBody() {
    var obs = [];
    $('robs').childNodes.forEach(function (r) { var o = r.read(); if (o) obs.push(o); });
    return { kind: $('rkind').value, t: parseFloat($('rtime').value), observed: obs, note: $('rnote').value, includeWorkbench: $('rbench').checked };
  }
  $('radd').addEventListener('click', function () { if ($('robs').childNodes.length < 8) $('robs').appendChild(obsRow()); });
  $('radd').click();
  $('rlap').addEventListener('change', function () { if ($('rlap').value !== '') $('rtime').value = $('rlap').value; });
  ['rkind', 'rtime', 'rnote', 'rbench'].forEach(function (id) { $(id).addEventListener('input', function () { $('rsave').disabled = true; $('rsaved').textContent = ''; }); });
  $('rpreview').addEventListener('click', function () {
    $('error').textContent = '';
    api('/api/report/preview', reportBody()).then(function (r) {
      $('rpre').hidden = false; $('rpre').textContent = JSON.stringify(r.preview, null, 2);
      $('rsize').textContent = 'Saved size: ' + (r.bytes / 1048576).toFixed(2) + ' MB compressed (' + (r.rawBytes / 1048576).toFixed(1) + ' MB as text). ' + (r.hasWorkbench ? '' : 'No workbench settings have been run.');
      previewDigest = r.digest;
      $('rsave').disabled = false;
    }).catch(function (e) { $('rsave').disabled = true; fail(e); });
  });
  $('rsave').addEventListener('click', function () {
    var body = reportBody(); body.digest = previewDigest;
    api('/api/report/save', body).then(function (r) {
      var out = $('rsaved'); out.textContent = 'Saved ' + r.path + ' (' + (r.bytes / 1048576).toFixed(2) + ' MB). Attach it to the issue. ';
      var a = document.createElement('a'); a.href = r.issueUrl; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open the issue form on GitHub';
      out.appendChild(a); $('rsave').disabled = true;
    }).catch(fail);
  });
  function showReport(f) {
    $('reportsection').hidden = !f;
    var sel = $('rlap'); sel.textContent = '';
    var none = document.createElement('option'); none.value = ''; none.textContent = '(none)'; sel.appendChild(none);
    ((f && f.laps) || []).forEach(function (l) { var o = document.createElement('option'); o.value = String(l.startS); o.textContent = 'Lap ' + l.lap; sel.appendChild(o); });
  }
  function showFile(f) {
    showReport(f);
    $('benchsection').hidden = !f;
    showLaps(f);
    var out = $('result');
    out.textContent = '';
    if (!f) return;
    var link = document.createElement('a');
    link.href = '/chart?t=' + encodeURIComponent(token);
    link.target = '_blank';
    link.textContent = 'Open the chart of ' + f.name;
    out.appendChild(link);
    out.appendChild(document.createTextNode(' (' + f.records + ' records' + (f.car ? ', ' + f.car : '') + ')'));
    if (f.note) {
      var n = document.createElement('div');
      n.className = 'muted';
      n.textContent = f.note;
      out.appendChild(n);
    }
  }
  function lapLabel(l, best) {
    var t = l.timeS === null ? (l.complete ? '' : ' (partial)') : ' ' + Math.floor(l.timeS / 60) + ':' + (l.timeS % 60 < 10 ? '0' : '') + (l.timeS % 60).toFixed(3);
    return 'Lap ' + l.lap + t + (l.timeS !== null && l.timeS === best ? ' (fastest)' : '');
  }
  function showLaps(f) {
    var sec = $('lapsection'), a = $('lapa'), b = $('lapb');
    var laps = f && f.laps ? f.laps : [];
    sec.hidden = false;
    a.textContent = ''; b.textContent = '';
    if (laps.length === 0) {
      $('lapnote').textContent = f ? 'No laps found: the file needs a LapDistPct channel.' : '';
      sec.hidden = !f;
      $('openlap').disabled = true;
      return;
    }
    $('openlap').disabled = false;
    $('lapnote').textContent = '';
    var times = laps.filter(function (l) { return l.timeS !== null; }).map(function (l) { return l.timeS; });
    var best = times.length ? Math.min.apply(null, times) : null;
    var none = document.createElement('option'); none.value = ''; none.textContent = '(no comparison)'; b.appendChild(none);
    var fastest = laps.filter(function (l) { return l.timeS === best && best !== null; })[0] || laps[0];
    laps.forEach(function (l) {
      [a, b].forEach(function (sel) {
        var o = document.createElement('option'); o.value = String(l.lap); o.textContent = lapLabel(l, best); sel.appendChild(o);
      });
    });
    a.value = String(fastest.lap);
  }
  $('openlap').addEventListener('click', function () {
    var q = '/lapchart?t=' + encodeURIComponent(token) + '&a=' + encodeURIComponent($('lapa').value);
    if ($('lapb').value !== '') q += '&b=' + encodeURIComponent($('lapb').value);
    window.open(q, '_blank');
  });
  function opened(f) { $('error').textContent = ''; showFile(f); window.open('/chart?t=' + encodeURIComponent(token), '_blank'); }
  function status() {
    api('/api/status').then(function (s) {
      $('sim').textContent = s.iracing
        ? 'iRacing is running.'
        : 'iRacing was not found running. The switch still sends the command; it only has an effect while the sim runs.';
      $('rec').disabled = !s.canControl;
      if (!s.canControl) $('recstate').textContent = 'The switch only works on Windows.';
      if (s.lastCommand) $('recstate').textContent = 'Last command sent: ' + s.lastCommand + '. iRacing records only while you are in the car.';
      showFile(s.file);
    }).catch(fail);
  }
  $('pick').addEventListener('click', function () {
    $('pick').disabled = true;
    api('/api/pick', {}).then(function (r) { if (r.file) opened(r.file); }).catch(fail).then(function () { $('pick').disabled = false; });
  });
  $('open').addEventListener('click', function () {
    api('/api/open', { path: $('path').value.trim() }).then(function (r) { opened(r.file); }).catch(fail);
  });
  $('rec').addEventListener('change', function () {
    var on = $('rec').checked;
    api('/api/telemetry', { command: on ? 'start' : 'stop' }).then(function (r) {
      $('recstate').textContent = 'Last command sent: ' + r.lastCommand + '. iRacing records only while you are in the car.';
    }).catch(function (e) { $('rec').checked = !on; fail(e); });
  });
  $('quit').addEventListener('click', function () {
    api('/api/quit', {}).then(function () { document.body.textContent = 'Tire Lab has quit. You can close this tab.'; });
  });
  status();
})();
</script>
</body>
</html>
`;
