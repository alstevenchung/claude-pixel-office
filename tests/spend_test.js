// End-to-end test of the 'spend' (damage number) events. Uses a FAKE home directory, so real transcripts are never touched.
// Run: node tests/spend_test.js   (takes ~25 s)
const ROOT = require('path').join(__dirname, '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'po-home-'));
const dir = path.join(fakeHome, '.claude', 'projects', 'proj');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'sess-1.jsonl');
const line = (id, ts, o, i, cw, cr, extra) => JSON.stringify({ timestamp: ts, sessionId: 'sess-1', ...extra, message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr } } }) + '\n';
const now = () => new Date().toISOString();
fs.writeFileSync(file, line('m0', now(), 5000, 10, 20000, 999999));   // existing history: must NOT produce a number

const PORT = 8896;
const srv = spawn('node', ['server/server.js'], { cwd: ROOT, env: { ...process.env, USERPROFILE: fakeHome, HOME: fakeHome, PORT: String(PORT) } });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const events = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);

(async () => {
  await sleep(1500);
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/events', headers: { Host: '127.0.0.1:' + PORT } }, (res) => {
    res.on('data', (c) => { for (const l of String(c).split('\n')) if (l.startsWith('data: ')) { try { events.push(JSON.parse(l.slice(6))); } catch {} } });
  });
  await sleep(3500);                                                     // baseline poll happens here
  check('history is NOT replayed as spend', !events.some((e) => e.type === 'spend'), 'spend events so far: ' + events.filter((e) => e.type === 'spend').length);
  fs.appendFileSync(file, line('m1', now(), 1200, 3, 2500, 888888));     // 3703 tokens (cache read excluded)
  await sleep(6000);
  const s1 = events.filter((e) => e.type === 'spend');
  check('new message -> one spend event', s1.length === 1, JSON.stringify(s1));
  check('amount = input+output+cache-write, cache reads excluded', s1[0] && s1[0].tokens === 3703, 'got ' + (s1[0] && s1[0].tokens));
  check('event carries the session id', s1[0] && s1[0].id === 'sess-1');
  fs.appendFileSync(file, line('m2', now(), 20, 1, 0, 50000));           // 21 tokens: under the threshold
  await sleep(6000);
  check('tiny change is held back (<100)', events.filter((e) => e.type === 'spend').length === 1);
  fs.appendFileSync(file, line('m3', now(), 800, 0, 100, 0, { isSidechain: true }));   // sub-agent message, same session id
  await sleep(6000);
  const s2 = events.filter((e) => e.type === 'spend');
  check('held-back tokens + sub-agent message accumulate (21+900)', s2.length === 2 && s2[1].tokens === 921, JSON.stringify(s2[1]));
  req.destroy(); srv.kill();
  console.log(results.join('\n'));
  console.log(results.some((r) => r.startsWith('FAIL')) ? '\nSOME FAILED\n' + log : '\nALL PASSED');
  fs.rmSync(fakeHome, { recursive: true, force: true });
})();
