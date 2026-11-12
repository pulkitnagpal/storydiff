(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.getElementById('board');
  var specEl = document.getElementById('spec');
  var state = { ex: 0, step: 0, lvl: 'plain', doc: null, lay: null, error: '', ov: true };
  var SYM = { new: '+', changed: '~', gone: '−', untouched: '=', watch: '!' };
  var WORD = { new: 'New', changed: 'Changed', gone: 'Gone', untouched: 'Not changed', watch: 'Watch' };

  function tok(name) { return getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim(); }
  function colors() {
    return { ink: tok('ink'), body: tok('body'), muted: tok('muted'), line: tok('line'), card: tok('card'), paper: tok('board'),
      new: tok('new'), newSoft: tok('new-soft'), chg: tok('chg'), chgSoft: tok('chg-soft'), gone: tok('gone'), watch: tok('watch'), watchSoft: tok('watch-soft'), sticky: tok('sticky') };
  }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function seedOf(s) { var h = 7; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 2147483; return h + 1; }
  var rc = null;
  function sketch(kind, args, opts, seedKey, parent) {
    opts = Object.assign({ roughness: 0.9, bowing: 0.8, seed: seedOf(seedKey) }, opts);
    var node;
    if (rc) node = rc[kind].apply(rc, args.concat([opts]));
    else {
      node = document.createElementNS(NS, 'g');
      var p;
      if (kind === 'rectangle') p = el('rect', { x: args[0], y: args[1], width: args[2], height: args[3], rx: 10 });
      else if (kind === 'ellipse') p = el('ellipse', { cx: args[0], cy: args[1], rx: args[2] / 2, ry: args[3] / 2 });
      else p = el('path', { d: args[0] });
      p.setAttribute('fill', opts.fill || 'none'); p.setAttribute('stroke', opts.stroke || 'none'); p.setAttribute('stroke-width', opts.strokeWidth || 1);
      if (opts.strokeLineDash) p.setAttribute('stroke-dasharray', opts.strokeLineDash.join(' '));
      node.appendChild(p);
    }
    parent.appendChild(node);
    return node;
  }
  function text(parent, x, y, str, style, anchor) {
    var t = el('text', { x: x, y: y, 'text-anchor': anchor || 'middle', style: style }, parent);
    t.textContent = str; return t;
  }
  function wrap(str, max) {
    var words = str.split(' '), lines = [''], cur = 0;
    words.forEach(function (w) { if ((lines[cur] + ' ' + w).trim().length > max && lines[cur]) { lines.push(w); cur++; } else lines[cur] = (lines[cur] + ' ' + w).trim(); });
    return lines.slice(0, 2);
  }
  function wrap3(str, max) {
    var words = str.split(' '), lines = [''];
    words.forEach(function (w) { var c = lines.length - 1; if ((lines[c] + ' ' + w).trim().length > max && lines[c]) lines.push(w); else lines[c] = (lines[c] + ' ' + w).trim(); });
    if (lines.length > 3) { lines = lines.slice(0, 3); lines[2] = lines[2].replace(/\s*\S*$/, '') + '…”'; }
    return lines;
  }
  function upTo(arr, s) { return arr.some(function (k) { return k && k <= s; }); }

  function nodeState(n, s) {
    if (n.born > s) return null;
    var st = { gone: n.died && n.died <= s, born: n.born, changed: upTo(n.changed, s), watch: upTo(n.watch, s), untouched: upTo(n.untouched, s) };
    st.badge = st.watch ? 'watch' : st.gone ? 'gone' : n.born ? 'new' : st.changed ? 'changed' : st.untouched ? 'untouched' : '';
    return st;
  }

  function drawNode(g, n, b, st, C, current, entering) {
    var stroke = C.ink, fill = C.card, dash = null, sw = 1.8;
    if (n.born) { stroke = C.new; fill = C.newSoft; }
    if (st.changed) stroke = C.chg;
    if (st.untouched) { stroke = C.muted; fill = 'none'; dash = [6, 6]; }
    if (st.watch) { stroke = C.watch; sw = 2.4; }
    if (st.gone) { stroke = C.gone; fill = 'none'; dash = [7, 7]; }
    var wrapG = el('g', { class: entering ? 'enter' : '' }, g);
    if (current) el('rect', { x: b.x - 7, y: b.y - 7, width: b.w + 14, height: b.h + 14, rx: 16, fill: C.line, opacity: 0.55 }, wrapG);
    var o = { stroke: stroke, strokeWidth: sw, fill: fill === 'none' ? undefined : fill, fillStyle: 'solid' };
    if (dash) o.strokeLineDash = dash;
    var k = n.kind, x = b.x, y = b.y, w = b.w, h = b.h;
    if (k === 'store') {
      sketch('path', ['M' + x + ' ' + (y + 12) + ' L' + x + ' ' + (y + h - 10) + ' Q' + (x + w / 2) + ' ' + (y + h + 10) + ' ' + (x + w) + ' ' + (y + h - 10) + ' L' + (x + w) + ' ' + (y + 12)], o, n.id + 'b', wrapG);
      sketch('ellipse', [x + w / 2, y + 12, w, 24], o, n.id + 't', wrapG);
    } else if (k === 'external' || k === 'user') {
      var r = h / 2;
      sketch('path', ['M' + (x + r) + ' ' + y + ' L' + (x + w - r) + ' ' + y + ' A' + r + ' ' + r + ' 0 0 1 ' + (x + w - r) + ' ' + (y + h) + ' L' + (x + r) + ' ' + (y + h) + ' A' + r + ' ' + r + ' 0 0 1 ' + (x + r) + ' ' + y + ' Z'], o, n.id, wrapG);
    } else if (k === 'queue') {
      sketch('rectangle', [x + 10, y - 8, w, h], Object.assign({}, o, { fill: undefined }), n.id + 'q2', wrapG);
      sketch('rectangle', [x, y, w, h], o, n.id, wrapG);
    } else {
      sketch('rectangle', [x, y, w, h], o, n.id, wrapG);
    }
    if (k === 'screen') {
      sketch('path', ['M' + (x + 2) + ' ' + (y + 20) + ' L' + (x + w - 2) + ' ' + (y + 20)], { stroke: stroke, strokeWidth: 1.2 }, n.id + 'bar', wrapG);
      [12, 22, 32].forEach(function (dx) { el('circle', { cx: x + dx, cy: y + 10, r: 3, fill: stroke, opacity: 0.6 }, wrapG); });
    }
    if (k === 'job') el('path', { d: 'M' + (x + 16) + ' ' + (y + 14) + ' a6 6 0 1 1 -2 4', fill: 'none', stroke: stroke, 'stroke-width': 1.6 }, wrapG);
    // Kind label and name.
    var kindY = k === 'screen' ? y + 34 : k === 'store' ? y + 36 : y + 18;
    if (k !== 'table') text(wrapG, x + w / 2, kindY, k.toUpperCase(), 'font:600 9.5px Inter,sans-serif;letter-spacing:.09em;fill:' + C.muted);
    var labelColor = st.gone || st.untouched ? C.muted : C.ink;
    if (k === 'table') {
      sketch('path', ['M' + (x + 2) + ' ' + (y + 36) + ' L' + (x + w - 2) + ' ' + (y + 36)], { stroke: stroke, strokeWidth: 1.2 }, n.id + 'hd', wrapG);
      text(wrapG, x + 14, y + 24, n.label, 'font:600 14px "JetBrains Mono",monospace;fill:' + labelColor, 'start');
      text(wrapG, x + w - 12, y + 23, 'TABLE', 'font:600 9.5px Inter,sans-serif;letter-spacing:.09em;fill:' + C.muted, 'end');
      n.chips.forEach(function (c, i) {
        var col = c.mark === 'gone' ? C.gone : c.mark === 'new' ? C.new : c.mark === 'changed' ? C.chg : C.body;
        var row = el('g', { opacity: c.at <= state.step ? 1 : 0 }, wrapG);
        text(row, x + 14, y + 58 + i * 26, (c.mark === 'new' ? '+ ' : c.mark === 'gone' ? '− ' : '~ ') + c.text, 'font:500 12.5px "JetBrains Mono",monospace;fill:' + col + (c.mark === 'gone' ? ';text-decoration:line-through' : ''), 'start');
      });
    } else {
      var lines = wrap(n.label, 20), base = y + (k === 'screen' ? 54 : k === 'store' ? 56 : 40) + (lines.length === 1 ? 6 : 0);
      lines.forEach(function (ln, i) { text(wrapG, x + w / 2, base + i * 18, ln, 'font:600 15px Inter,sans-serif;fill:' + labelColor + (st.gone ? ';text-decoration:line-through' : '')); });
      if (st.untouched) text(wrapG, x + w / 2, y + h + 22, 'untouched', 'font:600 18px Caveat,cursive;fill:' + C.muted);
      var cy = y + h + 10;
      var shown = 0;
      n.chips.forEach(function (c) {
        if (state.ov || c.at !== state.step || shown >= 4) return; shown++;
        var col = c.mark === 'gone' ? C.gone : c.mark === 'new' ? C.new : C.chg;
        var soft = c.mark === 'new' ? C.newSoft : c.mark === 'gone' ? 'none' : C.chgSoft;
        var label = (c.mark === 'new' ? '+ ' : c.mark === 'gone' ? '− ' : '~ ') + (c.text.length > 30 ? c.text.slice(0, 29) + '…' : c.text);
        var cw = Math.min(w + 40, 16 + label.length * 6.9);
        var cg = el('g', { class: c.at === state.step ? 'enter' : '' }, wrapG);
        el('rect', { x: x + (w - cw) / 2, y: cy, width: cw, height: 22, rx: 11, fill: soft, stroke: col, 'stroke-width': 1.2, 'stroke-dasharray': c.mark === 'gone' ? '4 3' : '' }, cg);
        text(cg, x + w / 2, cy + 15, label, 'font:500 11.5px "JetBrains Mono",monospace;fill:' + col);
        cy += 28;
      });
    }
    if (st.badge) {
      var bc = { new: C.new, changed: C.chg, gone: C.gone, untouched: C.muted, watch: C.watch }[st.badge];
      el('circle', { cx: x, cy: y, r: 13, fill: st.badge === 'untouched' ? C.card : bc, stroke: st.badge === 'untouched' ? C.muted : 'none', 'stroke-dasharray': st.badge === 'untouched' ? '3 3' : '' }, wrapG);
      text(wrapG, x, y + 5.5, SYM[st.badge], 'font:700 15px Inter,sans-serif;fill:' + (st.badge === 'untouched' ? C.muted : C.card));
    }
  }

  function arrowHead(g, d, color) {
    var nums = d.match(/-?\d+(\.\d+)?/g).map(Number), n = nums.length;
    var ex = nums[n - 2], ey = nums[n - 1], px = nums[n - 4], py = nums[n - 3];
    var a = Math.atan2(ey - py, ex - px), L = 11;
    el('path', { d: 'M' + ex + ' ' + ey + ' L' + (ex - L * Math.cos(a - 0.42)) + ' ' + (ey - L * Math.sin(a - 0.42)) + ' L' + (ex - L * Math.cos(a + 0.42)) + ' ' + (ey - L * Math.sin(a + 0.42)) + ' Z', fill: color }, g);
  }

  function render() {
    var doc = state.doc, lay = state.lay, s = state.step, C = colors();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!doc) return;
    svg.setAttribute('viewBox', '0 0 ' + lay.width + ' ' + lay.height);
    rc = window.rough ? window.rough.svg(svg) : null;
    var gE = el('g', {}, svg), gN = el('g', {}, svg), gA = el('g', {}, svg);
    var ov = state.ov, cur = !ov && s > 0 ? doc.steps[s - 1] : null;
    var curIds = {}; if (cur) cur.marks.forEach(function (m) { curIds[m.id] = true; });

    doc.edges.forEach(function (e, k) {
      if (e.born > s) return;
      var a = lay.box[e.from], b = lay.box[e.to], p = SD.edgePath(a, b);
      var gone = e.died && e.died <= s, color = gone ? C.gone : e.born ? C.new : upTo(e.watch, s) ? C.watch : C.ink;
      var g = el('g', { class: !ov && (e.born === s || e.died === s) ? 'enter' : '' }, gE);
      var o = { stroke: color, strokeWidth: e.born ? 2.2 : 1.7, roughness: 0.7 };
      if (gone) o.strokeLineDash = [7, 7];
      sketch('path', [p.d], o, e.from + '>' + e.to, g);
      if (!gone) arrowHead(g, p.d, color);
      else {
        el('path', { d: 'M' + (p.mx - 9) + ' ' + (p.my - 9) + ' L' + (p.mx + 9) + ' ' + (p.my + 9) + ' M' + (p.mx + 9) + ' ' + (p.my - 9) + ' L' + (p.mx - 9) + ' ' + (p.my + 9), stroke: C.gone, 'stroke-width': 2.6, 'stroke-linecap': 'round' }, g);
      }
      if (e.label && (!ov || e.born || e.died)) text(g, p.mx, p.my - 10, e.label, 'font:600 18px Caveat,cursive;fill:' + (gone ? C.gone : e.born ? C.new : C.body) + ';paint-order:stroke;stroke:' + C.paper + ';stroke-width:5px');
    });

    var linked = {}; doc.edges.forEach(function (e) { linked[e.from] = linked[e.to] = true; });
    var screens = doc.order.filter(function (id) { return doc.nodes[id].kind === 'screen'; });
    doc.order.forEach(function (id) {
      var n = doc.nodes[id]; if (n.kind !== 'part' || linked[id] || !screens.length || n.born > s) return;
      var p = lay.box[screens[0]], b = lay.box[id];
      el('path', { d: 'M' + (p.x + 18) + ' ' + (p.y + p.h) + ' L' + (p.x + 18) + ' ' + (b.y + b.h / 2) + ' L' + b.x + ' ' + (b.y + b.h / 2), fill: 'none', stroke: C.muted, 'stroke-width': 1.4, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round' }, gE);
    });
    doc.order.forEach(function (id) {
      var n = doc.nodes[id], st = nodeState(n, s);
      if (!st) return;
      drawNode(gN, n, lay.box[id], st, C, !!curIds[id], !ov && n.born === s && s > 0);
    });

    // Overview: every watch item circled and numbered, nothing else.
    if (ov) watchList().forEach(function (w, k) {
      var b = lay.box[w.m.id]; if (!b) return;
      var cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2 + 34, ry = b.h / 2 + 28;
      sketch('ellipse', [cx, cy, rx * 2, ry * 2], { stroke: C.watch, strokeWidth: 2.6, roughness: 1.4 }, 'w' + w.m.id + k, gA);
      var nx = cx - rx * 0.72, ny = cy - ry * 0.72;
      el('circle', { cx: nx, cy: ny, r: 14, fill: C.watch }, gA);
      text(gA, nx, ny + 5, String(k + 1), 'font:700 15px Inter,sans-serif;fill:' + C.card);
    });
    // Annotations for the current step: a circle for watch marks, sticky notes for quotes, a handwritten caption.
    if (cur) {
      cur.marks.forEach(function (m, i) {
        var b = lay.box[m.id]; if (!b) return;
        if (m.mark === 'watch') {
          var g = el('g', { class: 'draw' }, gA);
          sketch('ellipse', [b.x + b.w / 2, b.y + (b.h + b.chipH) / 2, b.w + 70, b.h + b.chipH + 60], { stroke: C.watch, strokeWidth: 2.6, roughness: 1.4 }, 'w' + m.id, g);
        }
        if (m.caption && m.target === 'node') text(gA, b.x + b.w / 2, Math.max(22, b.y - 22), m.caption, 'font:700 21px Caveat,cursive;fill:' + (m.mark === 'watch' ? C.watch : m.mark === 'new' ? C.new : C.chg) + ';paint-order:stroke;stroke:' + C.paper + ';stroke-width:6px');
        m.quotes.forEach(function (q, qi) {
          var sx = Math.min(lay.width - 250, b.x + b.w + 16), sy = Math.max(8, b.y - 40 - qi * 10);
          var sg = el('g', { class: 'enter', transform: 'rotate(-2 ' + sx + ' ' + sy + ')' }, gA);
          var ql = wrap3('“' + q.text + '”', 30), qh = 34 + ql.length * 20;
          el('rect', { x: sx, y: sy, width: 240, height: qh, fill: C.sticky, rx: 2, style: 'filter:drop-shadow(0 4px 8px rgba(0,0,0,.12))' }, sg);
          ql.forEach(function (ln, li) { text(sg, sx + 12, sy + 24 + li * 20, ln, 'font:600 19px Caveat,cursive;fill:' + C.body, 'start'); });
          var qc = checkFor(s, q.text); text(sg, sx + 12, sy + qh - 9, ((q.at || (qc && qc.at)) ? (q.at || qc.at) + ' ' : '') + (qc && !qc.ok ? 'NOT found in the session' : 'the human, in the session'), 'font:500 10.5px Inter,sans-serif;fill:' + C.muted, 'start');
        });
      });
      // Cursor on the first thing this step is about.
      var tb = lay.box[cur.marks[0].id];
      if (tb) {
        var cx = tb.x + tb.w - 10, cy = tb.y - 6, col = cur.marks.some(function (m) { return m.mark === 'watch'; }) ? C.watch : C.new;
        var cg = el('g', { class: 'cursor', style: 'transform:translate(' + cx + 'px,' + cy + 'px)' }, gA);
        el('path', { d: 'M0 0 L0 20 L5 15 L9 23 L12 21.5 L8 14 L16 14 Z', fill: col, stroke: C.card, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, cg);
        el('rect', { x: 14, y: 18, width: 56, height: 22, rx: 6, fill: col }, cg);
        text(cg, 42, 33, 'Claude', 'font:600 12px Inter,sans-serif;fill:' + C.card);
      }
    }
    renderPanel();
  }

  function checkFor(stepNo, ref) {
    var ex = EXAMPLES[state.ex]; if (!ex || !ex.report || state.edited) return null;
    for (var i = 0; i < ex.report.checks.length; i++) { var c = ex.report.checks[i]; if (c.step === stepNo && c.ref === ref) return c; }
    return null;
  }
  function autoCaption(m) {
    var doc = state.doc, what = m.target === 'edge' ? doc.nodes[m.edge.from].label + ' → ' + doc.nodes[m.edge.to].label : m.node.label;
    return WORD[m.mark] + ': ' + what + (m.caption && m.target === 'node' ? ', ' + m.caption : '') + '.';
  }
  function stepLabel(st) {
    if (st.title) return st.title;
    var m = st.marks[0], doc = state.doc;
    var what = m.target === 'edge' ? doc.nodes[m.edge.from].label + ' → ' + doc.nodes[m.edge.to].label : m.node.label;
    return SYM[m.mark] + ' ' + what;
  }

  function short(t, max) {
    max = max || 110; t = String(t || '').trim();
    var first = t.split(/(?<=[.!?])\s/)[0];
    return first.length > max ? first.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : first;
  }
  function watchList() {
    var out = [];
    state.doc.steps.forEach(function (st, si) { st.marks.forEach(function (m) { if (m.mark === 'watch') out.push({ m: m, step: si + 1, label: short(m.caption || m.say || state.doc.nodes[m.id].label, 34) }); }); });
    return out;
  }
  function quotes() {
    var out = [], seen = {};
    state.doc.steps.forEach(function (st, si) { st.marks.forEach(function (m) { m.quotes.forEach(function (q) { var c = checkFor(si + 1, q.text); if (seen[q.text]) return; seen[q.text] = 1; out.push({ q: q, at: q.at || (c && c.at) || '', ok: !c || c.ok }); }); }); });
    return out;
  }
  function renderPanel() {
    var doc = state.doc, s = state.step, ex = EXAMPLES[state.ex];
    document.getElementById('title').textContent = doc.title || 'Untitled change';
    document.getElementById('source').textContent = state.edited ? 'Your edit of: ' + (ex ? ex.name : '') : (ex ? ex.source : '');
    var c = SD.counts(doc), parts = [];
    [['new', '+', 'new'], ['changed', '~', 'changed'], ['gone', '−', 'gone'], ['watch', '!', 'to check']].forEach(function (k) { if (c[k[0]]) parts.push('<span class="cnt ' + k[0] + '"><b>' + k[1] + c[k[0]] + '</b> ' + k[2] + '</span>'); });
    var ex2 = EXAMPLES[state.ex], rep = ex2 && ex2.report && !state.edited ? ex2.report : null;
    if (!rep) parts.push('<span class="cnt ' + (c.unverified ? 'unv' : 'ok') + '">' + (c.unverified ? c.unverified + ' not backed' : 'every line cites a source') + '</span>');
    if (rep) parts.push('<span class="cnt ' + (rep.sum.bad ? 'bad' : 'ok') + '">' + (rep.sum.bad ? '✗ ' + rep.sum.bad + ' claims do not hold up' : '✓ all ' + rep.sum.total + ' claims checked') + '</span>');
    document.getElementById('counts').innerHTML = parts.join('');
    var cl = document.getElementById('checks'), cs = document.getElementById('checksum');
    if (rep) {
      cs.textContent = rep.sum.ok + ' of ' + rep.sum.total + ' hold up · tests ' + rep.tests.head + ' pass';
      var bad = rep.checks.filter(function (c) { return c.ok !== true; });
      var kinds = { file: 0, test: 0, said: 0 }; rep.checks.forEach(function (c) { if (c.kind === 'said') kinds.said++; else if (/^test /.test(c.ref)) kinds.test++; else kinds.file++; });
      cl.innerHTML = (bad.length ? '' : '<div class="ck ok"><i>✓</i><div><span>' + kinds.file + ' code lines found in the change, ' + kinds.test + ' tests passing, ' + kinds.said + ' quotes matched to the session.</span></div></div>') + bad.map(function (c) { return '<div class="ck ' + (c.ok ? 'ok' : c.ok === false ? 'bad' : 'unk') + '"><i>' + (c.ok ? '✓' : c.ok === false ? '✗' : '?') + '</i><div><code>' + (c.kind === 'said' ? '“' + esc(c.ref) + '” ' + (c.at || '') : esc(c.ref)) + '</code><br><span>' + esc(c.why) + '</span></div></div>'; }).join('');
    } else {
      cs.textContent = state.edited ? 'stale' : 'not run';
      cl.innerHTML = '<div class="ck unk"><i>?</i><div><span>' + (state.edited ? 'You edited the spec. In CI the checker runs again on every push.' : (ex2 && ex2.note) || 'No checker run for this one.') + '</span></div></div>';
    }

    var ctr = document.getElementById('controls'); ctr.classList.toggle('ov', state.ov);
    var pills = document.getElementById('pills'); pills.innerHTML = '';
    var cap = document.getElementById('caption'), ev = document.getElementById('evidence'), look = document.getElementById('look');
    if (state.ov) {
      cap.className = 'caption plain'; cap.textContent = doc.why ? short(doc.why) + (/[.!?]$/.test(short(doc.why)) ? '' : '.') : '';
      ev.innerHTML = '';
      var wl = watchList(), qs = quotes(), ask = qs.filter(function (d) { return d.at === '@00:00'; }), dec = qs.filter(function (d) { return d.at !== '@00:00'; }).slice(0, 3);
      var ex3 = EXAMPLES[state.ex], rp = ex3 && ex3.report && !state.edited ? ex3.report : null, reg = '';
      if (rp) reg = rp.tests.regressed && rp.tests.regressed.length
        ? '<div class="reg bad"><b>✗ Regression:</b> ' + rp.tests.regressed.length + ' test(s) that passed before now fail: ' + esc(rp.tests.regressed.join(', ')) + '</div>'
        : '<div class="reg ok"><b>✓ No regressions.</b> All ' + rp.tests.before + ' tests that passed before still pass' + (rp.tests.added ? ', plus ' + rp.tests.added + ' new' : '') + '.</div>';
      look.innerHTML = reg + (wl.length ? '<div class="lh">Look here</div>' + wl.map(function (w, k) {
        var proofs = w.m.proofs, tests = proofs.filter(function (p) { return /^test /.test(p); }).length;
        var src = proofs.filter(function (p) { return !/^test /.test(p); })[0] || '';
        return '<button type="button" class="lk" data-step="' + w.step + '"><span class="n">' + (k + 1) + '</span><span class="lb"><span class="lt">' + esc(short(w.m.say || w.label, 120)) + '</span><span class="ls">' + esc(src) + (tests ? (src ? ' · ' : '') + tests + ' test' + (tests > 1 ? 's' : '') : '') + '</span></span></button>';
      }).join('') : '<div class="lh">Nothing flagged to check</div>') +
      (ask.length ? '<div class="lh">The ask</div><div class="dq"><span class="ev quote">“' + esc(short(ask[0].q.text, 110)) + '”</span></div>' : '') +
      (dec.length ? '<div class="lh">Decided by the human</div><div class="dq">' + dec.map(function (d) { return '<span class="ev quote">' + esc(d.at ? d.at + ' ' : '') + '“' + esc(short(d.q.text, 70)) + '”</span>'; }).join('') + '</div>' : '');
      look.querySelectorAll('.lk').forEach(function (b) { b.onclick = function () { state.ov = false; go(+b.dataset.step); }; });
      var pb = document.createElement('button'); pb.type = 'button'; pb.className = 'pill play'; pb.textContent = '▶ Play the walkthrough · ' + doc.steps.length + ' steps';
      pb.onclick = function () { state.ov = false; go(0); }; pills.appendChild(pb);
      return;
    }
    look.innerHTML = '';
    var ob = document.createElement('button'); ob.type = 'button'; ob.className = 'pill'; ob.textContent = '◱ Overview';
    ob.onclick = function () { state.ov = true; state.step = doc.steps.length; render(); }; pills.appendChild(ob);
    var labels = ['Before'].concat(doc.steps.map(stepLabel));
    labels.forEach(function (l, i) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'pill' + (i === s ? ' on' : '');
      var isWatch = i > 0 && doc.steps[i - 1].marks.some(function (m) { return m.mark === 'watch'; });
      if (isWatch) b.className += ' w';
      b.textContent = l; b.onclick = function () { go(i); }; pills.appendChild(b);
    });
    document.getElementById('stepno').textContent = s === 0 ? 'Before the change' : 'Step ' + s + ' of ' + doc.steps.length;
    cap.className = 'caption ' + state.lvl;
    ev.innerHTML = '';
    if (s === 0) {
      cap.textContent = state.lvl === 'plain' ? (doc.why ? 'Why: ' + doc.why + '.' : 'This is how it works today.') : 'Base picture: ' + doc.order.length + ' boxes, ' + doc.edges.filter(function (e) { return !e.born; }).length + ' arrows. Built from: ' + (doc.from.join(', ') || 'not stated') + '.';
      addChip(ev, 'from ' + (doc.from.join(' + ') || '?'), 'src');
      return;
    }
    var st = doc.steps[s - 1], m0 = st.marks[0];
    var plain = short(st.say || m0.say || autoCaption(m0));
    var eng = short(st.eng || m0.eng, 160) || st.marks.map(function (m) { return m.proofs[0] || ''; }).filter(Boolean).join(' · ') || plain;
    cap.textContent = state.lvl === 'plain' ? plain : eng;
    cap.classList.toggle('watch', st.marks.some(function (m) { return m.mark === 'watch'; }));
    var seen = {};
    st.marks.forEach(function (m) {
      m.proofs.forEach(function (p) { if (seen[p]) return; seen[p] = 1; var c = checkFor(s, p); if (state.lvl === 'plain' && c && c.ok) return; addChip(ev, (c ? (c.ok ? '✓ ' : c.ok === false ? '✗ ' : '? ') : '') + p, c ? (c.ok ? 'ok' : c.ok === false ? 'bad' : 'proof') : 'proof', c ? c.why : 'not checked'); });
      m.quotes.forEach(function (q) { var c = checkFor(s, q.text); addChip(ev, (q.at || (c && c.at) || '') + ' “' + short(q.text, 80) + '”' + (c && !c.ok ? ' ✗ not in the session' : ''), c && !c.ok ? 'bad' : 'quote', c ? c.why : ''); });
      if (!m.verified) addChip(ev, 'not backed: ' + (m.target === 'edge' ? m.edge.from + ' → ' + m.edge.to : m.id), 'unv');
    });
  }
  function addChip(parent, label, cls, why) { var s = document.createElement('span'); s.className = 'ev ' + cls; s.textContent = label; if (why) s.title = why; parent.appendChild(s); }

  function esc(x) { return String(x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function go(i) { if (!state.doc) return; state.step = Math.max(0, Math.min(state.doc.steps.length, i)); render(); }

  function load(src, keepStep) {
    try {
      var d = SD.parse(src);
      state.doc = d; state.lay = SD.layout(d); state.error = '';
      if (!keepStep) state.step = d.steps.length; else state.step = Math.min(state.step, d.steps.length);
      document.getElementById('status').className = 'status ok';
      document.getElementById('status').textContent = '✓ Parsed · ' + d.order.length + ' boxes · ' + d.steps.length + ' steps';
      document.getElementById('mermaid').textContent = SD.mermaid(d);
      render();
    } catch (e) {
      document.getElementById('status').className = 'status err';
      document.getElementById('status').textContent = e.message;
    }
  }

  function pickExample(i) {
    state.ex = i; state.edited = false; state.ov = true; specEl.value = EXAMPLES[i].spec; load(specEl.value, false);
    document.querySelectorAll('.ex').forEach(function (b, k) { b.classList.toggle('on', k === i); b.setAttribute('aria-pressed', k === i ? 'true' : 'false'); });
  }

  var exWrap = document.getElementById('examples');
  EXAMPLES.forEach(function (ex, i) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'ex';
    b.innerHTML = '<span class="exk">' + ex.kind + '</span><span class="exn">' + ex.name + '</span>';
    b.onclick = function () { pickExample(i); }; exWrap.appendChild(b);
  });
  var t = null;
  specEl.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { state.edited = true; load(specEl.value, true); }, 250); });
  document.getElementById('prev').onclick = function () { go(state.step - 1); };
  document.getElementById('next').onclick = function () { if (state.ov) { state.ov = false; return go(0); } go(state.step >= state.doc.steps.length ? 0 : state.step + 1); };
  document.getElementById('lvlPlain').onclick = function () { state.lvl = 'plain'; setLvl(); };
  document.getElementById('lvlEng').onclick = function () { state.lvl = 'eng'; setLvl(); };
  function setLvl() {
    document.getElementById('lvlPlain').setAttribute('aria-pressed', state.lvl === 'plain'); document.getElementById('lvlEng').setAttribute('aria-pressed', state.lvl === 'eng');
    if (state.doc) renderPanel();
  }
  document.addEventListener('keydown', function (e) {
    if (e.target === specEl) return;
    if (e.key === 'ArrowRight') { if (state.ov) { state.ov = false; return go(0); } go(state.step + 1); }
    if (e.key === 'ArrowLeft') go(state.step - 1);
  });
  document.getElementById('copy').onclick = function () {
    var txt = document.getElementById('mermaid').textContent, btn = this;
    var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1400); };
    try { navigator.clipboard.writeText(txt).then(done, function () { selectPre(); }); } catch (e) { selectPre(); }
  };
  function selectPre() { var r = document.createRange(); r.selectNodeContents(document.getElementById('mermaid')); var s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render); } catch (e) {}
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);
  setLvl();
  pickExample(0);
})();
