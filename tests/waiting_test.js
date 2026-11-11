// "Your message is queued" detection, end to end with a FAKE home directory (real transcripts are never touched).
// Claude Code logs queue-operation lines (enqueue / remove / dequeue) when you send a message while it is busy.
// Checks: history is ignored, the waiting count follows enqueue/remove/dequeue, and the message text is never relayed.
// Run: node tests/waiting_test.js   (takes ~20 s)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'po-wait-'));
const dir = path.join(fakeHome, '.claude', 'projects', 'proj');
fs.mkdirSync(dir, { recursive: true });
const SID = '11111111-2222-3333-4444-555555555555';
const file = path.join(dir, SID + '.jsonl');
const SECRET = 'SECRET-QUEUED-TEXT please drop the production database';
const line = (op, ts) => JSON.stringify({ type: 'queue-operation', operation: op, timestamp: ts, sessionId: SID, content: SECRET }) + '\n';
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const now = () => new Date().toISOString();
// history from last week: must NOT make anyone "waiting"
fs.writeFileSync(file, line('enqueue', ago(7 * 24 * 3600 * 1000)) + line('enqueue', ago(7 * 24 * 3600 * 1000)) + line('remove', ago(6 * 24 * 3600 * 1000)));

const PORT = 8890;
const srv = spawn('node', ['server/server.js'], { cwd: ROOT, env: { ...process.env, USERPROFILE: fakeHome, HOME: fakeHome, PORT: String(PORT), PIXEL_OFFICE_STATE: path.join(fakeHome, 'state.json') } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`);
const waits = []; let rawStream = '';
const watch = (path_, store) => http.get({ host: '127.0.0.1', port: PORT, path: path_, headers: { Host: '127.0.0.1:' + PORT } }, (res) => {
  res.on('data', (c) => { rawStream += c; for (const l of String(c).split('\n')) if (l.startsWith('data: ')) { try { const j = JSON.parse(l.slice(6)); if (j.type === 'waiting') store.push(j.n); } catch {} } });
});

(async () => {
  await sleep(2000);
  const req = watch('/events', waits);
  await sleep(2500);
  check('old history is ignored (nobody is "waiting" at start)', waits.length === 0, JSON.stringify(waits));
  fs.appendFileSync(file, line('enqueue', now()));
  await sleep(3000);
  check('a message queued while busy -> waiting 1', waits.join() === '1', JSON.stringify(waits));
  fs.appendFileSync(file, line('enqueue', now()));
  await sleep(3000);
  check('a second queued message -> waiting 2', waits.join() === '1,2', JSON.stringify(waits));
  fs.appendFileSync(file, line('remove', now()));
  await sleep(3000);
  check('Claude picks one up ("remove") -> waiting 1', waits.join() === '1,2,1', JSON.stringify(waits));
  fs.appendFileSync(file, line('dequeue', now()));
  await sleep(3000);
  check('the last one is taken ("dequeue") -> waiting 0', waits.join() === '1,2,1,0', JSON.stringify(waits));
  check('the text of the queued message appears NOWHERE in what the server sends', !rawStream.includes('SECRET-QUEUED') && !rawStream.includes('production database'));
  // a page opened while someone is waiting must be told immediately
  fs.appendFileSync(file, line('enqueue', now()));
  await sleep(3000);
  const late = [];
  const req2 = watch('/events', late);
  await sleep(1200);
  check('a page opened later is told that someone is already waiting', late.join() === '1', JSON.stringify(late));
  req.destroy(); req2.destroy(); srv.kill();
  console.log(results.join('\n'));
  console.log(results.some((r) => r.startsWith('FAIL')) ? '\nSOME FAILED' : '\nALL PASSED');
  await sleep(300);
  fs.rmSync(fakeHome, { recursive: true, force: true });
})();
