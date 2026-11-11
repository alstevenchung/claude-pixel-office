// Claude Code hook -> pixel office. Reads hook JSON from stdin and sends ONLY
// {id, name, state, action(short description), activity category, host name, model} to the LOCAL office server
// (127.0.0.1 only). Never sends prompts, commands, tool outputs, or file contents.
// Fails silently so it never blocks Claude.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PIXEL_OFFICE_PORT) || 8787;

// Short human description of a tool call. Sends at most a file's base name or Claude's own
// one-line description of a command - never the command itself, search queries, or contents.
function describe(tool, input) {
  input = input || {};
  const base = (p) => (p ? path.basename(String(p)) : '');
  switch (tool) {
    case 'Edit': case 'MultiEdit': return ('編輯 ' + base(input.file_path)).trim();
    case 'Write': return ('寫入 ' + base(input.file_path)).trim();
    case 'Read': return ('讀取 ' + base(input.file_path)).trim();
    case 'NotebookEdit': return ('編輯筆記本 ' + base(input.notebook_path)).trim();
    case 'Bash': case 'PowerShell': return input.description ? '執行：' + String(input.description) : '執行指令';
    case 'Grep': case 'Glob': return '搜尋程式碼';
    case 'WebSearch': return '上網搜尋';
    case 'WebFetch': return '讀取網頁';
    case 'Task': case 'Agent': return '派出助手';
    case 'TodoWrite': return '整理待辦事項';
    default: return String(tool || '').startsWith('mcp__') ? '使用外部工具' : String(tool || '工作中');
  }
}

// Model of this session = model name on the newest main-conversation message in the transcript tail.
// Only the model id string is taken from the transcript.
function modelFromTranscript(p) {
  try {
    const size = fs.statSync(p).size, len = Math.min(size, 256 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(len);
    try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"model"')) continue;
      let j; try { j = JSON.parse(lines[i]); } catch { continue; }
      const m = j.message && j.message.model;
      if (m && m !== '<synthetic>' && !j.isSidechain) return String(m);
    }
  } catch {}
  return undefined;
}

// What is this shell command doing? Only a CATEGORY (git push, ssh, database, ...) and, for ssh / database /
// kubectl, the bare HOST NAME leave this function. Never the command, user names, passwords, connection strings,
// SQL, ports, paths or arguments.
const ACTIVITY_ORDER = ['pr', 'merge', 'push', 'commit', 'pull', 'ssh', 'db', 'container', 'gh', 'git'];
const ACTIVITY_LABEL = {
  pr: '提交 PR', merge: '合併分支', push: '推送程式碼', commit: '提交變更', pull: '拉取更新',
  ssh: '連線伺服器', db: '操作資料庫', container: '操作容器', gh: '雲端操作', git: 'Git 操作',
};

// Split a command line into segments of tokens, honouring quotes (quoted text stays inside one token).
function tokenize(cmd) {
  const segs = []; let toks = [], cur = '', has = false, q = '';
  const endTok = () => { if (has) toks.push(cur); cur = ''; has = false; };
  const endSeg = () => { endTok(); if (toks.length) segs.push(toks); toks = []; };
  const s = String(cmd);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = ''; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (c === '\n' || c === ';' || c === '|' || c === '&') { endSeg(); continue; }
    if (/\s/.test(c)) { endTok(); continue; }
    cur += c; has = true;
  }
  endSeg();
  return segs;
}

// host part only: strips scheme, user:password@, port, path
function hostOnly(x) {
  x = String(x || '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^.*@/, '').replace(/^\[|\]$/g, '');
  const m = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}/.exec(x);
  return m ? m[0].slice(0, 28) : '';
}
// value of an option given as "-h X", "-hX", "--host X" or "--host=X"
function optVal(args, names) {
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    for (const n of names) {
      if (t === n) return args[i + 1] || '';
      if (n.startsWith('--')) { if (t.startsWith(n + '=')) return t.slice(n.length + 1); }
      else if (t.length > n.length && t.startsWith(n) && !t.startsWith('--')) return t.slice(n.length);
    }
  }
  return '';
}

const DB_PROGS = /^(mysql|mariadb|mysqldump|mysqladmin|psql|pg_dump|pg_restore|pg_dumpall|sqlcmd|bcp|mongosh|mongo|mongodump|mongorestore|redis-cli|sqlite3|sqlplus|clickhouse-client|cqlsh)$/;
const DB_URI = /(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|sqlserver|mssql):\/\/(?:[^@\/\s"']*@)?([A-Za-z0-9._-]+)/i;

function classify(cmd) {
  if (!cmd) return { activity: '', target: '' };
  const found = new Map();                                    // activity -> target
  const add = (act, t) => { if (!found.has(act) || (!found.get(act) && t)) found.set(act, t || ''); };
  const uri = DB_URI.exec(String(cmd));
  const uriHost = uri ? uri[1] : '';
  for (const seg of tokenize(cmd)) {
    let i = 0;
    while (i < seg.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(seg[i]) || /^(sudo|env|time|nohup|command|exec)$/.test(seg[i]))) i++;
    const prog = String(seg[i] || '').split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
    const args = seg.slice(i + 1);
    if (prog === 'gh') {
      if (args[0] === 'pr' && /^(create|new)$/.test(args[1] || '')) add('pr');
      else if (args[0] === 'pr' && args[1] === 'merge') add('merge');
      else add('gh');
    } else if (prog === 'git') {
      let j = 0;
      while (j < args.length && args[j].startsWith('-')) j += /^(-C|-c|--git-dir|--work-tree|--namespace)$/.test(args[j]) ? 2 : 1;
      const sub = args[j] || '';
      if (sub === 'commit') add('commit');
      else if (sub === 'push') add('push');
      else if (/^(pull|fetch|clone)$/.test(sub)) add('pull');
      else if (/^(merge|rebase|cherry-pick)$/.test(sub)) add('merge');
      else add('git');
    } else if (/^(ssh|sftp|mosh)$/.test(prog)) {
      let j = 0, host = '';
      while (j < args.length) {
        if (args[j].startsWith('-')) j += /^-[pilFJbcEeLRDmOQSWwBo]$/.test(args[j]) ? 2 : 1;
        else { host = args[j]; break; }
      }
      add('ssh', hostOnly(host));
    } else if (/^(scp|rsync)$/.test(prog)) {
      let host = '';
      for (const x of args) {
        if (x.startsWith('-')) continue;
        const m = /^(?:[^@\s:]+@)?([A-Za-z0-9][A-Za-z0-9._-]+):(?![\\/]{2})/.exec(x);   // [user@]host:path, not "C:\..." or "http://"
        if (m) { host = m[1]; break; }
      }
      if (host) add('ssh', hostOnly(host));   // a purely local copy has no remote host: not a server operation
    } else if (DB_PROGS.test(prog)) {
      let t = '';
      if (/^(mysql|mariadb|mysqldump|mysqladmin)$/.test(prog)) t = hostOnly(optVal(args, ['-h', '--host']));
      else if (/^(psql|pg_dump|pg_restore|pg_dumpall)$/.test(prog)) t = hostOnly(optVal(args, ['-h', '--host'])) || hostOnly(uriHost);
      else if (/^(sqlcmd|bcp)$/.test(prog)) t = hostOnly(String(optVal(args, ['-S']) || '').replace(/^tcp:/i, '').split(/[,\\]/)[0]);
      else if (/^(mongosh|mongo|mongodump|mongorestore)$/.test(prog)) t = hostOnly(uriHost) || hostOnly(optVal(args, ['--host']));
      else if (prog === 'redis-cli') t = hostOnly(optVal(args, ['-h'])) || hostOnly(uriHost);
      else if (prog === 'sqlite3') { const f = args.find((x) => !x.startsWith('-')); t = f ? hostOnly(String(f).split(/[\\/]/).pop()) : ''; add('db', t || 'SQLite'); continue; }
      else t = hostOnly(uriHost);
      add('db', t || '本機');                                  // no host given = local
    } else if (/^(docker|docker-compose|podman|kubectl|helm|k9s|minikube)$/.test(prog)) {
      add('container', prog === 'kubectl' ? hostOnly(optVal(args, ['--context'])) : hostOnly(optVal(args, ['-H', '--host'])));
    }
  }
  const best = ACTIVITY_ORDER.find((k) => found.has(k)) || '';
  return { activity: best, target: best ? found.get(best) : '' };
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let h = {};
  try { h = JSON.parse(raw); } catch { process.exit(0); }
  const ev = h.hook_event_name;
  let state, action = '', activity = '', opHost = '';
  switch (ev) {
    case 'SessionStart': state = 'idle'; break;
    case 'UserPromptSubmit': state = 'thinking'; break;
    case 'PreToolUse':
      state = 'coding'; action = describe(h.tool_name, h.tool_input);
      if ((h.tool_name === 'Bash' || h.tool_name === 'PowerShell') && !h.agent_id) {
        const c = classify(h.tool_input && h.tool_input.command);
        activity = c.activity; opHost = c.target;
        if (activity) action = ACTIVITY_LABEL[activity];
      }
      break;
    case 'PostToolUse': state = 'thinking'; break;
    case 'Notification':
      state = h.notification_type === 'idle_prompt' ? 'idle' : 'waiting_approval'; break;
    case 'PermissionRequest': state = 'waiting_approval'; action = describe(h.tool_name, h.tool_input); break;
    case 'Stop': state = 'idle'; break;
    case 'SessionEnd': state = 'gone'; break;
    case 'SubagentStart': state = 'coding'; break;   // a helper appears
    case 'SubagentStop': state = 'gone'; break;      // ...and leaves
    default: process.exit(0);
  }
  // Subagents ("helpers"): their start/stop and their own tool calls are reported as a helper that
  // belongs to the parent session. They never create a separate person, and never change the parent's state.
  const sid = String(h.session_id || 'unknown');
  const aid = h.agent_id ? String(h.agent_id) : '';
  const isHelper = (ev === 'SubagentStart' || ev === 'SubagentStop' || ((ev === 'PreToolUse' || ev === 'PostToolUse') && aid));
  if (isHelper && !aid) process.exit(0);
  const body = JSON.stringify(isHelper ? {
    id: sid + '#' + aid, parent: sid,
    name: h.agent_type ? String(h.agent_type) : '助手',
    state, action: state === 'coding' && ev !== 'SubagentStart' ? action : '',
  } : {
    id: sid,
    name: path.basename(process.env.CLAUDE_PROJECT_DIR || h.cwd || ''),
    state, action, activity: activity || undefined, target: opHost || undefined,
    prompt: ev === 'UserPromptSubmit' ? true : undefined,   // just a flag: the text of the prompt is never sent
    model: h.model ? String(h.model) : (state === 'gone' ? undefined : modelFromTranscript(h.transcript_path)),
  });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  const req = http.request(
    { host: '127.0.0.1', port: PORT, path: '/event', method: 'POST', timeout: 1500, headers },
    (res) => { res.resume(); res.on('end', () => process.exit(0)); }
  );
  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.end(body);
});
