// Zero-dependency LOCAL server: serves web/ and relays hook events to the page via SSE.
// Listens on 127.0.0.1 only. There is no remote / network mode.
const http = require('http');
const fs = require('fs');
const path = require('path');

const usage = require('./usage');
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const PORT = Number(process.env.PORT) || 8787;
const HOST = '127.0.0.1';
const STATES = new Set(['coding', 'thinking', 'idle', 'waiting_approval', 'background', 'gone']);
const ACTIVITIES = new Set(['pr', 'merge', 'push', 'commit', 'pull', 'gh', 'git', 'ssh', 'db', 'container']);
const STALE_MS = 30 * 60 * 1000;
const MAX_CLIENTS = 50;

const bgPending = new Set(); // session ids that started a background job this turn
const agents = new Map(); // id -> {id,name,state,action,model,activity,target,kind,parent,ts}
const clients = new Set();

// Remember who is in the office across server restarts. Local file only; entries older than STALE_MS are dropped on load.
const STATE_FILE = process.env.PIXEL_OFFICE_STATE || path.join(ROOT, 'office-state.json');   // env override is for tests
try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  for (const a of saved.agents || []) if (a && a.id && Date.now() - a.ts < STALE_MS) agents.set(a.id, a);
} catch {}
let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(STATE_FILE, JSON.stringify({ agents: [...agents.values()] })); } catch {}
  }, 1000);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const clean = (s, n) => String(s ?? '').replace(/[\r\n\t]/g, ' ').slice(0, n);

function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const c of clients) c.write(data);
}

// DNS-rebinding guard: only answer requests addressed to localhost
const hostOk = (req) => /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(req.headers.host || ''));

const server = http.createServer((req, res) => {
  if (!hostOk(req)) { res.writeHead(403).end(); return; }
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400).end(); return; }

  if (req.method === 'POST' && url.pathname === '/event') {
    // A browser page can't send this without a CORS preflight; require JSON and no Origin header.
    if (!String(req.headers['content-type'] || '').startsWith('application/json') || req.headers.origin) {
      res.writeHead(415).end(); return;
    }
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let e;
      try { e = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
      const id = clean(e.id, 64);
      if (!id || !STATES.has(e.state)) { res.writeHead(400).end(); return; }
      if (e.state === 'gone') {
        agents.delete(id);
        broadcast({ type: 'remove', id });
        for (const [hid, h] of agents) if (h.parent === id) { agents.delete(hid); broadcast({ type: 'remove', id: hid }); } // its helpers leave too
        saveSoon();
      } else {
        const prev = agents.get(id);
        // Background jobs: when a turn ends (Stop) after one was started, the person is "waiting on the background" instead of idle.
        if (e.bg === true) bgPending.add(id);
        if (e.prompt === true) bgPending.delete(id);
        if (e.state === 'idle') {
          if (e.stop === true && bgPending.has(id)) { e.state = 'background'; e.action = ''; bgPending.delete(id); }
          else if (e.stop !== true && prev && prev.state === 'background') e.state = 'background';   // a later idle_prompt must not end the wait
        }
        const a = { id, name: clean(e.name, 24) || id.slice(0, 8), state: e.state, action: clean(e.action, 60), ts: Date.now() };
        a.model = clean(e.model, 64) || (prev && prev.model) || '';
        a.activity = a.state === 'coding' && ACTIVITIES.has(String(e.activity)) ? String(e.activity) : ''; // git / PR / server / DB animation
        a.target = ['ssh', 'db', 'container'].includes(a.activity) ? String(e.target || '').replace(/[^A-Za-z0-9._\-一-龥]/g, '').slice(0, 28) : ''; // host name only
        const parent = clean(e.parent, 64);
        if (parent && parent !== id) { a.kind = 'helper'; a.parent = parent; }   // a subagent spawned by session `parent`
        if (!a.action && a.state === 'waiting_approval' && prev) a.action = prev.action; // keep what it was about to do
        agents.set(id, a);
        broadcast({ type: 'update', agent: a });
        if (e.prompt === true) broadcast({ type: 'prompt', id });   // drives the "got it!" hop and the boss (cosmetic)
        saveSoon();
      }
      res.writeHead(204).end();
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/usage') {
    let u = {};
    try { u = JSON.parse(fs.readFileSync(path.join(ROOT, 'usage-config.json'), 'utf8')); } catch {}
    const body = JSON.stringify({ ...usage.summary(), dailyBudget: Number(u.dailyBudget) || 3000000, weeklyBudget: Number(u.weeklyBudget) || 15000000 });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(body);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    if (clients.size >= MAX_CLIENTS) { res.writeHead(503).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'snapshot', agents: [...agents.values()] })}\n\n`);
    for (const [sid, n] of waiting) res.write('data: ' + JSON.stringify({ type: 'waiting', id: sid, n }) + '\n\n');   // someone is already waiting when the page opens
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'GET') {
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(WEB, rel);
    if (!file.startsWith(WEB + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(buf);
    });
    return;
  }
  res.writeHead(405).end();
});

setInterval(() => {
  const now = Date.now();
  for (const [id, a] of agents) if (now - a.ts > STALE_MS) { agents.delete(id); broadcast({ type: 'remove', id }); saveSoon(); }
  for (const c of clients) c.write(': ping\n\n');
}, 15000);

// "Damage numbers": every few seconds compare each session's token total with the last one we saw and
// tell the page how many tokens were just spent. The first poll only sets the baseline (no history dump).
const lastTotals = new Map();
let baselineDone = false;
const SPEND_MIN = 100;                       // smaller changes accumulate until they reach this
setInterval(() => {
  let totals;
  try { totals = usage.sessionTotals(); } catch { return; }
  for (const [sid, total] of Object.entries(totals)) {
    const prev = lastTotals.has(sid) ? lastTotals.get(sid) : (baselineDone ? 0 : total);
    const delta = total - prev;
    if (delta >= SPEND_MIN) { lastTotals.set(sid, total); broadcast({ type: 'spend', id: sid, tokens: delta }); }
    else if (!lastTotals.has(sid) || delta < 0) lastTotals.set(sid, total);   // baseline, or total shrank (old messages aged out)
  }
  baselineDone = true;
}, 2500);

// A message you send while Claude is busy waits in its queue; the transcript logs enqueue / remove / dequeue.
// Only that one word (and the session id) is read, never your text. It tells the page who is still waiting.
const waiting = new Map();
setInterval(() => {
  let evs; try { evs = usage.takeQueueEvents(); } catch { return; }
  for (const ev of evs) {
    const n0 = waiting.get(ev.sid) || 0;
    const n = ev.op === 'enqueue' ? n0 + 1 : Math.max(0, n0 - 1);
    if (n === n0) continue;
    if (n === 0) waiting.delete(ev.sid); else waiting.set(ev.sid, n);
    broadcast({ type: 'waiting', id: ev.sid, n });
  }
}, 1000);

server.listen(PORT, HOST, () => console.log(`Pixel office (local only): http://${HOST}:${PORT}`));
