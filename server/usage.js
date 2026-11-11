// Aggregates Claude Code token usage from local transcripts (~/.claude/projects/**/*.jsonl).
// Read-only. Only aggregate numbers leave this module; no prompt/response text is kept.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const WINDOW_MS = 8 * 24 * 3600 * 1000;
const files = new Map();   // file -> {offset}
const entries = new Map(); // message id -> {ts, model, in, out, cw, cr}
let lastScan = 0;
const startedAt = Date.now();
const queueEvents = [];   // {op, sid, ts}: a message you sent while Claude was busy was queued / picked up

function walk(dir, out) {
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
}

function readNew(file, st, size) {
  const fd = fs.openSync(file, 'r');
  try {
    const len = size - st.offset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.offset);
    const lastNl = buf.lastIndexOf(10);
    if (lastNl < 0) return;                 // no complete line yet
    st.offset += lastNl + 1;
    for (const line of buf.slice(0, lastNl).toString('utf8').split('\n')) {
      if (line.includes('"type":"queue-operation"')) {
        // Only the operation word, session id and time are matched with patterns. The "content" (your message) is never parsed or kept.
        const op = /"operation":"(enqueue|dequeue|remove)"/.exec(line), sid = /"sessionId":"([0-9a-f-]{36})"/.exec(line), ts = /"timestamp":"([^"]+)"/.exec(line);
        if (op && sid && ts && Date.parse(ts[1]) >= startedAt - 2000) queueEvents.push({ op: op[1], sid: sid[1], ts: Date.parse(ts[1]) });   // older lines = history, ignored
        continue;
      }
      if (!line.includes('"usage"')) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      const m = j.message, u = m && m.usage;
      if (!u || !m.id || !j.timestamp || !m.model || m.model === '<synthetic>') continue;
      entries.set(m.id, { // streaming repeats share an id: last write wins
        ts: Date.parse(j.timestamp), model: m.model, sid: j.sessionId || j.session_id || '', side: !!j.isSidechain,
        in: u.input_tokens || 0, out: u.output_tokens || 0,
        cw: u.cache_creation_input_tokens || 0, cr: u.cache_read_input_tokens || 0,
      });
    }
  } finally { fs.closeSync(fd); }
}

function scan() {
  const now = Date.now();
  if (now - lastScan < 1000) return;
  lastScan = now;
  const list = []; walk(ROOT, list);
  for (const f of list) {
    let s; try { s = fs.statSync(f); } catch { continue; }
    if (now - s.mtimeMs > WINDOW_MS) continue;
    let st = files.get(f);
    if (!st || s.size < st.offset) { st = { offset: 0 }; files.set(f, st); }
    if (s.size > st.offset) { try { readNew(f, st, s.size); } catch {} }
  }
  for (const [id, e] of entries) if (now - e.ts > WINDOW_MS) entries.delete(id);
}

const empty = () => ({ in: 0, out: 0, cw: 0, cr: 0, used: 0 });
function add(t, e) { t.in += e.in; t.out += e.out; t.cw += e.cw; t.cr += e.cr; t.used += e.in + e.out + e.cw; } // cache reads not counted

function summary() {
  scan();
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = now.getTime() - 7 * 24 * 3600 * 1000;
  const today = empty(), week = empty(), byModel = {};
  let latest = null;
  const sess = {}; // sessionId -> {model, ts}  (sub-agent messages are ignored so they can't mislabel the session)
  for (const e of entries.values()) {
    if (e.ts >= weekStart) { add(week, e); (byModel[e.model] ||= empty()); add(byModel[e.model], e); }
    if (e.ts >= dayStart) add(today, e);
    if (!latest || e.ts > latest.ts) latest = e;
    if (e.sid && !e.side && (!sess[e.sid] || e.ts > sess[e.sid].ts)) sess[e.sid] = { model: e.model, ts: e.ts };
  }
  return { model: latest ? latest.model : null, lastActivity: latest ? latest.ts : null, sessions: Object.fromEntries(Object.entries(sess).map(([k, v]) => [k, v.model])), today, week, byModel, generatedAt: Date.now() };
}

// Running token total per session (input + output + cache writes; cache reads are not counted).
// Includes sub-agent messages: they carry the parent's session id.
function sessionTotals() {
  scan();
  const out = {};
  for (const e of entries.values()) if (e.sid) out[e.sid] = (out[e.sid] || 0) + e.in + e.out + e.cw;
  return out;
}

function takeQueueEvents() { scan(); return queueEvents.splice(0); }

module.exports = { summary, sessionTotals, takeQueueEvents };
if (require.main === module) console.log(JSON.stringify(summary(), null, 1));
