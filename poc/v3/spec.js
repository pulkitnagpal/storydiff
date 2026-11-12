// Storydiff spec v0.3: the language behind the review card. Pure function, no DOM.
//
//   pr "Linkbox #12" files 5
//   title "Tags for links"
//   by "Maya" with "Claude Code"
//   ask "..."            the human's words
//   did "..."            one line on the approach
//   chapters "Charge customers once", "Retry slow charges", "+ 6 smaller changes"
//   chapter 1
//   show screen /path ["label" ["hint"]]
//   show call METHOD /path [{json}] ["label" ["hint"]]
//   show same "label" (screen /path | METHOD /path)
//   show pipeline <file> ["label"]      show recipe <file> ["label"]
//   show scenario "what happens when…"
//   <kind> <id> "Label"                 a box on the map, as it is today
//   a -> b                              an arrow on the map
//   + | ~ | - | = | !  [box | id | a -> b]  "one line for the list"
//       said [@00:41] "the human's words"   proof <file:line | test name>   eng "..."
//       pin screen "<css>" | pin call "<field>" | pin step "<text>" | pin row "<text>" | pin outcome <n> | pin same <n>
var SPEC = (function () {
  var KINDS = ['service', 'screen', 'part', 'code', 'endpoint', 'table', 'queue', 'job', 'store', 'external', 'file', 'test', 'user', 'config'];
  var MARKS = { '+': 'new', '~': 'changed', '-': 'gone', '=': 'kept', '!': 'watch' };
  function fail(i, msg) { var e = new Error('Line ' + (i + 1) + ': ' + msg); e.line = i + 1; throw e; }
  function tokens(text, i) {
    var out = [], re = /\s*(?:"((?:[^"\\]|\\.)*)"|(->)|(\{.*\})|([^\s"]+))/g, m, pos = 0;
    while (pos < text.length) {
      re.lastIndex = pos; m = re.exec(text);
      if (!m || m.index !== pos || m[0].trim() === '') break;
      if (m[1] !== undefined) out.push({ s: m[1].replace(/\\"/g, '"'), q: true });
      else if (m[2]) out.push({ s: '->', arrow: true });
      else if (m[3]) out.push({ s: m[3], json: true });
      else out.push({ s: m[4] });
      pos = re.lastIndex;
    }
    if (text.slice(pos).trim() !== '') fail(i, 'an opening " has no closing "');
    return out;
  }
  function strip(line) { var q = false; for (var k = 0; k < line.length; k++) { if (line[k] === '"' && line[k - 1] !== '\\') q = !q; if (line[k] === '#' && !q) return line.slice(0, k); } return line; }
  function quotes(t, from) { var o = []; for (var k = from; k < t.length; k++) if (t[k].q) o.push(t[k].s); return o; }

  function parse(src) {
    var d = { pr: '', files: 0, title: '', by: '', agent: '', ask: '', did: '', chapters: [], chapter: 0, shows: [], nodes: {}, order: [], edges: [], marks: [] };
    var lines = src.replace(/\t/g, '  ').split('\n'), mark = null, mIndent = -1;
    function node(id, i) { if (!d.nodes[id]) fail(i, '"' + id + '" is not on the map yet. Add it first, like: code ' + id + ' "Label"'); return d.nodes[id]; }
    function edge(a, b) { for (var k = 0; k < d.edges.length; k++) if (d.edges[k].from === a && d.edges[k].to === b) return d.edges[k]; return null; }
    for (var i = 0; i < lines.length; i++) {
      var raw = strip(lines[i]); if (!raw.trim()) continue;
      var ind = raw.match(/^ */)[0].length, text = raw.trim(), t = tokens(text, i), h = t[0].s;
      if (mark && ind > mIndent) {
        if (h === 'said') { var at = t[1] && /^@/.test(t[1].s) ? t[1].s.slice(1) : '', q = t[at ? 2 : 1]; if (!q || !q.q) fail(i, 'said needs a "quote"'); mark.said.push({ at: at, text: q.s }); }
        else if (h === 'proof') { var p = text.slice(5).trim(); if (!p) fail(i, 'proof needs a file:line or a test name'); mark.proofs.push(p); }
        else if (h === 'eng') { if (!t[1] || !t[1].q) fail(i, 'eng needs a "sentence"'); mark.eng = t[1].s; }
        else if (h === 'pin') {
          var where = t[1] && t[1].s, what = t[2];
          if (['screen', 'call', 'step', 'row', 'outcome', 'same'].indexOf(where) < 0 || !what) fail(i, 'pin needs a place and a target, like: pin screen "#filter"');
          mark.pins.push({ on: where, target: what.s });
        } else fail(i, 'under a mark, use said, proof, eng or pin');
        continue;
      }
      mark = null; mIndent = -1;
      if (h === 'pr') { d.pr = t[1] && t[1].s; for (var k = 2; k < t.length; k++) if (t[k].s === 'files') d.files = +t[k + 1].s; continue; }
      if (h === 'title' || h === 'ask' || h === 'did') { if (!t[1] || !t[1].q) fail(i, h + ' needs a "sentence"'); d[h] = t[1].s; continue; }
      if (h === 'by') { d.by = t[1] && t[1].s; d.agent = t[3] ? t[3].s : ''; continue; }
      if (h === 'chapters') { d.chapters = quotes(t, 1); continue; }
      if (h === 'chapter') { d.chapter = +t[1].s; continue; }
      if (h === 'show') {
        var kind = t[1] && t[1].s, sh = { kind: kind };
        if (kind === 'screen') { sh.path = t[2] && !t[2].q ? t[2].s : '/'; var qs = quotes(t, 2); sh.label = qs[0]; sh.hint = qs[1]; }
        else if (kind === 'call') { if (!t[2] || !t[3]) fail(i, 'show call needs METHOD /path'); sh.method = t[2].s.toUpperCase(); sh.path = t[3].s; if (t[4] && t[4].json) sh.body = JSON.parse(t[4].s); var qc = quotes(t, 4); sh.label = qc[0]; sh.hint = qc[1]; }
        else if (kind === 'same') { sh.label = t[2] && t[2].s; sh.what = t.slice(3).map(function (x) { return x.s; }).join(' '); }
        else if (kind === 'pipeline' || kind === 'recipe') { sh.file = t[2] && t[2].s; sh.label = quotes(t, 3)[0]; if (!sh.file) fail(i, 'show ' + kind + ' needs a file'); }
        else if (kind === 'scenario') { sh.label = t[2] && t[2].s; if (!sh.label) fail(i, 'show scenario needs "what happens when…"'); }
        else fail(i, 'show needs one of: screen, call, same, pipeline, recipe, scenario');
        d.shows.push(sh); continue;
      }
      if (MARKS[text[0]] && text[1] === ' ') {
        var mt = tokens(text.slice(2), i), m = { mark: MARKS[text[0]], line: '', id: null, edge: null, said: [], proofs: [], pins: [], eng: '' };
        var last = mt.length && mt[mt.length - 1].q ? mt.pop().s : '';
        m.line = last;
        if (mt.length >= 3 && mt[1].arrow) {
          var e = edge(mt[0].s, mt[2].s);
          if (m.mark === 'new') { if (e) fail(i, 'that arrow already exists'); node(mt[0].s, i); node(mt[2].s, i); e = { from: mt[0].s, to: mt[2].s, born: true, gone: false }; d.edges.push(e); }
          else { if (!e) fail(i, 'no arrow ' + mt[0].s + ' -> ' + mt[2].s + ' on the map'); if (m.mark === 'gone') e.gone = true; }
          m.edge = e;
        } else if (mt.length >= 2 && KINDS.indexOf(mt[0].s) >= 0) {
          // One quote on a box is its label; a second one is the list line.
          if (!(mt[2] && mt[2].q) && m.line) { mt.push({ s: m.line, q: true }); m.line = ''; }
          var label = mt[2] && mt[2].q ? mt[2].s : mt[1].s;
          if (d.nodes[mt[1].s]) fail(i, '"' + mt[1].s + '" is already on the map; refer to it by its id');
          d.nodes[mt[1].s] = { id: mt[1].s, kind: mt[0].s, label: label, born: m.mark === 'new', state: m.mark, order: d.order.length }; d.order.push(mt[1].s);
          m.id = mt[1].s;
        } else if (mt.length === 1) { var n = node(mt[0].s, i); m.id = n.id; if (n.state === 'base') n.state = m.mark; }
        else if (mt.length > 1) fail(i, 'a mark points at a box ("table tags \\"Tags\\""), an id, an arrow, or nothing');
        if (!m.line && !m.edge && !(m.id && d.nodes[m.id].born)) fail(i, 'every mark needs its one line for the list, in "quotes" at the end');
        if (m.line && m.line.split(/\s+/).length > 16) fail(i, 'keep the list line to 16 words or fewer');
        d.marks.push(m); mark = m; mIndent = ind; continue;
      }
      if (t.length >= 3 && t[1].arrow) { node(t[0].s, i); node(t[2].s, i); d.edges.push({ from: t[0].s, to: t[2].s, born: false, gone: false }); continue; }
      if (t.length >= 2 && KINDS.indexOf(h) >= 0) {
        if (d.nodes[t[1].s]) fail(i, '"' + t[1].s + '" is declared twice');
        d.nodes[t[1].s] = { id: t[1].s, kind: h, label: t[2] && t[2].q ? t[2].s : t[1].s, born: false, state: 'base', order: d.order.length }; d.order.push(t[1].s); continue;
      }
      fail(i, 'unknown line');
    }
    // Number the list: new things first, then what was kept, then what to try. Pins share these numbers.
    var rank = { new: 0, changed: 0, gone: 0, kept: 1, watch: 2 }, n = 0;
    d.marks.filter(function (m) { return m.line; }).sort(function (a, b) { return rank[a.mark] - rank[b.mark] || d.marks.indexOf(a) - d.marks.indexOf(b); }).forEach(function (m) { m.n = ++n; });
    if (n > 7) fail(0, 'the list holds at most 7 items; split the PR into chapters');
    return d;
  }
  return { parse: parse, KINDS: KINDS };
})();
if (typeof module !== 'undefined') module.exports = SPEC;
