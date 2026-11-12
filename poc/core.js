// Storydiff v0: parser, union-graph layout and Mermaid compiler. Pure functions, no DOM.
var SD = (function () {
  var KINDS = ['service', 'screen', 'part', 'code', 'endpoint', 'table', 'queue', 'job', 'store', 'external', 'file', 'test', 'user', 'config'];
  var MARKS = { '+': 'new', '~': 'changed', '-': 'gone', '=': 'untouched', '!': 'watch' };

  function fail(i, msg) { var e = new Error('Line ' + (i + 1) + ': ' + msg); e.line = i + 1; throw e; }

  // Split a line into tokens: bare words, "quoted strings", and the arrow.
  function tokens(text, i) {
    var out = [], re = /\s*(?:"((?:[^"\\]|\\.)*)"|(->)|([^\s"]+))/g, m, pos = 0;
    while (pos < text.length) {
      re.lastIndex = pos; m = re.exec(text);
      if (!m || m.index !== pos) break;
      if (m[0].trim() === '') break;
      if (m[1] !== undefined) out.push({ s: m[1].replace(/\\"/g, '"'), q: true });
      else if (m[2]) out.push({ s: '->', arrow: true });
      else out.push({ s: m[3] });
      pos = re.lastIndex;
    }
    if (text.slice(pos).trim() !== '') fail(i, 'an opening " has no closing "');
    return out;
  }
  function stripComment(line) {
    var q = false;
    for (var k = 0; k < line.length; k++) {
      if (line[k] === '"' && line[k - 1] !== '\\') q = !q;
      if (line[k] === '#' && !q) return line.slice(0, k);
    }
    return line;
  }
  var ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

  function parse(src) {
    var doc = { title: '', why: '', from: [], nodes: {}, order: [], edges: [], steps: [] };
    var lines = src.replace(/\t/g, '  ').split('\n');
    var step = null, stepIndent = -1, mark = null, markIndent = -1;

    function node(id, i) { var n = doc.nodes[id]; if (!n) fail(i, '"' + id + '" is not declared yet. Declare it first, like: code ' + id + ' "Label"'); return n; }
    function declare(kind, id, label, i, born) {
      if (!ID.test(id)) fail(i, '"' + id + '" is not a valid id (letters, digits, _ . -)');
      if (doc.nodes[id]) fail(i, '"' + id + '" is declared twice');
      var n = { id: id, kind: kind, label: label || id, order: doc.order.length, born: born, died: null, changed: [], watch: [], untouched: [], chips: [] };
      doc.nodes[id] = n; doc.order.push(id); return n;
    }
    function findEdge(a, b) { for (var k = 0; k < doc.edges.length; k++) if (doc.edges[k].from === a && doc.edges[k].to === b) return doc.edges[k]; return null; }
    function addEdge(a, b, label, i, born) {
      node(a, i); node(b, i);
      var e = { from: a, to: b, label: label || '', born: born, died: null, changed: [], watch: [] };
      doc.edges.push(e); return e;
    }
    // Reads "a -> b [label]" or "kind id [label]" or "id [label]" from tokens.
    function target(t, i) {
      if (t.length >= 3 && t[1].arrow) return { type: 'edge', a: t[0].s, b: t[2].s, label: t[3] && t[3].q ? t[3].s : '', rest: t.slice(t[3] && t[3].q ? 4 : 3) };
      if (t.length >= 2 && !t[0].q && KINDS.indexOf(t[0].s) >= 0 && !t[1].q) return { type: 'decl', kind: t[0].s, id: t[1].s, label: t[2] && t[2].q ? t[2].s : '', rest: t.slice(t[2] && t[2].q ? 3 : 2) };
      if (t.length >= 1 && !t[0].q) return { type: 'ref', id: t[0].s, label: t[1] && t[1].q ? t[1].s : '', rest: t.slice(t[1] && t[1].q ? 2 : 1) };
      fail(i, 'expected a box ("code id \\"Label\\""), an id, or an arrow ("a -> b")');
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = stripComment(lines[i]);
      if (raw.trim() === '') continue;
      var indent = raw.match(/^ */)[0].length, text = raw.trim();

      // Detail lines belong to the mark above them.
      if (mark && indent > markIndent) {
        var c0 = text[0];
        if (MARKS[c0] && text[1] === ' ') {
          text.slice(2).split(',').forEach(function (s) { s = s.trim(); if (s) mark.chips.push({ mark: MARKS[c0], text: s }); });
          continue;
        }
        var kw = text.split(/\s+/)[0], tk = tokens(text, i);
        if (kw === 'say' || kw === 'eng') { if (!tk[1] || !tk[1].q) fail(i, kw + ' needs a "quoted sentence"'); mark[kw] = tk[1].s; continue; }
        if (kw === 'proof') { var p = text.slice(5).trim(); if (!p) fail(i, 'proof needs something to point at: a file:line, a test name or a commit'); mark.proofs.push(p); continue; }
        if (kw === 'said') {
          var at = tk[1] && /^@/.test(tk[1].s) ? tk[1].s : '', qt = tk[at ? 2 : 1];
          if (!qt || !qt.q) fail(i, 'said needs a "quote", for example: said @00:41 "Not Redis."');
          mark.quotes.push({ at: at, text: qt.s }); continue;
        }
        fail(i, 'under a mark, use say, eng, proof, said, or + / - / ~ items');
      }
      if (indent <= markIndent) { mark = null; markIndent = -1; }
      if (step && step.explicit && indent <= stepIndent) { step = null; stepIndent = -1; }

      var t = tokens(text, i), head = t[0].s;
      if (step && step.explicit && !mark && (head === 'say' || head === 'eng') && indent > stepIndent) {
        if (!t[1] || !t[1].q) fail(i, head + ' needs a "quoted sentence"');
        step[head] = t[1].s; continue;
      }
      if (head === 'title' || head === 'why') { if (!t[1] || !t[1].q) fail(i, head + ' needs a "quoted sentence"'); doc[head] = t[1].s; continue; }
      if (head === 'from') { doc.from = text.slice(4).split(',').map(function (s) { return s.trim(); }).filter(Boolean); continue; }
      if (head === 'step') {
        if (!t[1] || !t[1].q) fail(i, 'step needs a "caption"');
        step = { explicit: true, title: t[1].s, marks: [] }; stepIndent = indent; doc.steps.push(step); continue;
      }
      if (MARKS[text[0]] && text[1] === ' ') {
        var mk = MARKS[text[0]], tt = tokens(text.slice(2), i), tg = target(tt, i);
        if (!step || !step.explicit) { step = { explicit: false, title: '', marks: [] }; doc.steps.push(step); }
        var sn = doc.steps.length; // the step number this mark appears at (0 is "today")
        var m = { mark: mk, target: tg.type === 'edge' ? 'edge' : 'node', caption: tg.label, chips: [], proofs: [], quotes: [], say: '', eng: '' };
        if (tg.type === 'edge') {
          var e = findEdge(tg.a, tg.b);
          if (mk === 'new') { if (e) fail(i, 'the arrow ' + tg.a + ' -> ' + tg.b + ' already exists'); e = addEdge(tg.a, tg.b, tg.label, i, sn); }
          else { if (!e) e = addEdge(tg.a, tg.b, tg.label, i, 0); if (mk === 'gone') e.died = sn; else if (mk === 'changed') e.changed.push(sn); else if (mk === 'watch') e.watch.push(sn); }
          m.edge = e; m.id = tg.b; m.caption = tg.label;
        } else {
          // Re-declaring a box that already exists under a mark (~ table links "...") just points at it; the label becomes the caption.
          if (tg.type === 'decl' && doc.nodes[tg.id] && mk !== 'new') { tg = { type: 'ref', id: tg.id, label: tg.label }; m.caption = tg.label; }
          var n = tg.type === 'decl' ? declare(tg.kind, tg.id, mk === 'new' ? tg.label : (tg.label || tg.id), i, mk === 'new' ? sn : 0) : node(tg.id, i);
          if (tg.type === 'ref' && mk === 'new') fail(i, '"+ ' + tg.id + '" needs a kind, like: + code ' + tg.id + ' "Label"');
          if (mk === 'gone') n.died = sn; else if (mk === 'changed') n.changed.push(sn); else if (mk === 'watch') n.watch.push(sn); else if (mk === 'untouched') n.untouched.push(sn);
          m.id = n.id; m.node = n; if (tg.type === 'decl') m.caption = '';
        }
        m.step = sn; step.marks.push(m); mark = m; markIndent = indent; continue;
      }
      // Base picture: what exists today.
      var b = target(t, i);
      if (b.type === 'edge') { if (findEdge(b.a, b.b)) fail(i, 'the arrow ' + b.a + ' -> ' + b.b + ' is declared twice'); addEdge(b.a, b.b, b.label, i, 0); continue; }
      if (b.type === 'decl') { declare(b.kind, b.id, b.label, i, 0); continue; }
      fail(i, 'unknown line. Lines start with a kind (' + KINDS.slice(0, 6).join(', ') + '…), an arrow, a mark (+ ~ - = !), step, title, why or from');
    }
    // An arrow with nothing to say joins the step before it, so wiring does not become its own step.
    var merged = [], map = [0];
    doc.steps.forEach(function (s) {
      var m0 = s.marks[0], quiet = !s.explicit && s.marks.length === 1 && m0.target === 'edge' && !m0.say && !m0.eng && merged.length;
      if (quiet) { merged[merged.length - 1].marks.push(m0); } else merged.push(s);
      map.push(merged.length);
    });
    function re(n) { return n ? map[n] : n; }
    doc.order.forEach(function (id) { var n = doc.nodes[id]; n.born = re(n.born); n.died = re(n.died); n.changed = n.changed.map(re); n.watch = n.watch.map(re); n.untouched = n.untouched.map(re); });
    doc.edges.forEach(function (e) { e.born = re(e.born); e.died = re(e.died); e.changed = e.changed.map(re); e.watch = e.watch.map(re); });
    merged.forEach(function (s) { s.marks.forEach(function (m) { m.step = re(m.step); }); });
    doc.steps = merged;
    // Chips attach to the node a mark points at, at that mark's step.
    doc.steps.forEach(function (s) { s.marks.forEach(function (m) { if (m.node) m.chips.forEach(function (c) { m.node.chips.push({ mark: c.mark, text: c.text, at: m.step }); }); m.verified = m.proofs.length > 0 || m.quotes.length > 0; }); });
    if (!doc.order.length) fail(0, 'nothing to draw yet. Start with a box, like: code api "API"');
    return doc;
  }

  // One layout for before and after: lay out the union of both graphs so nothing moves between steps.
  function layout(doc) {
    var W = 184, GAPX = 112, GAPY = 46, PAD = 56;
    // Drop back edges (loops like retry -> charge) before ranking, found by a depth-first walk in declaration order.
    var out = {}, state = {}, back = [];
    doc.order.forEach(function (id) { out[id] = []; });
    doc.edges.forEach(function (e) { out[e.from].push(e); });
    function walk(id) {
      state[id] = 1;
      out[id].forEach(function (e) { if (state[e.to] === 1) back.push(e); else if (!state[e.to]) walk(e.to); });
      state[id] = 2;
    }
    doc.order.forEach(function (id) { if (!state[id]) walk(id); });
    var rank = {}; doc.order.forEach(function (id) { rank[id] = 0; });
    for (var pass = 0; pass < doc.order.length; pass++) {
      var moved = false;
      doc.edges.forEach(function (e) { if (back.indexOf(e) < 0 && rank[e.to] < rank[e.from] + 1) { rank[e.to] = rank[e.from] + 1; moved = true; } });
      if (!moved) break;
    }
    var cols = [];
    doc.order.forEach(function (id) { var r = rank[id]; (cols[r] = cols[r] || []).push(doc.nodes[id]); });
    cols = cols.filter(Boolean);
    var box = {}, colH = [];
    cols.forEach(function (col, ci) {
      col.sort(function (a, b) { return (a.born > 0) - (b.born > 0) || a.order - b.order; });
      var y = 0;
      col.forEach(function (n) {
        var isTable = n.kind === 'table', rows = isTable ? Math.max(1, n.chips.length) : 0;
        var h = isTable ? 44 + rows * 26 : 72;
        var per = {}; n.chips.forEach(function (c) { per[c.at] = (per[c.at] || 0) + 1; });
        var most = 0; for (var k in per) most = Math.max(most, per[k]);
        var chipH = isTable ? 0 : Math.min(most, 4) * 28;
        box[n.id] = { x: 0, y: y, w: W, h: h, chipH: chipH, col: ci };
        y += h + chipH + GAPY;
      });
      colH[ci] = y - GAPY;
    });
    var maxH = Math.max.apply(null, colH);
    cols.forEach(function (col, ci) {
      var off = (maxH - colH[ci]) / 2;
      col.forEach(function (n) { var bx = box[n.id]; bx.x = PAD + ci * (W + GAPX); bx.y = PAD + off + bx.y; });
    });
    return { box: box, width: PAD * 2 + cols.length * W + (cols.length - 1) * GAPX, height: PAD * 2 + maxH + 20 };
  }

  function edgePath(a, b) {
    if (b.x > a.x + a.w - 1) {
      var x1 = a.x + a.w, y1 = a.y + Math.min(a.h, 72) / 2, x2 = b.x, y2 = b.y + Math.min(b.h, 72) / 2, dx = (x2 - x1) * 0.5;
      return { d: 'M' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
    }
    var down = b.y >= a.y, sx = a.x + a.w / 2, sy = down ? a.y + a.h + a.chipH : a.y, ex = b.x + b.w / 2, ey = down ? b.y : b.y + b.h, bend = a.x === b.x ? 70 : 0;
    return { d: 'M' + sx + ' ' + sy + ' C ' + (sx + bend) + ' ' + (sy + (ey - sy) / 2) + ', ' + (ex + bend) + ' ' + (sy + (ey - sy) / 2) + ', ' + ex + ' ' + ey, mx: (sx + ex) / 2 + bend * 0.75, my: (sy + ey) / 2 };
  }

  function counts(doc) {
    var c = { new: 0, changed: 0, gone: 0, untouched: 0, watch: 0, unverified: 0 };
    doc.steps.forEach(function (s) { s.marks.forEach(function (m) { c[m.mark]++; if (!m.verified) c.unverified++; }); });
    return c;
  }

  function mermaid(doc) {
    var sym = { new: '+ ', changed: '~ ', gone: '− ', untouched: '= ', watch: '! ' };
    var out = ['flowchart LR',
      '  classDef new fill:#E3F1EF,stroke:#0F766E,stroke-width:2px,color:#0B4F4A',
      '  classDef changed stroke:#4338CA,stroke-width:2px',
      '  classDef gone stroke:#8E8A84,stroke-dasharray:5 5,color:#8E8A84',
      '  classDef untouched stroke:#B9B5AE,stroke-dasharray:3 3,color:#6B6B74',
      '  classDef watch stroke:#C2410C,stroke-width:3px'];
    function cls(n) {
      if (n.watch.length) return 'watch';
      if (n.died) return 'gone';
      if (n.born) return 'new';
      if (n.changed.length) return 'changed';
      if (n.untouched.length) return 'untouched';
      return '';
    }
    function shape(n, label) {
      var l = '"' + label.replace(/"/g, "'") + '"';
      if (n.kind === 'table' || n.kind === 'store') return n.id + '[(' + l + ')]';
      if (n.kind === 'external' || n.kind === 'user') return n.id + '([' + l + '])';
      if (n.kind === 'queue') return n.id + '[[' + l + ']]';
      return n.id + '[' + l + ']';
    }
    doc.order.forEach(function (id) {
      var n = doc.nodes[id], c = cls(n);
      out.push('  ' + shape(n, (c ? sym[c] : '') + n.label) + (c ? ':::' + c : ''));
    });
    var styles = [];
    doc.edges.forEach(function (e, k) {
      var lab = e.label ? '|' + e.label.replace(/[|"]/g, '') + '|' : '';
      out.push('  ' + e.from + (e.died ? ' -.->' : ' -->') + lab + ' ' + e.to);
      if (e.died) styles.push('  linkStyle ' + k + ' stroke:#8E8A84,stroke-dasharray:5 5');
      else if (e.born) styles.push('  linkStyle ' + k + ' stroke:#0F766E,stroke-width:2.5px');
      else if (e.watch.length) styles.push('  linkStyle ' + k + ' stroke:#C2410C,stroke-width:2.5px');
    });
    return out.concat(styles).join('\n');
  }

  return { parse: parse, layout: layout, edgePath: edgePath, counts: counts, mermaid: mermaid, MARKS: MARKS, KINDS: KINDS };
})();
if (typeof module !== 'undefined') module.exports = SD;
