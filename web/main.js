const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const statusEl = document.getElementById('status');
const W = 320, H = 180, S = 4;
cv.width = W * S; cv.height = H * S;
const BUBBLE = "bold 7px 'Microsoft JhengHei','PingFang TC',sans-serif";
const SMALL = "bold 6.5px 'Microsoft JhengHei','PingFang TC',sans-serif";
const FONT = "bold 9px 'Microsoft JhengHei','PingFang TC',sans-serif";
function label(txt, x, y, fg, align) {
  ctx.textAlign = align || 'center'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#14141f'; ctx.strokeText(txt, x, y); ctx.fillStyle = fg || '#fff'; ctx.fillText(txt, x, y);
}

// Desks (top-left of desk), water cooler, lounge spot
const DESKS = [
  { x: 46, y: 62 }, { x: 126, y: 62 }, { x: 206, y: 62 }, { x: 46, y: 122 }, { x: 126, y: 122 }, { x: 206, y: 122 },
];
const COOLER = { x: 292, y: 128 };
const COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#8ecae6', '#c77dff', '#90be6d'];

window.sessionModels = {};
const agents = new Map(); // id -> {…server fields, x,y,tx,ty,desk,color,t}
const helpers = new Map(); // subagent id -> {…server fields, born}

// ---- BOSS, "got it!" hop and whip: all purely cosmetic (nothing here is sent anywhere or changes any state) ----
const BOSS_CHANCE = 0.5;           // chance the boss shows up when you submit a prompt
const BOSS_COOLDOWN_MS = 45000;    // ...but at most once per this long
const BOSS_SPEND_MIN = 50000;      // a single response costing this many tokens ALWAYS brings the boss
const BOSS_DOOR = { x: 326, y: 170 };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// Canned lines only. They are NOT derived from what you typed (the prompt text is never read or sent).
const BOSS_LINES = ['這個要快一點喔！', '我昨天不是說過了嗎？', '客戶在等欸！', '怎麼還沒好？', '你確定這樣可以嗎？', '不要又出 bug 啊！', '今天下班前要看到成果！', '這個很簡單吧？', '再檢查一遍！', '不要又燒一堆 token！', '進度呢？進度！'];
const BOSS_SPEND_LINES = [(n) => fmtTok(n) + ' token？！錢不是大風吹的！', () => '預算！預算啊！！', () => '又燒這麼多？！'];
// A message you sent while Claude was still busy sits in its queue. The boss stands next to that person nagging until Claude
// picks it up (cosmetic only: Claude is not affected). The lines rotate every few seconds.
const BOSS_HURRY_LINES = ['快一點啦！', '怎麼這麼慢？！', '我在等欸！', '還沒好嗎？！', '動作快！動作快！', '客戶一直催我啊！', '你是在睡覺嗎？', '再慢我要扣薪水了！'];
const HIT_LINES = ['哎呀！', '是！老闆！', '我會努力！', '饒命啊～', '別打了…', '痛痛痛！'];
const boss = { state: 'away', x: 0, y: 0, face: false, id: null, line: '', until: 0, queue: [], lastPrompt: -1e9, hurry: false, hold: false, lineAt: 0, hitAt: 0 };
const whips = [];

function deskFor(id) {
  const used = new Set([...agents.values()].map(a => a.desk));
  for (let i = 0; i < DESKS.length; i++) if (!used.has(i)) return i;
  return agents.size % DESKS.length;
}
function upsert(a) {
  if (a.kind === 'helper') {
    let h = helpers.get(a.id);
    if (!h) { h = { born: performance.now() }; helpers.set(a.id, h); }
    Object.assign(h, a);
    return;
  }
  let o = agents.get(a.id);
  if (!o) {
    const desk = deskFor(a.id);
    o = { desk, color: COLORS[desk % COLORS.length], x: COOLER.x, y: COOLER.y, wander: 0, t: 0 };
    agents.set(a.id, o);
  }
  Object.assign(o, a);
}

// SSE
function connect() {
  const es = new EventSource('/events');
  es.onopen = () => (statusEl.textContent = '已連線');
  es.onerror = () => (statusEl.textContent = '連線中斷，重試中…');
  es.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === 'snapshot') { agents.clear(); helpers.clear(); msg.agents.forEach(upsert); }
    else if (msg.type === 'update') upsert(msg.agent);
    else if (msg.type === 'spend') addSpend(msg.id, msg.tokens);
    else if (msg.type === 'prompt') onPrompt(msg.id);
    else if (msg.type === 'waiting') onWaiting(msg.id, msg.n);
    else if (msg.type === 'remove') { agents.delete(msg.id); helpers.delete(msg.id); }
    statusEl.textContent = `已連線 · ${agents.size} 位員工` + (helpers.size ? ` · ${helpers.size} 位小助手` : '');
  };
}
connect();

function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); }

function plant(x, y) {
  rect(x - 5, y - 6, 10, 8, '#b5651d'); rect(x - 6, y - 8, 12, 3, '#d98a3d');       // pot
  rect(x - 1, y - 18, 2, 10, '#2d6a4f');                                              // stem
  rect(x - 7, y - 22, 6, 7, '#40916c'); rect(x + 1, y - 24, 7, 8, '#52b788'); rect(x - 3, y - 28, 6, 7, '#74c69d');
}
function drawRoom(t) {
  // wall
  rect(0, 0, W, 38, '#f1e4cf'); rect(0, 24, W, 14, '#8fb8b0'); rect(0, 24, W, 1, '#6f9a92'); rect(0, 38, W, 3, '#5d4a3a');
  // floor planks
  rect(0, 41, W, H - 41, '#c79c6d');
  for (let y = 41; y < H; y += 10) { rect(0, y, W, 1, '#b58a5c'); for (let x = ((y / 10) % 2) * 30 + 8; x < W; x += 60) rect(x, y, 1, 10, '#b58a5c'); }
  // rug
  rect(78, 96, 170, 80, '#7b6fb0'); rect(81, 99, 164, 74, '#9a8fd0'); rect(84, 102, 158, 68, '#7b6fb0');
  // windows with sky
  for (const wx of [24, 104, 184]) {
    rect(wx - 2, 3, 40, 22, '#e0d2b8'); rect(wx, 5, 36, 18, '#8ecae6'); rect(wx, 5, 36, 6, '#a9dcf0');
    rect(wx + 5, 13, 10, 3, '#fff'); rect(wx + 8, 11, 8, 3, '#fff'); rect(wx + 22, 15, 9, 3, '#fff');
    rect(wx + 17, 5, 2, 18, '#e0d2b8'); rect(wx, 13, 36, 2, '#e0d2b8');
  }
  // clock
  rect(258, 6, 16, 16, '#5d4a3a'); rect(260, 8, 12, 12, '#fffaf0'); rect(265, 10, 2, 5, '#22223b'); rect(265, 14, 5, 2, '#22223b'); rect(265, 14, 2, 2, '#d62828');
  // whiteboard
  rect(282, 4, 34, 22, '#9aa0b5'); rect(284, 6, 30, 18, '#ffffff');
  rect(287, 10, 14, 1, '#e63946'); rect(287, 14, 22, 1, '#1d3557'); rect(287, 18, 10, 1, '#2a9d8f');
  // bookshelf (left wall)
  rect(2, 12, 14, 30, '#7d5236'); rect(4, 14, 10, 12, '#5d3d28'); rect(4, 28, 10, 12, '#5d3d28');
  [['#e63946',4],['#f4a261',6],['#2a9d8f',8],['#457b9d',10],['#e9c46a',12]].forEach(([c, x]) => { rect(x, 16, 2, 10, c); rect(x, 30, 2, 10, c); });
  plant(14, 168); plant(306, 60);
  // "Git cloud" on the wall and the PR mailbox
  const busy = [...agents.values()].some(o => o.state === 'coding' && (o.activity === 'push' || o.activity === 'pull'));
  const cc = busy && ((t / 200) | 0) % 2 ? '#ffffff' : '#e6efff';
  rect(230, 12, 26, 8, cc); rect(234, 8, 10, 6, cc); rect(243, 6, 10, 8, cc); rect(230, 19, 26, 1, '#b9c9e8');
  rect(239, 11, 1, 6, '#f05033'); rect(239, 11, 5, 1, '#f05033'); rect(243, 11, 1, 3, '#f05033'); // tiny branch mark
  ctx.font = SMALL; label('Git 雲端', 243, 33, '#ffffff');
  const mailFlag = [...agents.values()].some(o => o.state === 'coding' && o.activity === 'pr');
  rect(302, 84, 2, 14, '#6b513a'); rect(296, 74, 14, 11, '#d62828'); rect(297, 72, 12, 2, '#d62828'); rect(296, 74, 14, 1, '#f26b6b');
  rect(298, 77, 10, 2, '#5a1010'); rect(311, mailFlag ? 71 : 77, 2, 6, '#ffd166'); rect(311, mailFlag ? 71 : 77, 4, 2, '#ffd166');
  ctx.font = SMALL; label('PR 信箱', 303, 68, '#ffffff');
  // server rack + database: lit up when someone is operating them, with the host name shown underneath
  const opSsh = [...agents.values()].find(o => o.state === 'coding' && o.activity === 'ssh');
  const opDb = [...agents.values()].find(o => o.state === 'coding' && o.activity === 'db');
  // wall-mounted server cabinet between the windows (nothing else sits there, so bubbles never cover it)
  rect(150, 5, 18, 19, '#2f3447'); rect(150, 5, 18, 2, '#4a526e');
  for (let k = 0; k < 3; k++) {
    rect(152, 8 + k * 5, 14, 4, '#3c4460'); rect(153, 9 + k * 5, 8, 1, '#232838');
    const on = opSsh ? ((t / (120 + k * 50)) | 0) % 2 : k === 0;
    rect(163, 9 + k * 5, 2, 2, on ? '#5dff9b' : '#2a7a4d');
  }
  ctx.font = SMALL; label(opSsh && opSsh.target ? opSsh.target : '伺服器', 159, 33, opSsh ? '#ffd166' : '#ffffff');
  const dbc = opDb ? (((t / 250) | 0) % 2 ? '#ffd166' : '#e9b949') : '#7fa6d6';
  rect(301, 148, 14, 2, '#a9c8f0'); rect(300, 150, 16, 16, '#5b7fae'); rect(300, 156, 16, 1, '#3f5f8a'); rect(300, 161, 16, 1, '#3f5f8a');
  rect(301, 166, 14, 2, '#4a6a96'); rect(313, 152, 2, 2, dbc);
  ctx.font = SMALL; label(opDb && opDb.target ? opDb.target : '資料庫', 319, 176, opDb ? '#ffd166' : '#ffffff', 'right');
  // cooler + coffee table
  rect(COOLER.x - 6, COOLER.y - 26, 12, 9, '#9bd1f0'); rect(COOLER.x - 6, COOLER.y - 26, 12, 2, '#c9e8f7');
  rect(COOLER.x - 7, COOLER.y - 17, 14, 24, '#eceff4'); rect(COOLER.x - 7, COOLER.y + 5, 14, 2, '#c4c9d6');
  rect(COOLER.x - 3, COOLER.y - 9, 3, 3, '#e63946'); rect(COOLER.x + 1, COOLER.y - 9, 3, 3, '#3a86ff');
  // desks
  DESKS.forEach((d, i) => {
    const a = [...agents.values()].find(o => o.desk === i);
    rect(d.x + 1, d.y + 21, 44, 3, 'rgba(0,0,0,.18)');                                  // shadow
    rect(d.x, d.y, 46, 4, '#c48b62'); rect(d.x, d.y + 4, 46, 14, '#a9744f');           // top
    rect(d.x, d.y + 18, 46, 3, '#7d5236');
    rect(d.x + 3, d.y + 6, 12, 10, '#8f5f3e'); rect(d.x + 9, d.y + 10, 3, 2, '#e9c46a'); // drawer
    // monitor
    rect(d.x + 14, d.y - 15, 18, 13, '#1f2233');
    rect(d.x + 21, d.y - 2, 4, 2, '#3a3d52'); rect(d.x + 18, d.y - 1, 10, 2, '#3a3d52');
    const lit = a && (a.state === 'coding' || a.state === 'thinking');
    rect(d.x + 15, d.y - 14, 16, 10, lit ? (a.state === 'coding' ? '#0b3d3a' : '#12304f') : '#2b3044');
    if (lit) for (let k = 0; k < 4; k++) rect(d.x + 17, d.y - 12 + k * 2, 3 + ((t / 180 + k * 5) % 9 | 0), 1, a.state === 'coding' ? '#7ee0c8' : '#8ecae6');
    // keyboard + mug
    rect(d.x + 16, d.y + 7, 14, 4, '#d9dbe6'); rect(d.x + 17, d.y + 8, 12, 1, '#b8bccc');
    rect(d.x + 36, d.y + 3, 5, 5, '#fff'); rect(d.x + 37, d.y + 4, 3, 1, '#6f4e37'); rect(d.x + 41, d.y + 4, 1, 3, '#fff');
  });
}

function drawAgent(a, t) {
  const d = DESKS[a.desk];
  const toMail = a.state === 'coding' && a.activity === 'pr';          // submitting a PR: walk to the mailbox
  const atDesk = a.state !== 'idle' && !toMail;
  if (atDesk) { a.tx = d.x + 22; a.ty = d.y + 30; }
  else if (toMail) {   // stand next to the mailbox; several people line up to its left
    const slot = [...agents.values()].filter(o => o.state === 'coding' && o.activity === 'pr' && o.desk < a.desk).length;
    a.tx = 288 - slot * 16; a.ty = 98;
  }
  else if (t > a.wander) { // idle: drift around the cooler area
    a.wander = t + 3000 + Math.random() * 4000;
    a.tx = 262 + Math.random() * 24; a.ty = COOLER.y + 14 + Math.random() * 28;
  }
  const dx = a.tx - a.x, dy = a.ty - a.y, dist = Math.hypot(dx, dy);
  const moving = dist > 1;
  if (moving) { a.x += (dx / dist) * Math.min(0.6, dist); a.y += (dy / dist) * Math.min(0.6, dist); a.face = dx < 0; }
  const look = a.desk;
  let img, ox, oy;
  if (moving) {
    img = getSprite('walk', ((t / 130) | 0) % 4, a.color, look, a.face); ox = a.x - 9; oy = a.y - 24;
  } else if (atDesk) {
    const pose = a.state === 'coding' ? 'type' : a.state === 'thinking' ? 'think' : a.state === 'waiting_approval' ? 'wave' : 'sit';
    const fr = pose === 'sit' ? ((t / 900) | 0) % 2 : pose === 'type' ? ((t / 120) | 0) % 4 : ((t / 450) | 0) % 2;
    img = getSprite(pose, fr, a.color, look, false); ox = a.x - 9; oy = d.y + 2;
    rect(a.x - 9, d.y + 8, 18, 14, '#3d405b'); rect(a.x - 9, d.y + 8, 18, 2, '#5c6088'); // chair
  } else {
    img = getSprite('stand', (t % 3400 < 160) ? 1 : 0, a.color, look, a.face); ox = a.x - 9; oy = a.y - 24;
  }
  const ackAge = performance.now() - (a.ackAt || -1e9), hitAge = performance.now() - (a.hitAt || -1e9);
  const hop = ackAge < 520 ? Math.round(Math.abs(Math.sin(ackAge / 85)) * 5 * (1 - ackAge / 520)) : 0;   // "got it!" hop
  ctx.drawImage(img, Math.round(ox + hitShake(a)), Math.round(oy - hop));
  const x = a.x, top = oy;
  if (hitAge >= 0 && hitAge < 1300) {                                        // whipped: orbiting stars + a shout
    if (hitAge < 700) for (let k = 0; k < 3; k++) { const ang = hitAge / 90 + k * 2.1; rect(x + Math.cos(ang) * 9, top - 2 + Math.sin(ang) * 4, 2, 2, '#ffd166'); }
    ctx.font = BUBBLE; label(a.hitLine || '哎呀！', Math.round(x), Math.round(top - 8 - hitAge / 160), '#ffffff');
  } else if (ackAge >= 0 && ackAge < 1300) {
    ctx.font = BUBBLE; label('收到！', Math.round(x), Math.round(top - 6 - hop - ackAge / 220), '#9dffb0');
  } else if (a.waiting > 0) {                                                // a message of yours is still queued
    ctx.font = BUBBLE; label('等待處理中…' + (a.waiting > 1 ? ' ×' + a.waiting : ''), Math.round(x), Math.round(top - (boss.id === a.id && boss.state !== 'away' ? 26 : 6)), ((t / 500) | 0) % 2 ? '#ffb347' : '#ffe0b0');
  }
  const seated = atDesk && !moving;
  const ny = Math.round(seated ? d.y + 33 : a.y + 9);
  ctx.font = FONT;
  label(a.name, Math.round(x), ny, '#fff');
  const mdl = window.sessionModels[a.id] || a.model;
  if (mdl) { ctx.font = SMALL; label(modelName(mdl), Math.round(x), ny + 8, '#bcd0ff'); }
  if (!moving) {
    // one white box, black text, wrapped to at most 3 short lines
    const wrap = (txt, maxW, maxLines) => {
      ctx.font = BUBBLE; const lines = []; let cur = '';
      for (const ch of (txt.match(/[A-Za-z0-9._-]+|[\s\S]/g) || [])) {
        if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ''; }
        cur += ch;
      }
      if (cur) lines.push(cur);
      if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…'; }
      return lines;
    };
    const bubble = (txt, badge) => {
      const lines = wrap(txt, 46, 3), lh = 8;
      const w = Math.ceil(Math.max(...lines.map(l => ctx.measureText(l).width))) + 8, bh = lines.length * lh + 5;
      let bx = Math.round(x + 10); const down = seated && d.y > 100; // second row: grow downward so it never covers row 1's labels
      const flip = bx + w > W - 2; if (flip) bx = Math.round(x - 10 - w);   // near the right edge: open to the left
      const by = down ? Math.round(top + 2) : Math.round(top + (seated ? 3 : -3)) - bh;
      rect(bx, by, w, bh, '#ffffff'); rect(bx + 1, by - 1, w - 2, 1, '#ffffff'); rect(bx + 1, by + bh, w - 2, 1, '#ffffff');
      const ty = down ? by + 3 : by + bh - 6;
      if (!flip) { rect(bx - 3, ty, 3, 4, '#ffffff'); rect(bx - 2, ty - 1, 2, 1, '#ffffff'); } // tail toward the head
      ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.font = BUBBLE;
      lines.forEach((l, i) => ctx.fillText(l, bx + 4, by + 3 + lh * (i + 1) - 2));
      if (badge) { rect(bx + w - 7, by - 6, 8, 9, '#d62828'); ctx.fillStyle = '#fff'; ctx.fillText('!', bx + w - 5, by + 1); } // attention badge
      ctx.textAlign = 'center';
    };
    if (a.state === 'waiting_approval') {
      bubble('需要你確認' + (a.action ? '：' + a.action : ''), ((t / 400) | 0) % 2);
    } else if (a.state === 'thinking') {
      bubble('思考中' + '.'.repeat((((t / 350) | 0) % 3) + 1));
    } else if (a.state === 'coding') {
      bubble((a.action || '工作中') + (a.target ? '：' + a.target : ''));
    }
  }
  drawActivity(a, t, x, top);
}

// Helpers stand to the LEFT of their parent's desk (the parent's speech bubble opens to the right).
const HELPER_NAMES = { Explore: '探索', Plan: '規劃', 'general-purpose': '通用' };
function drawHelpers(t) {
  const byParent = new Map();
  for (const h of helpers.values()) {
    if (!agents.has(h.parent)) continue;
    if (!byParent.has(h.parent)) byParent.set(h.parent, []);
    byParent.get(h.parent).push(h);
  }
  for (const [pid, list] of byParent) {
    const d = DESKS[agents.get(pid).desk];
    list.sort((p, q) => p.born - q.born).slice(0, 4).forEach((h, i) => {   // at most 4 shown, the rest as +N
      const x = d.x - 10 - (i % 2) * 14, y = d.y + 30 + Math.floor(i / 2) * 21;
      h._x = x; h._y = y;
      const age = t - h.born, hop = age < 450 ? Math.round(Math.abs(Math.sin(age / 70)) * 10 * (1 - age / 450)) : 0; // pop-in bounce
      const idle = Math.floor(t / 1000 + i) % 2 ? 0 : 1;
      ctx.drawImage(getSprite('bot', h.state === 'idle' ? 0 : ((t / 160) | 0) % 2, COLORS[agents.get(pid).desk % COLORS.length], 0, false), Math.round(x - 7 + hitShake(h)), Math.round(y - 17 - hop + (h.state === 'idle' ? idle : 0)));
      ctx.font = SMALL; label(HELPER_NAMES[h.name] || String(h.name || '助手').slice(0, 3), Math.round(x), Math.round(y + 8), '#d9ffe9');
      if (i === 3 && list.length > 4) label('+' + (list.length - 4), Math.round(x - 11), Math.round(y - 6), '#ffd166');
    });
  }
}

// Git / GitHub animations (activity comes from the hook; only a category, never the command).
function drawActivity(a, t, x, top) {
  const act = a.state === 'coding' ? a.activity : '';
  if (!act) return;
  const CLOUD = { x: 243, y: 14 }, MAIL = { x: 303, y: 78 };
  const lx = x - 27;                                                   // left of the head: the bubble opens to the right
  const fly = (from, to, kind) => {
    const p = (t % 1500) / 1500, fx = from.x + (to.x - from.x) * p, fy = from.y + (to.y - from.y) * p - Math.sin(Math.PI * p) * 16;
    if (kind === 'plane') { rect(fx, fy, 7, 2, '#ffffff'); rect(fx + 4, fy - 2, 2, 2, '#ffffff'); rect(fx - 2, fy + 1, 2, 1, '#bcd0ff'); rect(fx - 5, fy + 1, 2, 1, 'rgba(255,255,255,.55)'); }
    else if (kind === 'box') { rect(fx, fy, 7, 6, '#c8935a'); rect(fx + 3, fy, 1, 6, '#e9c46a'); rect(fx, fy + 2, 7, 1, '#a9733f'); }
    else { rect(fx, fy, 7, 5, '#ffffff'); rect(fx, fy, 7, 1, '#cfd8ee'); rect(fx + 1, fy + 1, 2, 1, '#cfd8ee'); rect(fx + 4, fy + 1, 2, 1, '#cfd8ee'); rect(fx + 3, fy + 2, 1, 1, '#d62828'); }
  };
  const glyph = (col, merge) => {                                      // git branch / merge icon
    const on = ((t / 400) | 0) % 2;
    rect(lx + 1, top - 12, 2, 8, col);
    rect(lx - 1, top - 14, 6, 3, col); rect(lx - 1, top - 5, 6, 3, col);
    if (merge) { rect(lx + 6, top - 14, 6, 3, on ? '#ffffff' : col); rect(lx + 3, top - 11, 5, 1, col); rect(lx + 5, top - 10, 1, 1, col); }
    else { rect(lx + 7, top - 11, 5, 3, on ? '#ffffff' : col); rect(lx + 3, top - 9, 5, 1, col); }
  };
  if (act === 'push') fly({ x, y: top - 4 }, CLOUD, 'plane');
  else if (act === 'pull') fly(CLOUD, { x, y: top - 4 }, 'box');
  else if (act === 'pr') fly({ x: x + 7, y: top + 8 }, MAIL, 'mail');
  else if (act === 'commit') {                                         // document gets stamped, then a check appears
    const k = ((t / 350) | 0) % 4, down = k >= 2;
    rect(lx, top - 14, 10, 12, '#ffffff'); rect(lx + 2, top - 12, 6, 1, '#aab4cf'); rect(lx + 2, top - 10, 6, 1, '#aab4cf'); rect(lx + 2, top - 8, 4, 1, '#aab4cf');
    rect(lx + 2, top - 25 + (down ? 12 : 0), 6, 3, '#7a1f1f'); rect(lx + 3, top - 22 + (down ? 12 : 0), 4, 3, '#b83232');
    if (down) { rect(lx + 2, top - 5, 2, 1, '#2fbf71'); rect(lx + 4, top - 4, 2, 1, '#2fbf71'); rect(lx + 6, top - 6, 2, 1, '#2fbf71'); rect(lx + 8, top - 8, 1, 2, '#2fbf71'); }
  }
  else if (act === 'ssh' || act === 'db') {                              // data packets stream to the rack / database
    const RACK = { x: 159, y: 18 }, DBP = { x: 308, y: 150 }, to = act === 'ssh' ? RACK : DBP;
    for (let k = 0; k < 3; k++) {
      const p = ((t + k * 500) % 1500) / 1500;
      rect(x + (to.x - x) * p, top - 6 + (to.y - top + 6) * p - Math.sin(Math.PI * p) * 10, 3, 3, act === 'ssh' ? '#6ff0ff' : '#ffd166');
    }
    const blink = ((t / 400) | 0) % 2;
    if (act === 'ssh') {                                                  // little terminal window
      rect(lx - 1, top - 15, 14, 11, '#5a6a8a'); rect(lx, top - 14, 12, 9, '#14181f');
      rect(lx + 2, top - 12, 3, 1, '#5dff9b'); rect(lx + 3, top - 11, 1, 1, '#5dff9b'); rect(lx + 2, top - 10, 3, 1, '#5dff9b');
      if (blink) rect(lx + 7, top - 9, 3, 1, '#5dff9b');
    } else {                                                              // little database cylinder
      rect(lx + 1, top - 15, 10, 2, '#a9c8f0'); rect(lx, top - 13, 12, 9, '#5b7fae'); rect(lx, top - 10, 12, 1, '#3f5f8a'); rect(lx, top - 7, 12, 1, '#3f5f8a');
      rect(lx + 1, top - 4, 10, 1, '#4a6a96'); rect(lx + 9, top - 12, 2, 2, blink ? '#ffd166' : '#e9b949');
    }
  }
  else if (act === 'container') {                                         // stacked containers bobbing
    const bob = ((t / 300) | 0) % 2;
    rect(lx, top - 5, 12, 2, '#2496ed');
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const cx = lx + c * 4, cy = top - 11 - r * 4 - (bob && c === 1 ? 1 : 0);
      rect(cx, cy, 3, 3, '#2496ed'); rect(cx + 1, cy + 1, 1, 1, '#d6ecff');
    }
  }
  else if (act === 'merge') glyph('#a371f7', true);
  else if (act === 'gh') glyph('#8ecae6', false);
  else glyph('#f05033', false);
}

// Damage-style numbers: tokens spent by a session float up above that person's head.
const floats = [];
const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));
function addSpend(id, tokens) {
  if (!agents.has(id)) return;
  const now = performance.now(), queued = floats.filter(x => x.id === id && now - x.born < 600).length;
  floats.push({ id, text: '-' + fmtTok(tokens), big: tokens >= 50000, born: now + queued * 260, dx: Math.round((Math.random() - 0.5) * 14) });
  if (floats.length > 40) floats.shift();
  if (window.pulseHp) window.pulseHp();
  if (tokens >= BOSS_SPEND_MIN) bossVisit(id, pick(BOSS_SPEND_LINES)(tokens));
}
function drawFloats(t) {
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i], a = agents.get(f.id), age = performance.now() - f.born, life = f.big ? 1900 : 1500;
    if (age < 0) continue;                                              // queued: not its turn yet
    if (!a || age > life) { floats.splice(i, 1); continue; }
    const seated = a.state !== 'idle' && !(a.state === 'coding' && a.activity === 'pr');
    const baseY = seated ? DESKS[a.desk].y - 2 : a.y - 28;               // just above the head
    const p = age / life, rise = 1 - Math.pow(1 - p, 2), pop = age < 120 ? 1 + (1 - age / 120) * 0.6 : 1;
    ctx.save();
    ctx.globalAlpha = p > 0.6 ? 1 - (p - 0.6) / 0.4 : 1;
    ctx.translate(Math.round(a.x + f.dx), Math.round(baseY - rise * 20)); ctx.scale(pop, pop);
    ctx.font = f.big ? "bold 11px 'Microsoft JhengHei','PingFang TC',sans-serif" : FONT;
    label(f.big ? f.text + '!' : f.text, 0, 0, f.big ? '#ffd166' : '#ff6b6b');
    ctx.restore();
  }
}

const hitShake = (o) => { const age = performance.now() - (o.hitAt || -1e9); return age >= 0 && age < 450 ? Math.round(Math.sin(age / 25) * 2 * (1 - age / 450)) : 0; };
const isSeated = (a) => a.state !== 'idle' && !(a.state === 'coding' && a.activity === 'pr');

// ---- "got it!" + boss ----
function onPrompt(id) {
  const a = agents.get(id); if (!a) return;
  const now = performance.now();
  a.ackAt = now;                                                            // the little hop + "收到！"
  if (now - boss.lastPrompt > BOSS_COOLDOWN_MS && Math.random() < BOSS_CHANCE) { boss.lastPrompt = now; bossVisit(id, pick(BOSS_LINES)); }
}
// "Your message is queued": the boss comes (faster than usual) and stays until Claude picks it up.
function onWaiting(id, n) {
  const a = agents.get(id); if (!a) return;
  const was = a.waiting || 0;
  a.waiting = n;
  if (n > 0) bossHold(id);
  else if (was > 0) { a.ackAt = performance.now(); bossRelease(id); }       // picked up: "got it!" and the boss leaves
}
function bossHold(id) {
  const line = pick(BOSS_HURRY_LINES);
  if (boss.state === 'away') { boss.queue = boss.queue.filter((q) => q.id !== id); boss.queue.unshift({ id, line, hurry: true, hold: true }); return; }
  if (boss.id === id) { boss.hold = true; boss.hurry = true; if (boss.state === 'out') boss.state = 'in'; return; }   // already with this person: stay
  if (boss.hold) return;                                                      // busy nagging someone else who is still waiting: this one is next
  Object.assign(boss, { id, line, state: 'in', hurry: true, hold: true, lineAt: performance.now() });
}
function bossRelease(id) {
  boss.queue = boss.queue.filter((q) => q.id !== id);
  if (boss.id !== id || boss.state === 'away') return;
  boss.hold = false;
  const next = [...agents.values()].find((o) => o.id !== id && (o.waiting || 0) > 0);
  if (next) { Object.assign(boss, { id: next.id, line: pick(BOSS_HURRY_LINES), state: 'in', hurry: true, hold: true, lineAt: performance.now() }); return; }
  boss.until = performance.now() + 1200;                                      // a moment of "hmph, fine", then he leaves
  if (boss.state === 'in') boss.state = 'out';
}
function bossVisit(id, line) {
  if (!agents.has(id) || boss.queue.length >= 3 || boss.queue.some((q) => q.id === id) || (boss.id === id && boss.state !== 'away')) return;
  boss.queue.push({ id, line });
}
function bossStand(a) { return isSeated(a) ? { x: a.x + 26, y: DESKS[a.desk].y + 34 } : { x: a.x + 22, y: a.y }; }
function bossShowNow(id, line) {                                            // used by tests/preview.js
  const a = agents.get(id); if (!a) return;
  const s = bossStand(a); Object.assign(boss, { state: 'nag', id, line: line || pick(BOSS_LINES), x: s.x, y: s.y, until: performance.now() + 60000 });
}
function drawBoss(t) {
  const now = performance.now();
  if (boss.state === 'away') {
    while (boss.queue.length && !agents.has(boss.queue[0].id)) boss.queue.shift();
    if (!boss.queue.length) return;
    const q = boss.queue.shift();
    Object.assign(boss, { id: q.id, line: q.line, x: BOSS_DOOR.x, y: BOSS_DOOR.y, state: 'in', hurry: !!q.hurry, hold: !!q.hold, lineAt: performance.now() });
  }
  const a = agents.get(boss.id);
  if (!a && boss.state !== 'out') boss.state = 'out';
  const speed = boss.hurry ? 1.9 : 1.1;
  if (boss.state === 'in' || boss.state === 'out') {
    const dest = boss.state === 'in' ? bossStand(a) : BOSS_DOOR;
    const dx = dest.x - boss.x, dy = dest.y - boss.y, dist = Math.hypot(dx, dy);
    if (dist <= speed) {
      boss.x = dest.x; boss.y = dest.y;
      if (boss.state === 'in') { boss.state = 'nag'; boss.until = now + 5500; } else { boss.state = 'away'; boss.hold = false; return; }
    } else { boss.x += dx / dist * speed; boss.y += dy / dist * speed; boss.face = dx < 0; }
  } else {                                                                  // nagging: stay next to them
    const s = bossStand(a); boss.x = s.x; boss.y = s.y;
    if (boss.hold) {                                                          // Claude has not picked the message up yet: keep nagging
      if (now - boss.lineAt > 3200) { boss.line = pick(BOSS_HURRY_LINES); boss.lineAt = now; }
      if (!(a.waiting > 0)) boss.hold = false;
    }
    if (!boss.hold && now > boss.until) boss.state = 'out';
  }
  const nag = boss.state === 'nag';
  const img = nag ? getSprite('bossnag', ((t / 220) | 0) % 2, '#000', 0, false) : getSprite('boss', ((t / 140) | 0) % 4, '#000', 0, boss.face);
  const ox = Math.round(boss.x - 11 + hitShake(boss) + (nag ? Math.round(Math.sin(t / 45)) : 0)), oy = Math.round(boss.y - 28);
  ctx.drawImage(img, ox, oy);
  ctx.font = SMALL; label('老闆', Math.round(boss.x), Math.round(boss.y + 8), '#ff9a9a');
  if (nag && a) {
    if (isSeated(a)) { const sy = ((t / 220) | 0) % 3; rect(a.x + 8, DESKS[a.desk].y + 6 + sy, 2, 3, '#7fd1ff'); rect(a.x - 9, DESKS[a.desk].y + 8 + ((sy + 1) % 3), 2, 3, '#7fd1ff'); }   // the worker sweats
    ctx.font = BUBBLE;
    const words = []; let cur = '';
    for (const ch of (boss.line.match(/[A-Za-z0-9._-]+|[\s\S]/g) || [])) { if (ctx.measureText(cur + ch).width > 56 && cur) { words.push(cur); cur = ''; } cur += ch; }
    if (cur) words.push(cur);
    const lines = words.slice(0, 3), lh = 8, bw = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + 8, bh = lines.length * lh + 5;
    const jitter = Math.round(Math.sin(t / 35));
    const bx = Math.max(2, Math.min(W - 2 - bw, Math.round(boss.x - bw / 2))) + jitter, by = oy - bh - 3;
    rect(bx - 1, by - 1, bw + 2, bh + 2, '#d62828'); rect(bx, by, bw, bh, '#ffffff');       // white box, red outline: it is the boss shouting
    rect(boss.x - 2, by + bh + 1, 4, 2, '#d62828'); rect(boss.x - 1, by + bh, 2, 1, '#ffffff');
    ctx.fillStyle = '#b3001b'; ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, bx + 4, by + 3 + lh * (i + 1) - 2));
    ctx.textAlign = 'center';
  }
}

// ---- whip (click a character; pure fun, has no effect on anything) ----
function centerOf(kind, o) { return kind === 'helper' ? { x: o._x, y: o._y - 8 } : { x: o.x, y: isSeated(o) ? DESKS[o.desk].y + 14 : o.y - 12 }; }
function whipTarget(kind, o) {
  o.hitAt = performance.now(); o.hitLine = pick(HIT_LINES);
  whips.push({ kind, o, born: o.hitAt });
  if (whips.length > 12) whips.shift();
}
function hitTest(lx, ly) {
  if (boss.state !== 'away' && Math.abs(lx - boss.x) <= 11 && ly >= boss.y - 28 && ly <= boss.y) return { kind: 'boss', o: boss };
  for (const h of helpers.values()) if (h._x !== undefined && agents.has(h.parent) && Math.abs(lx - h._x) <= 8 && ly >= h._y - 18 && ly <= h._y + 3) return { kind: 'helper', o: h };
  let best = null, bd = 1e9;
  for (const a of agents.values()) {
    const seated = isSeated(a), y0 = seated ? DESKS[a.desk].y + 2 : a.y - 25, y1 = seated ? DESKS[a.desk].y + 24 : a.y + 1;
    if (lx >= a.x - 10 && lx <= a.x + 10 && ly >= y0 && ly <= y1) { const dd = Math.hypot(lx - a.x, ly - (y0 + y1) / 2); if (dd < bd) { bd = dd; best = { kind: 'agent', o: a }; } }
  }
  return best;
}
function drawWhips(t) {
  const now = performance.now(), DUR = 800;
  const lerp = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
  for (let i = whips.length - 1; i >= 0; i--) {
    const w = whips[i], age = now - w.born;
    if (age > DUR || (w.kind === 'helper' ? !helpers.has(w.o.id) : !agents.has(w.o.id))) { whips.splice(i, 1); continue; }
    const c = centerOf(w.kind, w.o), u = age / DUR;
    const hand = { x: c.x + 40, y: c.y - 46 };                              // the unseen hand holding the whip (top right)
    const back = { x: c.x + 44, y: c.y - 70 }, hit = { x: c.x, y: c.y - 2 }, away = { x: c.x + 34, y: c.y - 30 };
    let tip, ctrl;
    if (u < 0.35) { tip = lerp(away, back, u / 0.35); ctrl = { x: c.x + 54, y: c.y - 64 }; }               // wind up
    else if (u < 0.5) { tip = lerp(back, hit, (u - 0.35) / 0.15); ctrl = { x: c.x + 24, y: c.y - 50 }; }   // snap forward
    else { tip = lerp(hit, away, Math.max(0, Math.min(1, (u - 0.62) / 0.3))); ctrl = { x: c.x + 20, y: c.y - 30 }; }   // hold, then retract
    ctx.save(); ctx.globalAlpha = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1;
    for (let s = 0; s <= 1.0001; s += 1 / 16) {
      const px = (1 - s) * (1 - s) * hand.x + 2 * (1 - s) * s * ctrl.x + s * s * tip.x, py = (1 - s) * (1 - s) * hand.y + 2 * (1 - s) * s * ctrl.y + s * s * tip.y;
      rect(px, py, 2, 2, s > 0.9 ? '#ffffff' : '#9c6b3c');
    }
    rect(hand.x - 1, hand.y - 3, 3, 6, '#4a2f18');
    if (u >= 0.5 && u < 0.78) {                                             // the crack: burst + sound word
      const p = (u - 0.5) / 0.28;
      for (let k = 0; k < 8; k++) { const ang = k * Math.PI / 4; rect(hit.x + Math.cos(ang) * (4 + p * 8), hit.y + Math.sin(ang) * (4 + p * 8), 2, 2, k % 2 ? '#ffd166' : '#ffffff'); }
      ctx.font = "bold 12px 'Microsoft JhengHei','PingFang TC',sans-serif"; label('啪！', hit.x + 14, hit.y - 14 - p * 6, '#ffd166');
    }
    ctx.restore();
  }
}
function canvasPoint(e) { return { x: (e.clientX - cv.getBoundingClientRect().left - cv.clientLeft) * W / cv.clientWidth, y: (e.clientY - cv.getBoundingClientRect().top - cv.clientTop) * H / cv.clientHeight }; }
window.__po = { whipAgent: (id) => { const a = agents.get(id); if (a) whipTarget('agent', a); }, bossShowNow, boss, onPrompt, onWaiting };   // test hooks (tests/preview.js)

function frame(t) {
  ctx.setTransform(S, 0, 0, S, 0, 0); ctx.imageSmoothingEnabled = false;
  drawRoom(t);
  if (agents.size === 0) { ctx.font = FONT; label('辦公室沒人… 等待 Claude 上班', W / 2, H / 2, '#cfd2e6'); }
  [...agents.values()].sort((p, q) => p.y - q.y).forEach(a => drawAgent(a, t));
  drawHelpers(t);
  drawBoss(t);
  drawWhips(t);
  drawFloats(t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

cv.addEventListener('click', (e) => {
  const p = canvasPoint(e), hit = hitTest(p.x, p.y);
  if (!hit) return;
  if (hit.kind === 'boss') { boss.line = '你敢鞭打老闆！？'; boss.until = Math.max(boss.until, performance.now() + 3000); boss.hitAt = performance.now(); return; }
  whipTarget(hit.kind, hit.o);
});
cv.addEventListener('mousemove', (e) => { const p = canvasPoint(e); cv.style.cursor = hitTest(p.x, p.y) ? 'pointer' : 'default'; });
