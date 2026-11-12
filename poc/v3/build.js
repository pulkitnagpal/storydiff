// Build the POC: capture, render each card from its spec, then render the matching canvas board for comparison.
const fs = require('fs'), path = require('path');
const SPEC = require('./spec.js'), R = require('./render.js'), { shoot, capture } = require('./shot.js');
const HERE = __dirname, BOARDS = path.join(HERE, '..', 'baton', 'project');
const CARDS = [['tags', 'Card', 1040], ['infra', 'CardInfra', 830], ['refactor', 'CardRefactor', 810], ['big', 'CardBig', 870]];
const uri = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');

(async () => {
  const out = path.join(HERE, 'out'); fs.mkdirSync(out, { recursive: true });
  const only = process.argv[2];
  for (const [key, board, h] of CARDS) {
    if (only && only !== key) continue;
    const dir = path.join(HERE, 'data', key);
    const d = SPEC.parse(fs.readFileSync(path.join(dir, 'handover.storydiff'), 'utf8'));
    const caps = JSON.parse(fs.readFileSync(path.join(dir, 'captures.json'), 'utf8'));
    const rep = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
    if (d.shows.some(s => s.kind === 'screen')) {
      // Screens: the old and new app, captured headless. The pins' positions are measured, never placed by hand.
      const sels = []; d.marks.forEach(m => m.pins.forEach(p => { if (p.on === 'screen' && p.target !== 'page') sels.push(p.target); }));
      await capture('file://' + path.join(HERE, 'apps', 'linkbox-before.html'), path.join(dir, 'before.png'), { width: 466, height: 252 });
      const rects = await capture('file://' + path.join(HERE, 'apps', 'linkbox-after.html'), path.join(dir, 'after.png'), { width: 466, height: 252, measure: sels });
      caps.screen = { app: 'Linkbox', before: uri(path.join(dir, 'before.png')), after: uri(path.join(dir, 'after.png')), rects };
      const missing = rects.filter(r => !r.found); if (missing.length) console.log(key, 'pins not found (not drawn):', missing.map(r => r.sel).join(', '));
    }
    if (caps.files) for (const f of Object.keys(caps.files)) { const c = caps.files[f]; caps.files[f] = { before: c.before && fs.readFileSync(path.join(dir, c.before), 'utf8'), after: c.after && fs.readFileSync(path.join(dir, c.after), 'utf8') }; }
    fs.writeFileSync(path.join(out, key + '.html'), R.page(R.render(d, caps, rep), 'Storydiff · ' + d.title));
    await shoot('file://' + path.join(out, key + '.html'), path.join(out, key + '-generated.png'), { width: 1440, height: h, settle: 1200 });
    await shoot('file://' + path.join(BOARDS, board + '.dc.html'), path.join(out, key + '-design.png'), { width: 1440, height: h, settle: 1200 });
    console.log('rendered', key, '| list', d.marks.filter(m => m.n).length, 'items');
  }
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
