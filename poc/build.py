#!/usr/bin/env python3
"""Run the checker on each dummy PR and inline everything into one page (index.html)."""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
DUMMY = os.path.join(HERE, '..', 'dummy')
TASKS = os.path.join(HERE, '..', '..', 'tasks')

# name, kind, worktree, session transcript (subagent output file or CLI session id), how the session ran
PRS = json.load(open(os.path.join(HERE, 'prs.json')))
examples = []
for pr in PRS:
    wt = os.path.join(DUMMY, 'linkbox-' + pr['wt'])
    spec_path = os.path.join(wt, 'handover.storydiff')
    if not os.path.exists(spec_path):
        print('skip (no handover yet):', pr['wt']); continue
    subprocess.run(['git', '-C', wt, 'add', '-A'], check=True)
    if subprocess.run(['git', '-C', wt, 'diff', '--cached', '--quiet']).returncode:
        subprocess.run(['git', '-C', wt, '-c', 'user.name=dev', '-c', 'user.email=dev@example.com', 'commit', '-qm', 'pr-' + pr['wt']], check=True)
    sess = pr['session']
    if not sess.count('-') == 4: sess = os.path.join(TASKS, sess + '.output')
    out = subprocess.run(['node', os.path.join(HERE, 'verify.js'), wt, 'main', sess], capture_output=True, text=True)
    if out.returncode: print(out.stderr); sys.exit(1)
    rep = json.loads(out.stdout)
    print(pr['wt'], rep['sum'], rep['diffstat'], 'human msgs', rep['humanMessages'])
    examples.append({'key': pr['wt'], 'name': pr['name'], 'kind': pr['kind'],
                     'source': 'Dummy PR · ' + rep['diffstat'] + ' · spec written by the agent at the end of its own session (' + pr['how'] + ')',
                     'spec': rep['spec'], 'report': {'sum': rep['sum'], 'checks': rep['checks'], 'tests': rep['tests']}})

# One real commit with no session, written afterwards from the diff, for contrast.
q = open(os.path.join(HERE, 'quietkey.storydiff')).read()
examples.append({'key': 'quietkey', 'name': 'Quietkey · dark mode fix', 'kind': 'No session',
                 'source': 'Real commit cc67826 in Quietkey · 1 file, +4 −1 · no session log, so the spec was written afterwards from the diff',
                 'spec': q, 'note': 'Written afterwards from the diff, so there are no human quotes to check. The checker was not run on this one.'})

page = open(os.path.join(HERE, 'page.html')).read()
inline = lambda p: open(os.path.join(HERE, p)).read().replace('</script', '<\\/script')
page = page.replace('/*CORE*/', inline('core.js')).replace('/*APP*/', inline('app.js'))
page = page.replace('/*SPECS*/', 'var EXAMPLES = ' + json.dumps(examples, ensure_ascii=False).replace('</', '<\\/') + ';')
open(os.path.join(HERE, 'index.html'), 'w').write(page)
print('wrote index.html', len(page) // 1024, 'KB,', len(examples), 'examples')
