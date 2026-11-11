// Render the office page to a PNG with headless Edge/Chrome, using FAKE data (no server, no hooks needed).
// Handy for checking visual changes without the live window.
//
//   node tests/preview.js scenario.json out.png
//
// scenario.json (all fields optional):
//   {
//     "agents": [ {"id":"1","name":"Shop","state":"coding","action":"編輯 main.js","model":"claude-sonnet-5-5"},
//                 {"id":"2","name":"Shop","state":"coding","action":"提交 PR","activity":"pr"},
//                 {"id":"1#a","kind":"helper","parent":"1","name":"Explore","state":"coding"} ],
//     "spend":    [ {"id":"1","tokens":3703,"at":4300} ],      // damage numbers ("at" = ms into the animation)
//     "events":   [ {"type":"prompt","id":"1","at":4300} ],    // any server event, e.g. the "got it!" hop
//     "bossShow": {"id":"1","line":"客戶在等欸！","at":300},   // put the boss next to a person, already nagging
//     "whip":     [ {"id":"1","at":4300} ],                    // click-whip a person
//     "budget": 5300,                                          // virtual ms to run before the screenshot
//     "size":   [1280, 900]
//   }
// Agents that are not idle are placed at their desks (so you see the steady state, not the walk-in).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const [scenarioFile, outFile] = process.argv.slice(2);
if (!outFile) { console.error('usage: node tests/preview.js scenario.json out.png'); process.exit(1); }
const sc = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
const WEB = path.join(__dirname, '..', 'web');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'po-preview-'));
for (const f of fs.readdirSync(WEB)) fs.copyFileSync(path.join(WEB, f), path.join(tmp, f));

const usage = { today: { used: 510000 }, week: { used: 9300000 }, dailyBudget: 3000000, weeklyBudget: 15000000,
  sessions: Object.fromEntries((sc.agents || []).filter((a) => a.model).map((a) => [a.id, a.model])) };
const stub = `<script>
window.fetch = () => Promise.resolve({ json: () => Promise.resolve(${JSON.stringify(usage)}) });
window.EventSource = class { constructor() { window.__es = this; setTimeout(() => { this.onopen && this.onopen();
  this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'snapshot', agents: ${JSON.stringify(sc.agents || [])} }) }); }, 10); } };
</script>`;
const at = (o, d) => Number(o.at) || d;
const after = `<script>
setTimeout(() => { [...agents.values()].forEach((a) => { const d = DESKS[a.desk];
  if (a.state !== 'idle' && !(a.state === 'coding' && a.activity === 'pr')) { a.x = d.x + 22; a.y = d.y + 30; }
  else if (a.activity === 'pr') { a.x = 288; a.y = 98; }
  else { a.x = 262 + (a.desk % 3) * 10; a.y = 150; a.tx = a.x; a.ty = a.y; a.wander = 1e12; } });
  [...helpers.values()].forEach((h) => (h.born = -9999)); }, 100);
${(sc.spend || []).map((s) => `setTimeout(() => window.__es.onmessage({ data: JSON.stringify({ type: 'spend', id: ${JSON.stringify(s.id)}, tokens: ${Number(s.tokens)} }) }), ${at(s, 4300)});`).join('\n')}
${(sc.events || []).map((e) => `setTimeout(() => window.__es.onmessage({ data: JSON.stringify(${JSON.stringify(e)}) }), ${at(e, 4300)});`).join('\n')}
${sc.bossShow ? `setTimeout(() => window.__po.bossShowNow(${JSON.stringify(sc.bossShow.id)}, ${JSON.stringify(sc.bossShow.line || '')}), ${at(sc.bossShow, 300)});` : ''}
${(sc.whip || []).map((w) => `setTimeout(() => window.__po.whipAgent(${JSON.stringify(w.id)}), ${at(w, 4400)});`).join('\n')}
</script>`;
let html = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
html = html.replace('<script src="sprites.js">', stub + '\n<script src="sprites.js">').replace('<script src="hud.js"></script>', '<script src="hud.js"></script>\n' + after);
fs.writeFileSync(path.join(tmp, 'preview.html'), html);

const pf = process.env['ProgramFiles'] || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', lad = process.env.LOCALAPPDATA || '';
const browser = [`${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`, `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${pf}\\Google\\Chrome\\Application\\chrome.exe`, `${pf86}\\Google\\Chrome\\Application\\chrome.exe`, `${lad}\\Google\\Chrome\\Application\\chrome.exe`]
  .find((p) => fs.existsSync(p));
if (!browser) { console.error('No Edge/Chrome found'); process.exit(1); }
const [w, h] = sc.size || [1280, 900];
const out = path.resolve(outFile);
fs.rmSync(out, { force: true });
const r = spawnSync(browser, ['--headless=new', '--disable-gpu', `--user-data-dir=${path.join(tmp, 'profile')}`, `--window-size=${w},${h}`,
  `--virtual-time-budget=${sc.budget || 5300}`, `--screenshot=${out}`, 'file:///' + path.join(tmp, 'preview.html').replace(/\\/g, '/')], { timeout: 60000 });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fs.existsSync(out) ? 'wrote ' + out : 'FAILED to write screenshot' + (r.error ? ': ' + r.error.message : ''));
