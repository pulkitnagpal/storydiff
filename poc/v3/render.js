// Storydiff card renderer: spec + captures + check report -> the review card (HTML), exactly as designed on the canvas.
var RENDER = (function () {
  var CSS = [
    'body{margin:0;background:#F7F6F3}',
    '.card{width:1440px;box-sizing:border-box;background:#F7F6F3;color:#16161A;font-family:Inter,sans-serif;padding:24px 32px 26px;display:flex;flex-direction:column;gap:16px}',
    '.lbl{font:700 12px Inter,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8E8A84}',
    '.tag{font:700 12px Inter,sans-serif;color:#8E8A84}',
    '.say{font-family:Caveat,cursive;font-weight:600}',
    '.vt{display:flex;align-items:center;gap:8px;font:600 13.5px Inter,sans-serif;border-radius:12px;padding:9px 13px}',
    '.ch{font:600 13.5px Inter,sans-serif;border-radius:999px;padding:9px 15px;background:#FFFFFF;border:1px solid #E6E3DD;color:#3F3F46}',
    '.ch.on{background:#16161A;color:#FFFFFF;border-color:#16161A}',
    '.win{position:relative;box-sizing:border-box;width:470px;background:#FFFFFF;border:2px solid #16161A;border-radius:14px 18px 12px 20px/18px 12px 20px 14px}',
    '.win img{display:block;width:466px;height:auto;border-radius:0 0 12px 14px}',
    '.bar{height:30px;border-bottom:1.5px solid #16161A;display:flex;align-items:center;gap:6px;padding:0 12px}',
    '.dot{width:8px;height:8px;border-radius:999px;background:#D6D3CD}',
    '.url{margin-left:10px;font:500 11px Inter,sans-serif;color:#8E8A84;background:#F4F2EE;border-radius:999px;padding:2px 10px}',
    '.mk{position:absolute;width:26px;height:26px;border-radius:999px;color:#FFFFFF;font:700 13px Inter,sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px #FFFFFF;z-index:3;box-sizing:border-box}',
    '.mki{display:inline-flex;width:24px;height:24px;border-radius:999px;color:#FFFFFF;font:700 12px Inter,sans-serif;align-items:center;justify-content:center;vertical-align:middle;margin-left:8px;box-shadow:0 0 0 2px #FFFFFF;box-sizing:border-box}',
    '.g{background:#0F766E}.o{background:#C2410C}.c{background:#4338CA}.x{background:#8E8A84}.k{background:#FFFFFF;color:#6B6B74;border:1.5px dashed #8E8A84}',
    '.json{position:relative;box-sizing:border-box;width:470px;background:#FFFFFF;border:2px solid #16161A;border-radius:14px 18px 12px 20px/18px 12px 20px 14px;padding:10px 14px;font:500 12.5px/1.7 "JetBrains Mono",monospace;color:#3F3F46;white-space:pre}',
    '.req{font:600 12px "JetBrains Mono",monospace;color:#6B6B74}',
    '.mute{color:#B9B5AE}',
    '.addf{color:#0B4F4A;background:#E3F1EF;border-radius:4px;padding:1px 3px;outline:1.5px solid #0F766E}',
    '.addf.w{color:#9A3412;background:#FDEBE1;outline-color:#C2410C}',
    '.gonef{color:#8E8A84;text-decoration:line-through}',
    '.same{display:flex;align-items:center;gap:12px;background:#E3F1EF;color:#0B4F4A;border-radius:14px;padding:12px 16px}',
    '.sr{display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid #CFE8E4;font:600 14px Inter,sans-serif;color:#0B4F4A}',
    '.sr:last-child{border-bottom:none}.sr code{font:500 12.5px "JetBrains Mono",monospace;color:#0B4F4A}.sr .ck{margin-left:auto;font:700 13px Inter,sans-serif}',
    '.panel{position:relative;box-sizing:border-box;background:#FFFFFF;border:2px solid #0F766E;border-radius:14px 18px 12px 20px/18px 12px 20px 14px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}',
    '.newtag{font:700 12px Inter,sans-serif;color:#0F766E}',
    '.stp{position:relative;display:flex;align-items:center;gap:10px;font:600 14px Inter,sans-serif;border:1.5px solid #0F766E;background:#F3FAF9;color:#0B4F4A;border-radius:10px;padding:9px 12px}',
    '.stp code{margin-left:auto;font:500 11.5px "JetBrains Mono",monospace;color:#6B6B74}',
    '.rr{position:relative;display:grid;grid-template-columns:120px 1fr;gap:10px;align-items:center;font:600 14px Inter,sans-serif;padding:6px 0;border-bottom:1px solid #EDEAE4}',
    '.rr:last-child{border-bottom:none}.rr span:first-child{font:500 12.5px Inter,sans-serif;color:#6B6B74}.rr code{font:500 12.5px "JetBrains Mono",monospace;color:#16161A}',
    '.sc{display:flex;align-items:center;gap:6px}',
    '.fr{box-sizing:border-box;width:112px;height:62px;border:2px solid #16161A;border-radius:10px 13px 9px 14px/13px 9px 14px 10px;background:#FFFFFF;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;text-align:center;font:600 12.5px Inter,sans-serif}',
    '.fr small{font:600 16px Caveat,cursive;color:#6B6B74}',
    '.oc{position:relative;box-sizing:border-box;width:150px;height:62px;border-radius:12px;display:flex;flex-direction:column;justify-content:center;padding:0 14px}',
    '.oc b{font:700 24px Inter,sans-serif;letter-spacing:-0.02em}.oc .os{font:500 12px Inter,sans-serif;color:#3F3F46}',
    '.ar{font-size:15px;color:#8E8A84}',
    '.half{width:470px;display:flex;flex-direction:column;gap:6px}',
    '.strip{position:relative;width:470px;height:150px;box-sizing:border-box;background:#FFFFFF;border:1.5px solid #E6E3DD;border-radius:16px}',
    '.sb{position:absolute;box-sizing:border-box;height:40px;border:2px solid #16161A;border-radius:10px 13px 9px 14px/13px 9px 14px 10px;background:#FFFFFF;font:600 13px Inter,sans-serif;color:#16161A;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 6px;line-height:1.15}',
    '.sb.new{border-color:#0F766E;background:#E3F1EF;color:#0B4F4A}.sb.kept{border-style:dashed;color:#6B6B74}.sb.chg{border-color:#4338CA}.sb.gone{border-style:dashed;border-color:#B9B5AE;color:#8E8A84;text-decoration:line-through}',
    '.li{display:flex;gap:12px;align-items:flex-start;border-radius:14px;padding:9px 12px}',
    '.li.w{background:#FDEBE1}',
    '.n{flex:none;width:26px;height:26px;border-radius:999px;color:#FFFFFF;font:700 13px Inter,sans-serif;display:flex;align-items:center;justify-content:center;box-sizing:border-box}',
    '.n.k{color:#6B6B74}',
    '.lt{font:600 15px/1.35 Inter,sans-serif;color:#16161A}',
    '.q{display:block;margin-top:3px;font:600 17px/1.1 Caveat,cursive;color:#6B6B74}',
    '.arrow{flex:none;width:34px;text-align:center;font-size:18px}'
  ].join('\n');
  var FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Caveat:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">';
  var LOGO = '<svg width="28" height="28" viewBox="0 0 30 30" aria-hidden="true"><rect x="1" y="1" width="28" height="28" rx="9" fill="#16161A"></rect><path d="M7 19 C 11 13, 15 21, 23 11" stroke="#F0752E" stroke-width="3.2" fill="none" stroke-linecap="round"></path></svg>';
  var CURVE = '<svg width="34" height="30" viewBox="0 0 34 30" style="flex: none; margin-top: 22px" aria-hidden="true"><path d="M4 16 C 12 10, 20 20, 27 14 M21 8 L29 14 L21 20" stroke="#16161A" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function tone(m) { return m.mark === 'watch' ? 'o' : m.mark === 'kept' ? 'k' : m.mark === 'gone' ? 'x' : m.mark === 'changed' ? 'c' : 'g'; }
  function pinsOn(d, on) { var o = []; d.marks.forEach(function (m) { if (!m.n) return; m.pins.forEach(function (p) { if (p.on === on) o.push({ n: m.n, t: tone(m), target: p.target, m: m }); }); }); return o; }
  function sec(label, hint) { return '<div style="display: flex; align-items: baseline; gap: 10px"><span class="lbl">' + esc(label) + '</span>' + (hint ? '<span class="say" style="font-size: 19px; color: #8E8A84">' + esc(hint) + '</span>' : '') + '</div>'; }

  // Slot 3: screen
  function screen(d, sh, cap) {
    var pins = pinsOn(d, 'screen'), page = pins.filter(function (p) { return p.target === 'page'; })[0];
    var marks = pins.filter(function (p) { return p.target !== 'page'; }).map(function (p) {
      var r = (cap.rects || []).filter(function (x) { return x.sel === p.target; })[0];
      if (!r || !r.found) return '';   // never draw a pin we could not find
      var top = 31.5 + r.y - 17, left = Math.min(446, r.x + r.w - 5);
      return '<span class="mk ' + p.t + '" style="left: ' + Math.round(left) + 'px; top: ' + Math.round(top) + 'px">' + p.n + '</span>';
    }).join('');
    function win(img, extra, inner) {
      return '<div class="win" style="' + (extra || '') + '"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="url">' + esc(cap.app || 'App') + '</span></div><img src="' + img + '" alt="">' + (inner || '') + '</div>';
    }
    var after = win(cap.after, page ? 'outline: 2.5px dashed #C2410C; outline-offset: 7px' : '', marks + (page ? '<span class="mk ' + page.t + '" style="left: 446px; top: -20px">' + page.n + '</span>' : ''));
    return sec(sh.label || 'What people see', sh.hint || 'spot the difference') +
      '<div style="display: flex; align-items: center"><div style="display: flex; flex-direction: column; gap: 14px"><span class="tag">BEFORE</span>' + win(cap.before) + '</div>' + CURVE +
      '<div style="display: flex; flex-direction: column; gap: 14px"><span class="tag" style="color: #0F766E">AFTER</span>' + after + '</div></div>';
  }

  // Slot 3: call. Fields packed onto lines; volatile fields shown as (time); added fields highlighted.
  var VOLATILE = /(_at|At|time|date|_id_gen)$/;
  function fields(obj, other, pins, side) {
    var parts = Object.keys(obj).map(function (k) {
      var v = VOLATILE.test(k) ? '<span class="mute">(time)</span>' : esc(JSON.stringify(obj[k]));
      var kv = '"' + esc(k) + '": ' + v, plain = ('"' + k + '": ' + (VOLATILE.test(k) ? '(time)' : JSON.stringify(obj[k])));
      if (other && !(k in other)) {
        if (side === 'after') { var p = pins.filter(function (x) { return x.target === k; })[0]; kv = '<span class="addf' + (p && p.t === 'o' ? ' w' : '') + '">' + kv + '</span>' + (p ? '<span class="mki ' + p.t + '">' + p.n + '</span>' : ''); }
        else kv = '<span class="gonef">' + kv + '</span>';
      }
      return { html: kv, len: plain.length };
    });
    var lines = [], cur = [], w = 0;
    parts.forEach(function (p) { if (cur.length && w + p.len > 46) { lines.push(cur); cur = []; w = 0; } cur.push(p.html); w += p.len + 2; });
    if (cur.length) lines.push(cur);
    return '{ ' + lines.map(function (l) { return l.join(', '); }).join(',\n  ') + ' }';
  }
  function call(d, sh, cap) {
    var pins = pinsOn(d, 'call'), b = cap.before, a = cap.after, head = esc(sh.method + ' ' + sh.path);
    var bj = b.json && typeof b.json === 'object' && !Array.isArray(b.json) ? b.json : null, aj = a.json && typeof a.json === 'object' && !Array.isArray(a.json) ? a.json : null;
    return sec(sh.label || 'What apps get back', sh.hint) +
      '<div style="display: flex; align-items: center"><div class="json"><span class="req">' + head + '  →  ' + b.status + '</span>\n' + (bj ? fields(bj, aj, pins, 'before') : esc(JSON.stringify(b.json))) + '</div>' +
      '<span class="arrow">→</span><div class="json"><span class="req">' + head + '  →  ' + a.status + '</span>\n' + (aj ? fields(aj, bj, pins, 'after') : esc(JSON.stringify(a.json))) + '</div></div>';
  }

  // Slot 3: identical captures. One line each, or one block when that's all there is.
  function sameLine(d, sh, k) {
    var p = pinsOn(d, 'same').filter(function (x) { return +x.target === k + 1; })[0];
    return '<div class="same">' + (p ? '<span class="n ' + p.t + '">' + p.n + '</span>' : '') + '<span style="font: 700 14.5px Inter, sans-serif">✓ Same on both versions</span><span style="font: 500 13.5px Inter, sans-serif">' + esc(sh.label) + '</span><span style="margin-left: auto; font: 500 12px Inter, sans-serif; color: #0F766E">times and ids ignored</span></div>';
  }
  function sameBlock(list, caps) {
    var ok = caps.filter(function (c) { return c && c.match; }).length;
    return sec('What anyone using it notices', ok === list.length ? "nothing, and here's the proof" : 'some replies changed') +
      '<div style="background: #E3F1EF; border-radius: 16px; overflow: hidden"><div style="display: flex; align-items: center; gap: 12px; padding: 16px 16px 12px"><span style="font: 700 20px Inter, sans-serif; color: #0B4F4A">✓ Same on both versions</span><span style="font: 500 13.5px Inter, sans-serif; color: #0F766E">' + ok + ' of ' + list.length + ' captures match · times and ids ignored</span></div><div style="background: #F3FAF9">' +
      list.map(function (sh, k) { return '<div class="sr">' + esc(sh.label) + '<code>' + esc(sh.what.replace(/^screen\s+/, '')) + '</code><span class="ck">' + (caps[k] && caps[k].match ? '✓ same' : '✗ differs') + '</span></div>'; }).join('') + '</div></div>';
  }

  // Slot 3: pipeline (GitHub Actions) and recipe (Dockerfile), read from the files.
  function workflow(text) {
    var on = (text.match(/^on:\s*\[?([^\]\n]*)\]?/m) || [])[1] || '';
    var trig = on.split(',').map(function (s) { return s.trim().replace('pull_request', 'pull request'); }).filter(Boolean).join(' · ');
    var steps = [], re = /^\s*-\s+(uses|run|name):\s*(.+)$/gm, m;
    var nodeV = (text.match(/node-version:\s*([\w.]+)/) || [])[1];
    while ((m = re.exec(text))) {
      var v = m[2].trim(), name, code;
      if (m[1] === 'uses') { var a = v.replace(/^actions\//, ''); code = a; name = /^checkout/.test(a) ? 'Get the code' : /^setup-node/.test(a) ? 'Set up Node ' + (nodeV || '') : a.split('@')[0]; }
      else if (m[1] === 'run') { code = v; name = /test/.test(v) ? 'Run the tests' : /build/.test(v) ? 'Build' : 'Run ' + v; }
      else { name = v; code = ''; }
      steps.push({ name: name.trim(), code: code });
    }
    return { trig: trig, steps: steps };
  }
  function dockerfile(text) {
    var rows = [], copies = [], port = '', cmd = '', raw = {};
    text.split('\n').forEach(function (l) {
      var m = l.match(/^\s*([A-Z]+)\s+(.+)$/); if (!m) return; var k = m[1], v = m[2].trim();
      if (k === 'FROM') { rows.push(['Starts from', v, l.trim()]); }
      else if (k === 'COPY') { copies.push(v.split(/\s+/).slice(0, -1).join(' ')); raw.copy = (raw.copy || '') + l; }
      else if (k === 'VOLUME') rows.push(['Keeps data in', v, l.trim()]);
      else if (k === 'USER') rows.push(['Runs as', v + (v === 'root' ? '' : ', not root'), l.trim()]);
      else if (k === 'EXPOSE') port = v;
      else if (k === 'CMD') { try { cmd = JSON.parse(v).join(' '); } catch (e) { cmd = v; } raw.cmd = l.trim(); }
    });
    if (copies.length) rows.splice(1, 0, ['Copies', copies.join(' '), raw.copy]);
    if (cmd) rows.push(['Starts with', cmd + (port ? ' on port ' + port : ''), raw.cmd]);
    return rows;
  }
  function filePanel(d, sh, cap) {
    var isNew = cap.before == null;
    var body;
    if (sh.kind === 'pipeline') {
      var w = workflow(cap.after || ''), pins = pinsOn(d, 'step');
      body = '<div class="panel"><span style="font: 600 12.5px Inter, sans-serif; color: #6B6B74">on ' + esc(w.trig) + '</span>' + w.steps.map(function (s) {
        var p = pins.filter(function (x) { return (s.code + ' ' + s.name).indexOf(x.target) >= 0; })[0];
        return '<div class="stp">' + esc(s.name) + '<code>' + esc(s.code) + '</code>' + (p ? '<span class="mk ' + p.t + '" style="right: -12px; top: -11px">' + p.n + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    } else {
      var rows = dockerfile(cap.after || ''), rp = pinsOn(d, 'row');
      body = '<div class="panel" style="gap: 0">' + rows.map(function (r) {
        var p = rp.filter(function (x) { return (r[1] + ' ' + (r[2] || '')).indexOf(x.target) >= 0; })[0];
        return '<div class="rr"><span>' + esc(r[0]) + '</span><code>' + esc(r[1]) + '</code>' + (p ? '<span class="mk ' + p.t + '" style="right: -12px; top: -4px">' + p.n + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    }
    return '<div style="flex: 1; display: flex; flex-direction: column; gap: 8px">' + sec(sh.label || (sh.kind === 'pipeline' ? 'What runs in CI' : 'What it is built from')) +
      (isNew ? '<span class="newtag">NEW · ' + (sh.kind === 'pipeline' ? 'nothing ran before' : 'there was no ' + (sh.kind === 'recipe' ? 'image' : 'file')) + '</span>' : '') + body + '</div>';
  }

  // Slot 3: scenario. Steps per version, then the outcome.
  function scenario(d, sh, cap, k) {
    var pins = pinsOn(d, 'outcome').filter(function (x) { return +x.target === k + 1; });
    function side(v, after) {
      var oc = v.outcome, col = { bad: ['#FDF0EE', '#B42318'], good: ['#E3F1EF', '#0F766E'], watch: ['#FDEBE1', '#C2410C'] }[oc.tone];
      var p = after ? pins[0] : null;
      return '<div class="half"><span class="tag"' + (after ? ' style="color: #0F766E"' : '') + '>' + (after ? 'AFTER' : 'BEFORE') + '</span><div class="sc">' +
        v.steps.map(function (s) { return '<div class="fr"' + (s[2] === 'watch' ? ' style="border-color: #C2410C"' : '') + '>' + esc(s[0]) + '<small>' + esc(s[1]) + '</small></div><span class="ar">→</span>'; }).join('') +
        '<div class="oc" style="background: ' + col[0] + '; border: 2px solid ' + col[1] + '"><b style="color: ' + col[1] + '">' + esc(oc.big) + '</b><span class="os">' + esc(oc.small) + '</span>' + (p ? '<span class="mk ' + p.t + '" style="right: -10px; top: -12px">' + p.n + '</span>' : '') + '</div></div></div>';
    }
    return sec('What happens when…', sh.label) + '<div style="display: flex; align-items: center">' + side(cap.before, false) + '<span class="arrow">→</span>' + side(cap.after, true) + '</div>';
  }

  // Slot 4: the map. Row 1 is the longest chain of today's boxes; the rest sit in row 2 under the box they connect to.
  function layout(d) {
    var base = d.order.filter(function (id) { return !d.nodes[id].born; });
    var adj = {}; base.forEach(function (id) { adj[id] = []; });
    d.edges.forEach(function (e) { if (!e.born && adj[e.from] && adj[e.to]) { adj[e.from].push(e.to); adj[e.to].push(e.from); } });
    var best = [];
    function walk(path) { if (path.length > best.length) best = path.slice(); adj[path[path.length - 1]].forEach(function (nx) { if (path.indexOf(nx) < 0) { path.push(nx); walk(path); path.pop(); } }); }
    walk([base[0]]);
    if (best.length < 2) base.forEach(function (id) { if (best.length < 2) walk([id]); });
    var row1 = best.slice(0, 3), n = row1.length;
    var W = n <= 3 ? [104, 104, 120] : [80, 92, 92, 120], X = n <= 3 ? [10, 170, 330] : [8, 108, 230, 340];
    if (n === 3 && d.order.some(function (id) { return d.nodes[id].born && between(id); })) { W = [80, 92, 120]; X = [8, 108, 330]; }
    function between(id) { var ins = d.edges.filter(function (e) { return e.to === id && row1.indexOf(e.from) >= 0; }), outs = d.edges.filter(function (e) { return e.from === id && row1.indexOf(e.to) >= 0; }); return ins.length && outs.length; }
    var pos = {}, used = {};
    row1.forEach(function (id, i) { pos[id] = { x: X[i], y: 22, w: W[i], col: i, row: 1 }; });
    var rest = d.order.filter(function (id) { return !pos[id]; });
    rest.filter(function (id) { return !d.nodes[id].born; }).forEach(function (id) { var c = 0; while (used[c]) c++; used[c] = 1; pos[id] = { x: X[c], y: 92, w: W[c], col: c, row: 2 }; });
    var row2of = function (id) { return d.edges.some(function (e) { var o = e.from === id ? e.to : e.to === id ? e.from : null; return o && pos[o] && pos[o].row === 2; }); };
    rest.filter(function (id) { return d.nodes[id].born; }).sort(function (a, b) { return row2of(b) - row2of(a); }).forEach(function (id) {
      var ins = d.edges.filter(function (e) { return e.to === id && pos[e.from] && pos[e.from].row === 1; }), outs = d.edges.filter(function (e) { return e.from === id && pos[e.to] && pos[e.to].row === 1; });
      if (ins.length && outs.length && pos[outs[0].to].x - (pos[ins[0].from].x + pos[ins[0].from].w) >= 110) { var a = pos[ins[0].from], b = pos[outs[0].to], w = 102; pos[id] = { x: Math.round((a.x + a.w + b.x) / 2 - w / 2), y: 96, w: w, col: a.col + 0.5, row: 2 }; used[Math.floor(a.col + 0.5)] = 1; return; }
      var partner = d.edges.filter(function (e) { return (e.from === id && pos[e.to]) || (e.to === id && pos[e.from]); }).map(function (e) { return pos[e.from === id ? e.to : e.from]; })[0];
      var c = partner ? Math.min(Math.floor(partner.col) + 1, W.length - 1) : 1;
      while (used[c] && c < W.length - 1) c++; while (used[c] && c > 0) c--;
      used[c] = 1; pos[id] = { x: X[c], y: partner && partner.y === 96 ? 96 : 92, w: Math.min(140, Math.max(W[c], d.nodes[id].label.length * 7.4 + 34)), col: c, row: 2 };
    });
    return pos;
  }
  function edgePath(a, b) {
    var ay = a.y + 20, by = b.y + 20;
    if (a.row === b.row && Math.abs(a.col - b.col) > 1) { var L = a.x < b.x ? a : b, Rr = a.x < b.x ? b : a, by2 = L.y + 40; return { d: 'M' + (L.x + L.w / 2) + ' ' + by2 + ' C ' + (L.x + L.w / 2) + ' ' + (by2 + 16) + ', ' + (Rr.x + Rr.w / 2) + ' ' + (by2 + 16) + ', ' + (Rr.x + Rr.w / 2) + ' ' + by2, mx: (L.x + Rr.x + Rr.w) / 2, my: by2 + 12 }; }
    if (a.row === b.row) { var l = a.x < b.x ? a : b, r = a.x < b.x ? b : a; return { d: 'M' + (l.x + l.w) + ' ' + (l.y + 20) + ' L' + r.x + ' ' + (r.y + 20), mx: (l.x + l.w + r.x) / 2, my: l.y + 20 }; }
    var top = a.row === 1 ? a : b, bot = a.row === 1 ? b : a;
    if (Math.abs((top.x + top.w / 2) - (bot.x + bot.w / 2)) < 30) return { d: 'M' + (top.x + top.w / 2) + ' ' + (top.y + 40) + ' L' + (bot.x + bot.w / 2) + ' ' + bot.y, mx: 0, my: 0 };
    if (Math.abs(top.col - bot.col) > 1) { var fx = top.x + top.w - 14, fy = top.y + 40, tx = bot.x + bot.w / 2, ty = bot.y; return { d: 'M' + fx + ' ' + fy + ' C ' + (fx + 10) + ' ' + (fy + 24) + ', ' + tx + ' ' + (ty - 26) + ', ' + tx + ' ' + ty, mx: 0, my: 0 }; }
    var sx = top.x + top.w / 2, sy = top.y + 40, ex = bot.x < top.x ? bot.x + bot.w : bot.x, ey = bot.y + 20;
    return { d: 'M' + sx + ' ' + sy + ' C ' + sx + ' ' + (sy + 30) + ', ' + (ex + (bot.x < top.x ? 30 : -30)) + ' ' + ey + ', ' + ex + ' ' + ey, mx: 0, my: 0 };
  }
  function strip(d, pos, after) {
    var svg = '', boxes = '', pins = '';
    d.edges.forEach(function (e) {
      if (!after && e.born) return;
      var a = pos[e.from], b = pos[e.to]; if (!a || !b) return; var p = edgePath(a, b);
      if (after && e.gone) {
        svg += '<path d="' + p.d + '" stroke="#B9B5AE" stroke-width="2" stroke-dasharray="6 6" fill="none"></path><path d="M' + (p.mx - 8) + ' ' + (p.my - 8) + ' L' + (p.mx + 8) + ' ' + (p.my + 8) + ' M' + (p.mx + 8) + ' ' + (p.my - 8) + ' L' + (p.mx - 8) + ' ' + (p.my + 8) + '" stroke="#8E8A84" stroke-width="2.4" stroke-linecap="round"></path>';
        var gm = d.marks.filter(function (m) { return m.edge === e && m.n; })[0];
        if (gm) pins += '<span class="mk x" style="left: ' + (p.mx - 13) + 'px; top: ' + (p.my - 40) + 'px">' + gm.n + '</span>';
      } else svg += '<path d="' + p.d + '" stroke="' + (after && e.born ? '#0F766E' : '#16161A') + '" stroke-width="' + (after && e.born ? 2.6 : 2) + '" fill="none"></path>';
    });
    d.order.forEach(function (id) {
      var n = d.nodes[id], p = pos[id]; if (!after && n.born) return;
      var cls = after ? (n.born ? 'new' : n.state === 'kept' ? 'kept' : n.state === 'changed' ? 'chg' : n.state === 'gone' ? 'gone' : '') : '';
      boxes += '<div class="sb ' + cls + '" style="left: ' + p.x + 'px; top: ' + p.y + 'px; width: ' + p.w + 'px' + (n.label.length > 14 ? '; font-size: 12px' : '') + '">' + (after && n.born ? '+ ' : '') + esc(n.label) + '</div>';
      if (!after) return;
      var ms = d.marks.filter(function (m) { return m.id === id && m.n && !(m.mark === 'watch' && m.pins.length); });
      if (ms.length) { var m = ms[0], t = tone(m); pins += '<span class="mk ' + t + '" style="left: ' + (t === 'k' ? p.x - 10 : p.x + p.w - 12) + 'px; top: ' + (p.y - 14) + 'px">' + m.n + '</span>'; }
    });
    return '<div class="strip"><svg width="470" height="150" style="position: absolute; left: 0; top: 0" aria-hidden="true">' + svg + '</svg>' + boxes + pins + '</div>';
  }

  function list(d) {
    var groups = [['New', ['new', 'changed', 'gone'], ''], ['Kept the same', ['kept'], ''], ['Try before you merge', ['watch'], '#C2410C']], out = '', first = true;
    groups.forEach(function (g) {
      var items = d.marks.filter(function (m) { return m.n && g[1].indexOf(m.mark) >= 0; }).sort(function (a, b) { return a.n - b.n; });
      if (!items.length && g[0] !== 'Try before you merge') return;
      out += '<span class="lbl" style="padding: ' + (first ? '0' : '14px') + ' 12px 4px' + (g[2] ? '; color: ' + (items.length ? g[2] : '#0F766E') : '') + '">' + g[0] + '</span>'; first = false;
      if (!items.length) { out += '<div class="li"><span class="lt" style="color: #6B6B74">Nothing. Every reply matched on both versions.</span></div>'; return; }
      items.forEach(function (m) {
        var q = m.said[0];
        out += '<div class="li' + (m.mark === 'watch' ? ' w' : '') + '"><span class="n ' + tone(m) + '">' + m.n + '</span><span class="lt">' + esc(m.line) + (q ? '<span class="q">“' + esc(q.text) + '” · ' + esc(d.by) + (q.at && d.chapters.length ? ', ' + esc(q.at) : '') + '</span>' : '') + '</span></div>';
      });
    });
    return out;
  }

  function render(d, caps, rep) {
    var watch = d.marks.filter(function (m) { return m.n && m.mark === 'watch'; }).length;
    var h = '<div class="card">';
    h += '<header style="display: flex; align-items: center; gap: 12px">' + LOGO + '<span style="font-weight: 700; font-size: 17px">Storydiff</span><span style="color: #D6D3CD">/</span><span style="font-weight: 600; font-size: 15px">' + esc(d.pr) + ' · ' + esc(d.title) + '</span><span style="font-size: 13px; color: #8E8A84">' + esc(d.by) + ', with ' + esc(d.agent) + ' · ' + d.files + ' files</span></header>';
    if (d.chapters.length) h += '<nav aria-label="Chapters" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap"><span class="lbl" style="margin-right: 4px">This PR does ' + d.chapters.length + ' things</span>' + d.chapters.map(function (c, i) { return '<span class="ch' + (i + 1 === d.chapter ? ' on' : '') + '"' + (c[0] === '+' ? ' style="border-style: dashed; color: #6B6B74"' : '') + '>' + (c[0] === '+' ? '' : (i + 1) + ' · ') + esc(c) + '</span>'; }).join('') + '</nav>';
    h += '<section aria-label="Asked and did" style="display: grid; grid-template-columns: 120px 1fr; row-gap: 8px; align-items: baseline"><span class="lbl">' + esc(d.by) + ' asked</span><span style="font: 600 28px/1.2 Inter, sans-serif; letter-spacing: -0.015em">“' + esc(d.ask) + '”</span><span class="lbl">' + esc(d.agent.split(' ')[0]) + ' did</span><span style="font: 500 17px/1.4 Inter, sans-serif; color: #3F3F46">' + esc(d.did) + '</span></section>';
    h += '<section aria-label="Verdict" style="display: flex; gap: 8px; flex-wrap: wrap">' +
      (rep.failed ? '<span class="vt" style="background: #B42318; color: #FFFFFF">✗ ' + rep.failed + ' old tests now fail</span>' : '<span class="vt" style="background: #E3F1EF; color: #0B4F4A">✓ All ' + rep.oldPass + ' old tests still pass</span>') +
      (rep.newTests ? '<span class="vt" style="background: #FFFFFF; border: 1px solid #E6E3DD; color: #3F3F46">' + rep.newTests + ' new tests</span>' : '') +
      '<span class="vt" style="background: #FFFFFF; border: 1px solid #E6E3DD; color: #3F3F46">✓ ' + rep.claims + ' claims checked</span>' +
      (watch ? '<span class="vt" style="background: #C2410C; color: #FFFFFF">' + watch + ' thing' + (watch > 1 ? 's' : '') + ' to try</span>' : '<span class="vt" style="background: #E3F1EF; color: #0B4F4A">✓ Nothing to try</span>') + '</section>';
    // Slot 3
    var col = '', shows = d.shows, onlySame = shows.length && shows.every(function (s) { return s.kind === 'same'; }), si = 0, sc = 0, files = [];
    if (onlySame) col += sameBlock(shows, caps.same || []);
    else shows.forEach(function (sh, k) {
      if (sh.kind === 'screen') col += screen(d, sh, caps.screen);
      else if (sh.kind === 'call') col += '<div style="margin-top: 8px"></div>' + call(d, sh, caps.call);
      else if (sh.kind === 'same') col += sameLine(d, sh, si++);
      else if (sh.kind === 'scenario') col += (sc ? '<div style="margin-top: 6px"></div>' : '') + scenario(d, sh, caps.scenario[sc], sc++);
      else { files.push(filePanel(d, sh, caps.files[sh.file])); if (!shows[k + 1] || ['pipeline', 'recipe'].indexOf(shows[k + 1].kind) < 0) { col += '<div style="display: flex; gap: 24px">' + files.join('') + '</div>'; files = []; } }
    });
    var pos = layout(d);
    col += '<div style="display: flex; align-items: baseline; gap: 10px; margin-top: 8px"><span class="lbl">What changed underneath</span></div><div style="display: flex; align-items: center">' + strip(d, pos, false) + '<span class="arrow">→</span>' + strip(d, pos, true) + '</div>';
    h += '<div style="display: flex; gap: 28px; align-items: flex-start"><div style="flex: none; width: 1004px; display: flex; flex-direction: column; gap: 12px">' + col + '</div>';
    h += '<aside aria-label="The list" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-top: 20px">' + list(d) + '</aside></div>';
    h += '<footer style="display: flex; align-items: center; gap: 16px; margin-top: 8px"><span style="display: inline-flex; align-items: center; gap: 8px; font: 600 14px Inter, sans-serif; color: #FFFFFF; background: #16161A; border-radius: 999px; padding: 10px 16px"><svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2 L13 8 L4 14 Z" fill="#FFFFFF"></path></svg>Walk me through it</span><span style="font-size: 13px; color: #8E8A84">Details: ' + (d.files > 20 ? d.files + ' files' : 'files') + ', every check, ' + esc(d.by) + "'s session" + '</span></footer></div>';
    return h;
  }
  function page(inner, title) { return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + esc(title) + '</title>' + FONTS + '<style>' + CSS + '</style></head><body>' + inner + '</body></html>'; }
  return { render: render, page: page, CSS: CSS, FONTS: FONTS };
})();
if (typeof module !== 'undefined') module.exports = RENDER;
