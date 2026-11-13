// Tests the BOSS decision logic in the real page (headless Edge/Chrome, fake data, no server).
//   - "waiting" (your message is queued): the boss comes, in a hurry, and STAYS until it is picked up
//   - with two people waiting he finishes with the first one, then goes to the second, then leaves
//   - a normal prompt only brings the boss when the dice say so (Math.random is stubbed to prove both outcomes)
// Run: node tests/boss_logic_test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const WEB = path.join(__dirname, '..', 'web');
const pf = process.env['ProgramFiles'] || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', lad = process.env.LOCALAPPDATA || '';
const browser = [`${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`, `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`, `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
  `${pf86}\\Google\\Chrome\\Application\\chrome.exe`, `${lad}\\Google\\Chrome\\Application\\chrome.exe`].find((p) => fs.existsSync(p));
if (!browser) { console.error('No Edge/Chrome found'); process.exit(1); }

function runPage(rnd, script) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'po-boss-'));
  const copyDir = (from, to) => { fs.mkdirSync(to, { recursive: true }); for (const e of fs.readdirSync(from, { withFileTypes: true })) { if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name)); else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name)); } };   // (no fs.cpSync: it dies silently on this machine with non-ASCII paths)
  copyDir(WEB, tmp);
  const agents = [{ id: '1', name: 'shop', state: 'thinking' }, { id: '2', name: 'api', state: 'thinking' }];
  const stub = `<script>
Math.random = () => ${rnd};
window.__noRender = true;
window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ today: { used: 0 }, week: { used: 0 }, dailyBudget: 1, weeklyBudget: 1, sessions: {} }) });
window.EventSource = class { constructor() { window.__es = this; setTimeout(() => { this.onmessage({ data: JSON.stringify({ type: 'snapshot', agents: ${JSON.stringify(agents)} }) }); }, 10); } };
</script>`;
  const send = (m, at) => `setTimeout(() => window.__es.onmessage({ data: JSON.stringify(${JSON.stringify(m)}) }), ${at});`;
  // headless dump-dom does not run animation frames, so run one frame of boss logic by hand before reading its state
  const probe = (at, label) => `setTimeout(() => { try { __po.updateBoss(performance.now(), 0.016); } catch (e) {} window.__probe = window.__probe || {}; const b = __po.boss;
    window.__probe['${label}'] = { state: b.state, id: b.id, hurry: b.hurry, hold: b.hold, hurryLine: __po.BOSS_HURRY_LINES.includes(b.line), queued: b.queue.length, queue0: b.queue[0] && b.queue[0].id,
      waiting1: __po.agents.get('1').waiting || 0, waiting2: __po.agents.get('2').waiting || 0 }; document.title = JSON.stringify(window.__probe); }, ${at});`;
  let html = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
  html = html.replace('<script src="vendor/three.min.js">', () => stub + '\n<script src="vendor/three.min.js">').replace('<script src="hud.js"></script>', '<script src="hud.js"></script>\n<script>' + script({ send, probe }) + '</script>');
  fs.writeFileSync(path.join(tmp, 'page.html'), html);
  const r = spawnSync(browser, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--user-data-dir=${path.join(tmp, 'profile')}`, '--virtual-time-budget=9000', '--dump-dom',
    'file:///' + path.join(tmp, 'page.html').replace(/\\/g, '/')], { encoding: 'utf8', timeout: 60000 });
  fs.rmSync(tmp, { recursive: true, force: true });
  const m = /<title>([\s\S]*?)<\/title>/.exec(r.stdout || '');
  try { return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch { return null; }
}

const results = [];
const check = (n, ok, d) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`);

const A = runPage(0.9, ({ send, probe }) => [
  send({ type: 'waiting', id: '1', n: 1 }, 300), probe(800, 'a1'),             // your message is queued
  send({ type: 'waiting', id: '2', n: 1 }, 1500), probe(2000, 'a2'),           // a second session is waiting too
  send({ type: 'waiting', id: '1', n: 0 }, 2500), probe(3000, 'a3'),           // the first one is picked up
  send({ type: 'waiting', id: '2', n: 0 }, 4000), probe(4500, 'a4'),           // the second one is picked up
].join('\n'));
check('page ran and reported', !!A);
if (A) {
  check('queued message: the boss comes, in a hurry, and holds', A.a1.state !== 'away' && A.a1.id === '1' && A.a1.hurry && A.a1.hold && A.a1.hurryLine, JSON.stringify(A.a1));
  check('person 1 is marked as waiting', A.a1.waiting1 === 1);
  check('a second waiting person does not pull him away from the first', A.a2.id === '1' && A.a2.hold && A.a2.waiting2 === 1, JSON.stringify(A.a2));
  check('first picked up -> he moves on to the person who is still waiting', A.a3.id === '2' && A.a3.hold && A.a3.waiting1 === 0, JSON.stringify(A.a3));
  check('everyone picked up -> he stops holding and leaves', !A.a4.hold && (A.a4.state === 'out' || A.a4.state === 'nag' || A.a4.state === 'away') && A.a4.waiting2 === 0, JSON.stringify(A.a4));
}
const Bno = runPage(0.9, ({ send, probe }) => [send({ type: 'prompt', id: '1' }, 300), probe(900, 'b')].join('\n'));
check('normal prompt, unlucky dice: no boss', Bno && Bno.b.state === 'away' && Bno.b.queued === 0, JSON.stringify(Bno && Bno.b));
const Byes = runPage(0.1, ({ send, probe }) => [send({ type: 'prompt', id: '1' }, 300), probe(900, 'b')].join('\n'));
check('normal prompt, lucky dice: boss comes (even for the first prompt after page load), not in a hurry', Byes && Byes.b.state !== 'away' && Byes.b.id === '1' && !Byes.b.hurry && !Byes.b.hold, JSON.stringify(Byes && Byes.b));
console.log(results.join('\n'));
console.log(results.some((r) => r.startsWith('FAIL')) ? '\nSOME FAILED' : '\nALL PASSED');
