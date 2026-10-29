/**
 * The script inside the chart page. It is kept as one string so the page is a
 * single file with no outside requests.
 *
 * Rules for editing it: no backticks, no dollar-brace and no closing script
 * tag inside (the string is embedded verbatim); channel names are untrusted,
 * so text goes in with textContent, never innerHTML.
 */
export const CLIENT_SCRIPT = String.raw`
(function () {
  'use strict';
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var X = DATA.x;
  var N = X.length;
  var MAX_SLOTS = 8;
  var FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
  var root = document.documentElement;
  var state = { view: [X[0], X[N - 1]], cursor: -1, active: null, drag: null };
  var panels = [];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function css(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }
  function colors() {
    var s = [];
    for (var i = 1; i <= MAX_SLOTS; i++) s.push(css('--s' + i));
    return {
      surface: css('--surface'), ink2: css('--ink2'), muted: css('--muted'),
      grid: css('--grid'), axis: css('--axis'), s: s, other: css('--other')
    };
  }
  function colorOf(C, series) {
    return series.slot ? C.s[series.slot - 1] : C.other;
  }

  /* ---------- numbers ---------- */
  function trim(v, digits) { return String(Number(v.toPrecision(digits))); }
  function fmtVal(v) { return v === null ? '–' : trim(v, 6); }
  function fmtTick(v) {
    return Math.abs(v) >= 1000 ? trim(v / 1000, 3) + 'K' : trim(v, 4);
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function fmtTime(t, span) {
    if (span >= 120) {
      var s = Math.round(t);
      return Math.floor(s / 60) + ':' + pad2(s % 60);
    }
    return trim(t, 5);
  }
  function niceNum(range, round) {
    var exp = Math.floor(Math.log10(range));
    var f = range / Math.pow(10, exp);
    var nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }
  function niceTicks(lo, hi, count) {
    var range = hi - lo;
    if (!(range > 0) || !isFinite(range)) return [lo];
    var step = niceNum(niceNum(range, false) / (count - 1), true);
    if (!(step > 0) || !isFinite(step)) return [lo, hi];
    var out = [];
    for (var t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) {
      out.push(Math.round(t / step) * step);
    }
    return out;
  }
  function lowerBound(x) {
    var lo = 0, hi = N;
    while (lo < hi) {
      var m = (lo + hi) >> 1;
      if (X[m] < x) lo = m + 1; else hi = m;
    }
    return lo;
  }
  function nearestIndex(x) {
    var i = lowerBound(x);
    if (i <= 0) return 0;
    if (i >= N) return N - 1;
    return x - X[i - 1] <= X[i] - x ? i - 1 : i;
  }

  /* ---------- group series by unit: one chart per unit, never two axes ---------- */
  DATA.series.forEach(function (s) {
    var p = null;
    for (var i = 0; i < panels.length; i++) if (panels[i].unit === s.unit) p = panels[i];
    if (!p) { p = { unit: s.unit, series: [] }; panels.push(p); }
    // The colour is the series' place in its chart, fixed: switching others off never repaints it.
    var own = 0, slot = 0, like = '', k;
    for (k = 0; k < p.series.length; k++) if (!p.series[k].like) own++;
    if (s.like) {
      for (k = 0; k < p.series.length; k++) {
        if (p.series[k].name === s.like) { slot = p.series[k].slot; like = s.like; }
      }
    }
    if (!like) slot = own < MAX_SLOTS ? own + 1 : 0;
    p.series.push({ name: s.name, unit: s.unit, values: s.values, on: true, slot: slot, like: like, dashed: !!s.dashed });
  });

  /* ---------- drawing ---------- */
  function visible(p) { return p.series.filter(function (s) { return s.on; }); }

  function draw(p, C) {
    var cv = p.canvas;
    var W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    var dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    p.geom = null;
    var vis = visible(p);
    if (!vis.length) return;

    var L = 54, R = 14, T = 10, B = 22;
    var pw = W - L - R, ph = H - T - B;
    var v0 = state.view[0], v1 = state.view[1];
    var span = (v1 - v0) || 1;
    var i0 = Math.max(0, lowerBound(v0) - 1);
    var i1 = Math.min(N - 1, lowerBound(v1));

    var lo = Infinity, hi = -Infinity, i, k, v;
    for (k = 0; k < vis.length; k++) {
      for (i = i0; i <= i1; i++) {
        v = vis[k].values[i];
        if (v !== null) { if (v < lo) lo = v; if (v > hi) hi = v; }
      }
    }
    var empty = !isFinite(lo);
    if (empty) { lo = 0; hi = 1; }
    if (hi === lo) { lo -= 1; hi += 1; }
    var padY = (hi - lo) * 0.06;
    lo -= padY; hi += padY;
    p.geom = { L: L, T: T, pw: pw, ph: ph, lo: lo, hi: hi };

    function px(x) { return L + ((x - v0) / span) * pw; }
    function py(val) { return T + ((hi - val) / (hi - lo)) * ph; }

    ctx.font = FONT;
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.grid;
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    var yt = niceTicks(lo, hi, 5);
    for (i = 0; i < yt.length; i++) {
      var gy = Math.round(py(yt[i])) + 0.5;
      ctx.beginPath(); ctx.moveTo(L, gy); ctx.lineTo(L + pw, gy); ctx.stroke();
      ctx.fillText(fmtTick(yt[i]), L - 6, gy);
    }
    ctx.strokeStyle = C.axis;
    ctx.beginPath();
    ctx.moveTo(L, T + ph + 0.5); ctx.lineTo(L + pw, T + ph + 0.5);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    var xt = niceTicks(v0, v1, Math.max(2, Math.floor(pw / 90)));
    for (i = 0; i < xt.length; i++) {
      if (xt[i] < v0 || xt[i] > v1) continue;
      ctx.fillText(fmtTime(xt[i], span), px(xt[i]), H - 6);
    }

    if (empty) {
      ctx.fillStyle = C.muted;
      ctx.fillText('No data in this range', L + pw / 2, T + ph / 2);
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (k = 0; k < vis.length; k++) {
      ctx.strokeStyle = colorOf(C, vis[k]);
      ctx.setLineDash(vis[k].dashed ? [6, 4] : []);
      ctx.beginPath();
      var pen = false, lone = false, lx = 0, ly = 0;
      for (i = i0; i <= i1; i++) {
        v = vis[k].values[i];
        if (v === null) {
          if (pen && lone) ctx.lineTo(lx + 0.01, ly);
          pen = false;
          continue;
        }
        lx = px(X[i]); ly = py(v);
        if (!pen) { ctx.moveTo(lx, ly); pen = true; lone = true; }
        else { ctx.lineTo(lx, ly); lone = false; }
      }
      if (pen && lone) ctx.lineTo(lx + 0.01, ly);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    if (state.drag && state.drag.panel === p) {
      var a = Math.min(state.drag.x0, state.drag.x1), b = Math.max(state.drag.x0, state.drag.x1);
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = C.ink2;
      ctx.fillRect(Math.max(a, L), T, Math.min(b, L + pw) - Math.max(a, L), ph);
      ctx.globalAlpha = 1;
    }

    if (state.cursor >= 0 && X[state.cursor] >= v0 && X[state.cursor] <= v1) {
      var cx = Math.round(px(X[state.cursor])) + 0.5;
      ctx.strokeStyle = C.ink2;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, T); ctx.lineTo(cx, T + ph); ctx.stroke();
      for (k = 0; k < vis.length; k++) {
        v = vis[k].values[state.cursor];
        if (v === null) continue;
        // a 2px ring in the surface colour keeps the dot legible where lines cross
        ctx.fillStyle = C.surface;
        ctx.beginPath(); ctx.arc(cx, py(v), 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = colorOf(C, vis[k]);
        ctx.beginPath(); ctx.arc(cx, py(v), 4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function updateTips() {
    panels.forEach(function (p) {
      var show = state.cursor >= 0 && state.active === p && p.geom;
      if (!show) { p.tip.hidden = true; return; }
      var vis = visible(p);
      p.tip.textContent = '';
      p.tip.appendChild(el('div', 'tip-t', 'Time ' + X[state.cursor].toFixed(3) + ' s'));
      vis.forEach(function (s) {
        var row = el('div', 'tip-r');
        var key = el('i', 'key');
        key.style.background = s.slot ? 'var(--s' + s.slot + ')' : 'var(--other)';
        var val = el('b', 'tip-v', fmtVal(s.values[state.cursor]) + (s.unit && s.values[state.cursor] !== null ? ' ' + s.unit : ''));
        row.appendChild(key); row.appendChild(val); row.appendChild(el('span', 'tip-n', s.name));
        p.tip.appendChild(row);
      });
      p.tip.hidden = false;
      var g = p.geom, span = (state.view[1] - state.view[0]) || 1;
      var cx = g.L + ((X[state.cursor] - state.view[0]) / span) * g.pw;
      var w = p.tip.offsetWidth;
      var left = cx + 12;
      if (left + w > p.canvas.clientWidth - 4) left = Math.max(4, cx - w - 12);
      p.tip.style.left = left + 'px';
      p.tip.style.top = g.T + 4 + 'px';
    });
  }

  function redrawAll() {
    var C = colors();
    panels.forEach(function (p) { draw(p, C); });
    updateTips();
  }

  /* ---------- building the page ---------- */
  function setAll(p, on) {
    p.series.forEach(function (s) { s.on = on; s.cb.checked = on; s.lab.classList.toggle('off', !on); });
    refresh(p);
  }
  function refresh(p) {
    var any = visible(p).length > 0;
    p.plot.classList.toggle('collapsed', !any);
    p.empty.hidden = any;
    if (!any && state.active === p) { state.cursor = -1; state.active = null; }
    redrawAll();
  }
  function xAt(p, lx) {
    var g = p.geom;
    var t = state.view[0] + ((lx - g.L) / g.pw) * (state.view[1] - state.view[0]);
    return Math.min(state.view[1], Math.max(state.view[0], t));
  }
  function localX(e, p) { return e.clientX - p.canvas.getBoundingClientRect().left; }
  function resetZoom() { state.view = [X[0], X[N - 1]]; redrawAll(); }
  function moveCursor(p, to) {
    var a = nearestIndex(state.view[0]), b = nearestIndex(state.view[1]);
    state.cursor = Math.min(b, Math.max(a, to));
    state.active = p;
    redrawAll();
  }

  function buildPanel(p) {
    var fig = el('figure', 'panel');
    var cap = el('figcaption', 'cap');
    cap.appendChild(el('h2', 'unit', p.unit || '(no unit)'));
    var bulk = el('span', 'bulk');
    var all = el('button', 'link', 'All'); all.type = 'button';
    var none = el('button', 'link', 'None'); none.type = 'button';
    all.addEventListener('click', function () { setAll(p, true); });
    none.addEventListener('click', function () { setAll(p, false); });
    bulk.appendChild(all); bulk.appendChild(none);
    cap.appendChild(bulk);
    fig.appendChild(cap);

    var chips = el('div', 'chips');
    p.series.forEach(function (s) {
      var lab = el('label', 'chip');
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = true;
      var key = el('span', 'key');
      key.style.background = s.slot ? 'var(--s' + s.slot + ')' : 'var(--other)';
      lab.appendChild(cb); lab.appendChild(key); lab.appendChild(el('span', 'name', s.name));
      cb.addEventListener('change', function () {
        s.on = cb.checked;
        lab.classList.toggle('off', !s.on);
        refresh(p);
      });
      s.cb = cb; s.lab = lab;
      chips.appendChild(lab);
    });
    fig.appendChild(chips);
    if (p.series.some(function (s) { return !s.slot; })) {
      fig.appendChild(el('p', 'note', 'More than ' + MAX_SLOTS + ' series: the rest share one grey. The tooltip names every series.'));
    }

    var plot = el('div', 'plot');
    var cv = document.createElement('canvas');
    cv.tabIndex = 0;
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', (p.unit || 'no unit') + ' chart of ' + p.series.length + ' series. Arrow keys read values; the Table view lists every series.');
    var tip = el('div', 'tip'); tip.hidden = true;
    var empty = el('div', 'empty', 'No series shown. Tick one above.'); empty.hidden = true;
    plot.appendChild(cv); plot.appendChild(tip); plot.appendChild(empty);
    fig.appendChild(plot);

    p.canvas = cv; p.tip = tip; p.empty = empty; p.plot = plot; p.fig = fig;

    cv.addEventListener('pointermove', function (e) {
      if (!p.geom) return;
      if (state.drag && state.drag.panel === p) { state.drag.x1 = localX(e, p); redrawAll(); return; }
      moveCursor(p, nearestIndex(xAt(p, localX(e, p))));
    });
    cv.addEventListener('pointerleave', function () {
      if (state.drag) return;
      state.cursor = -1; state.active = null; redrawAll();
    });
    cv.addEventListener('pointerdown', function (e) {
      if (!p.geom || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var lx = localX(e, p);
      state.drag = { panel: p, x0: lx, x1: lx };
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable: drag still works inside the canvas */ }
    });
    cv.addEventListener('pointerup', function (e) {
      var d = state.drag;
      if (!d) return;
      state.drag = null;
      if (p.geom && Math.abs(d.x1 - d.x0) > 8) {
        var a = xAt(p, Math.min(d.x0, d.x1)), b = xAt(p, Math.max(d.x0, d.x1));
        if (b > a) state.view = [a, b];
      }
      redrawAll();
    });
    cv.addEventListener('dblclick', resetZoom);
    cv.addEventListener('focus', function () {
      if (state.cursor < 0) moveCursor(p, nearestIndex((state.view[0] + state.view[1]) / 2));
      else { state.active = p; redrawAll(); }
    });
    cv.addEventListener('blur', function () {
      state.cursor = -1; state.active = null; redrawAll();
    });
    cv.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 10 : 1, handled = true;
      var from = state.cursor < 0 ? nearestIndex((state.view[0] + state.view[1]) / 2) : state.cursor;
      if (e.key === 'ArrowLeft') moveCursor(p, from - step);
      else if (e.key === 'ArrowRight') moveCursor(p, from + step);
      else if (e.key === 'Home') moveCursor(p, 0);
      else if (e.key === 'End') moveCursor(p, N - 1);
      else if (e.key === 'Escape') { state.cursor = -1; state.active = null; redrawAll(); }
      else handled = false;
      if (handled) e.preventDefault();
    });
    return fig;
  }

  function buildTable() {
    var table = document.getElementById('table-body');
    panels.forEach(function (p) {
      p.series.forEach(function (s) {
        var n = 0, nulls = 0, min = Infinity, max = -Infinity, sum = 0, first = null, last = null;
        s.values.forEach(function (v) {
          if (v === null) { nulls++; return; }
          n++; sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
          if (first === null) first = v;
          last = v;
        });
        var tr = document.createElement('tr');
        [s.name, s.unit || '', String(n), String(nulls),
         n ? fmtVal(min) : '–', n ? fmtVal(sum / n) : '–', n ? fmtVal(max) : '–',
         fmtVal(first), fmtVal(last)].forEach(function (text, i) {
          var td = el(i === 0 ? 'th' : 'td', i > 1 ? 'num' : '', text);
          if (i === 0) td.scope = 'row';
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
    });
  }

  document.getElementById('title').textContent = DATA.title;
  document.getElementById('sub').textContent =
    N + ' points' +
    (DATA.stride > 1 ? ' (every ' + DATA.stride + ' records of ' + DATA.records + '; a spike narrower than that can fall between points)' : ' (every record)') +
    '. Recorded at ' + DATA.tickRate + ' Hz. x: ' + DATA.xName + ', seconds.';

  var chartsEl = document.getElementById('charts');
  panels.forEach(function (p) { chartsEl.appendChild(buildPanel(p)); });
  buildTable();

  document.getElementById('reset').addEventListener('click', resetZoom);
  var toggle = document.getElementById('table-toggle');
  toggle.addEventListener('click', function () {
    var on = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? 'Chart view' : 'Table view';
    chartsEl.hidden = on;
    document.getElementById('table').hidden = !on;
    if (!on) redrawAll();
  });

  if (window.ResizeObserver) new ResizeObserver(redrawAll).observe(chartsEl);
  else window.addEventListener('resize', redrawAll);
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawAll);
  } catch (err) { /* old browser: colours update on the next redraw */ }
  redrawAll();
})();
`;
