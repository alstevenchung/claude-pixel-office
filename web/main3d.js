// Pixel Office 3D: the same data (SSE events) as the 2D version, drawn as a voxel office with three.js (vendored in vendor/, no CDN).
// Everything below is purely visual. Nothing here sends anything anywhere.
(() => {
'use strict';
const stage = document.getElementById('stage'), cv = document.getElementById('c'), ov = document.getElementById('ov'), statusEl = document.getElementById('status');
let renderer;
try {
  renderer = window.__noRender ? { setPixelRatio() {}, setSize() {}, render() {}, shadowMap: {} } : new THREE.WebGLRenderer({ canvas: cv, antialias: true });   // tests run the logic without a GL context
} catch (e) { statusEl.textContent = '這個瀏覽器無法使用 WebGL，沒辦法顯示 3D 辦公室。'; return; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ---------- data ----------
// Logical coordinates are the same as the 2D version (320x180); world = logical / 10 (x -> x, y -> z).
const K = 0.1;
const DESKS = [{ x: 46, y: 62 }, { x: 126, y: 62 }, { x: 206, y: 62 }, { x: 46, y: 122 }, { x: 126, y: 122 }, { x: 206, y: 122 }];
const COOLER = { x: 292, y: 128 };
const COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#8ecae6', '#c77dff', '#90be6d'];
window.sessionModels = {};
const agents = new Map(), helpers = new Map();

const BOSS_CHANCE = 0.5, BOSS_COOLDOWN_MS = 45000, BOSS_SPEND_MIN = 50000, BOSS_DOOR = { x: 326, y: 170 };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));
// Canned lines only; they are NOT derived from what you typed (the prompt text is never read or sent).
const BOSS_LINES = ['這個要快一點喔！', '我昨天不是說過了嗎？', '客戶在等欸！', '怎麼還沒好？', '你確定這樣可以嗎？', '不要又出 bug 啊！', '今天下班前要看到成果！', '這個很簡單吧？', '再檢查一遍！', '不要又燒一堆 token！', '進度呢？進度！'];
const BOSS_SPEND_LINES = [(n) => fmtTok(n) + ' token？！錢不是大風吹的！', () => '預算！預算啊！！', () => '又燒這麼多？！'];
const BOSS_HURRY_LINES = ['快一點啦！', '怎麼這麼慢？！', '我在等欸！', '還沒好嗎？！', '動作快！動作快！', '客戶一直催我啊！', '你是在睡覺嗎？', '再慢我要扣薪水了！'];
const HIT_LINES = ['哎呀！', '是！老闆！', '我會努力！', '饒命啊～', '別打了…', '痛痛痛！'];
const boss = { state: 'away', x: 0, y: 0, face: false, id: null, line: '', until: 0, queue: [], lastPrompt: -1e9, hurry: false, hold: false, lineAt: 0, hitAt: 0 };
const whips = [], floats = [];

// ---------- three.js basics ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3a3558);
const camera = new THREE.PerspectiveCamera(36.5, 16 / 9, 0.5, 200);
camera.position.set(16.4, 21.5, 33.5); camera.lookAt(16.4, 0.4, 10.6);
scene.add(new THREE.HemisphereLight(0xffffff, 0xcdb89a, 2.3));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
sun.position.set(8, 24, 18); sun.target.position.set(16, 0, 10); scene.add(sun, sun.target);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006;
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 16, bottom: -16, near: 1, far: 70 });

const matCache = new Map(), geoCache = new Map();
const M = (c, o) => { const k = c + (o ? JSON.stringify(o) : ''); let m = matCache.get(k); if (!m) { m = new THREE.MeshLambertMaterial(Object.assign({ color: new THREE.Color(c) }, o || {})); matCache.set(k, m); } return m; };
const B = (c, o) => { const k = 'b' + c + (o ? JSON.stringify(o) : ''); let m = matCache.get(k); if (!m) { m = new THREE.MeshBasicMaterial(Object.assign({ color: new THREE.Color(c) }, o || {})); matCache.set(k, m); } return m; };
const G = (w, h, d) => { const k = w + 'x' + h + 'x' + d; let g = geoCache.get(k); if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); } return g; };
function box(w, h, d, c, x, y, z, parent, o) {
  const m = new THREE.Mesh(G(w, h, d), o && o.basic ? B(c) : M(c, o && o.mat));
  m.position.set(x, y, z); m.castShadow = !(o && o.noShadow); m.receiveShadow = true; (parent || scene).add(m); return m;
}
function cyl(rt, rb, h, c, x, y, z, parent, seg) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 20), M(c)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; (parent || scene).add(m); return m;
}
const pivot = (x, y, z, parent) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
const wp = (lx, ly) => new THREE.Vector3(lx * K, 0, ly * K);   // logical -> world (floor level)

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return { tex: t, ctx: g, canvas: c };
}

// ---------- the room ----------
const FLOOR_Z0 = 4.1, FLOOR_Z1 = 18, ROOM_W = 32;
const dynamic = { rackLeds: [], dbTop: null, flag: null, cloud: [], clockHour: null, clockMin: null, screens: [] };
function buildRoom() {
  // diorama base
  box(ROOM_W + 1.6, 0.7, FLOOR_Z1 - FLOOR_Z0 + 1.6, '#5d4a3a', ROOM_W / 2, -0.75, (FLOOR_Z0 + FLOOR_Z1) / 2 + 0.2);
  const ft = canvasTex(320, 140, (g, w, h) => {
    g.fillStyle = '#c79c6d'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 10) { g.fillStyle = '#b58a5c'; g.fillRect(0, y, w, 1); for (let x = ((y / 10) % 2) * 30 + 8; x < w; x += 60) g.fillRect(x, y, 1, 10); }
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, FLOOR_Z1 - FLOOR_Z0), new THREE.MeshLambertMaterial({ map: ft.tex }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(ROOM_W / 2, 0, (FLOOR_Z0 + FLOOR_Z1) / 2); floor.receiveShadow = true; scene.add(floor);
  // rug
  box(17, 0.04, 8, '#7b6fb0', 16.3, 0.02, 13.6, null, { noShadow: true }); box(16.4, 0.05, 7.4, '#9a8fd0', 16.3, 0.03, 13.6, null, { noShadow: true }); box(15.8, 0.06, 6.8, '#7b6fb0', 16.3, 0.04, 13.6, null, { noShadow: true });
  // back wall (+ side stubs so it reads as a corner room)
  box(ROOM_W + 0.8, 4.2, 0.4, '#f1e4cf', ROOM_W / 2, 2.1, FLOOR_Z0 - 0.2);
  box(ROOM_W + 0.8, 1.4, 0.12, '#8fb8b0', ROOM_W / 2, 0.7, FLOOR_Z0 + 0.04); box(ROOM_W + 0.8, 0.1, 0.16, '#6f9a92', ROOM_W / 2, 1.42, FLOOR_Z0 + 0.04);
  box(ROOM_W + 0.8, 0.3, 0.5, '#5d4a3a', ROOM_W / 2, 4.3, FLOOR_Z0 - 0.15);
  box(0.4, 4.2, 3, '#e8d9c0', -0.2, 2.1, FLOOR_Z0 + 1.3); box(0.4, 4.2, 3, '#e8d9c0', ROOM_W + 0.2, 2.1, FLOOR_Z0 + 1.3);
  const wy = (ly) => (41 - ly) / 10;
  // windows
  for (const wx of [24, 104, 184]) {
    const cx = (wx + 18) * K, cy = wy(14), z = FLOOR_Z0 + 0.1;
    box(4.2, 2.2, 0.16, '#e0d2b8', cx, cy, z);
    const sky = canvasTex(36, 18, (g) => { const gr = g.createLinearGradient(0, 0, 0, 18); gr.addColorStop(0, '#a9dcf0'); gr.addColorStop(1, '#8ecae6'); g.fillStyle = gr; g.fillRect(0, 0, 36, 18); g.fillStyle = '#fff'; g.fillRect(5, 8, 10, 3); g.fillRect(8, 6, 8, 3); g.fillRect(22, 10, 9, 3); });
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), new THREE.MeshBasicMaterial({ map: sky.tex })); pane.position.set(cx, cy, z + 0.09); scene.add(pane);
    box(0.14, 1.8, 0.1, '#e0d2b8', cx, cy, z + 0.12, null, { noShadow: true }); box(3.6, 0.14, 0.1, '#e0d2b8', cx, cy, z + 0.12, null, { noShadow: true });
  }
  // clock
  const cx0 = 26.6, cy0 = wy(14);
  const face = cyl(0.8, 0.8, 0.12, '#fffaf0', cx0, cy0, FLOOR_Z0 + 0.12); face.rotation.x = Math.PI / 2;
  const rim = cyl(0.9, 0.9, 0.1, '#5d4a3a', cx0, cy0, FLOOR_Z0 + 0.1); rim.rotation.x = Math.PI / 2;
  dynamic.clockHour = pivot(cx0, cy0, FLOOR_Z0 + 0.22, scene); box(0.1, 0.45, 0.04, '#22223b', 0, 0.22, 0, dynamic.clockHour, { noShadow: true });
  dynamic.clockMin = pivot(cx0, cy0, FLOOR_Z0 + 0.25, scene); box(0.07, 0.65, 0.04, '#22223b', 0, 0.32, 0, dynamic.clockMin, { noShadow: true });
  // whiteboard
  box(3.6, 2.4, 0.14, '#9aa0b5', 30.0, wy(15), FLOOR_Z0 + 0.1); box(3.2, 2.0, 0.06, '#ffffff', 30.0, wy(15), FLOOR_Z0 + 0.18, null, { noShadow: true });
  box(1.4, 0.07, 0.04, '#e63946', 29.4, wy(10), FLOOR_Z0 + 0.23, null, { noShadow: true }); box(2.2, 0.07, 0.04, '#1d3557', 29.8, wy(14), FLOOR_Z0 + 0.23, null, { noShadow: true }); box(1.0, 0.07, 0.04, '#2a9d8f', 29.2, wy(18), FLOOR_Z0 + 0.23, null, { noShadow: true });
  // bookshelf
  box(1.6, 3.2, 0.7, '#7d5236', 1.2, 1.6, FLOOR_Z0 + 0.5);
  [0.5, 1.4, 2.3].forEach((y, r) => { box(1.3, 0.8, 0.5, '#5d3d28', 1.2, y + 0.3, FLOOR_Z0 + 0.62, null, { noShadow: true }); ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#e9c46a'].forEach((c, i) => box(0.18, 0.62 + (i % 2) * 0.1, 0.42, c, 0.7 + i * 0.25, y + 0.3, FLOOR_Z0 + 0.66, null, { noShadow: true })); });
  plant(1.4, 16.8); plant(30.6, 6.0);
  // Git cloud
  const cg = new THREE.Group(); cg.position.set(24.3, wy(14), FLOOR_Z0 + 0.5); scene.add(cg);
  [[0, 0, 0.9], [-0.9, -0.15, 0.7], [0.9, -0.1, 0.75], [0.4, 0.35, 0.65], [-0.4, 0.3, 0.55]].forEach(([x, y, r]) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r * 0.75, 12, 10), M('#eaf2ff')); s.position.set(x, y, 0); s.scale.z = 0.6; s.castShadow = true; cg.add(s); dynamic.cloud.push(s); });
  box(0.12, 0.5, 0.1, '#f05033', 0, 0, 0.5, cg, { basic: true, noShadow: true });
  // wall server rack
  const rk = new THREE.Group(); rk.position.set(15.9, 2.65, FLOOR_Z0 + 0.45); scene.add(rk);
  box(1.9, 2.0, 0.8, '#2f3447', 0, 0, 0, rk); box(1.9, 0.1, 0.82, '#4a526e', 0, 1.0, 0, rk, { noShadow: true });
  for (let k = 0; k < 3; k++) { box(1.5, 0.42, 0.1, '#3c4460', 0, 0.55 - k * 0.55, 0.42, rk, { noShadow: true }); dynamic.rackLeds.push(box(0.14, 0.14, 0.06, '#5dff9b', 0.5, 0.55 - k * 0.55, 0.5, rk, { basic: true, noShadow: true })); }
  // PR mailbox
  box(0.2, 1.5, 0.2, '#6b513a', 30.3, 0.75, 9.0); box(1.5, 1.0, 1.0, '#d62828', 30.3, 1.8, 9.0); box(1.1, 0.25, 0.75, '#f26b6b', 30.3, 2.4, 9.0, null, { noShadow: true });
  box(0.9, 0.2, 0.06, '#5a1010', 29.55, 1.9, 9.0, null, { noShadow: true });
  dynamic.flag = pivot(31.1, 2.0, 9.0, scene); box(0.14, 0.7, 0.14, '#ffd166', 0, 0.35, 0, dynamic.flag, { basic: true, noShadow: true }); box(0.45, 0.25, 0.1, '#ffd166', 0.2, 0.62, 0, dynamic.flag, { basic: true, noShadow: true });
  // database cylinder
  const dx = 30.8, dz = 15.8;
  for (let i = 0; i < 3; i++) cyl(0.85, 0.85, 0.46, i % 2 ? '#4a6a96' : '#5b7fae', dx, 0.25 + i * 0.5, dz, null, 24);
  dynamic.dbTop = cyl(0.88, 0.88, 0.12, '#a9c8f0', dx, 1.78, dz, null, 24);
  // water cooler
  const cl = wp(COOLER.x, COOLER.y);
  box(1.3, 2.3, 1.1, '#eceff4', cl.x, 1.15, cl.z); cyl(0.55, 0.55, 0.95, '#9bd1f0', cl.x, 2.75, cl.z); box(0.3, 0.3, 0.1, '#e63946', cl.x - 0.25, 1.5, cl.z + 0.58, null, { basic: true, noShadow: true }); box(0.3, 0.3, 0.1, '#3a86ff', cl.x + 0.25, 1.5, cl.z + 0.58, null, { basic: true, noShadow: true });
  // desks + chairs
  DESKS.forEach((d, i) => buildDesk(d, i));
  // static labels
  window.__labels = [{ k: 'sGit', t: 'Git 雲端', p: [24.3, 1.35, FLOOR_Z0 + 0.6] }, { k: 'sPR', t: 'PR 信箱', p: [30.3, 2.9, 9.0] }];
}
function plant(x, z) {
  cyl(0.5, 0.4, 0.8, '#b5651d', x, 0.4, z); cyl(0.55, 0.55, 0.15, '#d98a3d', x, 0.85, z); box(0.18, 1.0, 0.18, '#2d6a4f', x, 1.4, z);
  box(0.8, 0.7, 0.8, '#40916c', x - 0.4, 2.0, z); box(0.8, 0.8, 0.8, '#52b788', x + 0.4, 2.2, z + 0.1); box(0.7, 0.7, 0.7, '#74c69d', x, 2.6, z - 0.1);
}
function buildDesk(d, i) {
  const cx = d.x * K + 2.3, cz = d.y * K + 1.05;
  box(4.6, 0.22, 2.1, '#c48b62', cx, 0.9, cz); box(4.4, 0.12, 1.9, '#a9744f', cx, 0.73, cz, null, { noShadow: true });
  [[-2.1, -0.85], [2.1, -0.85], [-2.1, 0.85], [2.1, 0.85]].forEach(([x, z]) => box(0.22, 0.8, 0.22, '#7d5236', cx + x, 0.4, cz + z));
  box(1.3, 0.55, 0.06, '#8f5f3e', cx - 1.5, 0.45, cz + 1.0, null, { noShadow: true });
  // monitor (screen faces +z, toward the person's seat and the camera)
  box(0.9, 0.12, 0.6, '#3a3d52', cx, 1.07, cz - 0.4); box(0.25, 0.4, 0.2, '#3a3d52', cx, 1.3, cz - 0.4);
  box(2.0, 1.3, 0.14, '#1f2233', cx, 1.95, cz - 0.4);
  const sc = canvasTex(64, 40, () => {});
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), new THREE.MeshBasicMaterial({ map: sc.tex })); scr.position.set(cx, 1.95, cz - 0.4 + 0.08); scene.add(scr);
  dynamic.screens[i] = { ...sc, sig: '' };
  // keyboard + mug
  box(1.5, 0.08, 0.5, '#d9dbe6', cx, 1.04, cz + 0.45, null, { noShadow: true }); cyl(0.2, 0.2, 0.3, '#ffffff', cx + 1.7, 1.15, cz + 0.1, null, 12);
  // chair
  const px = d.x * K + 2.2, pz = d.y * K + 3.0;
  box(1.3, 0.16, 1.2, '#3d405b', px, 0.55, pz); box(1.3, 1.0, 0.16, '#5c6088', px, 1.1, pz + 0.62); cyl(0.08, 0.08, 0.5, '#2a2c40', px, 0.28, pz, null, 8); box(1.0, 0.08, 0.1, '#2a2c40', px, 0.05, pz, null, { noShadow: true }); box(0.1, 0.08, 1.0, '#2a2c40', px, 0.05, pz, null, { noShadow: true });
}
function drawScreen(i, a, t) {
  const s = dynamic.screens[i], lit = a && (a.state === 'coding' || a.state === 'thinking' || a.state === 'background');
  const frame = lit ? ((t / 180) | 0) : -1, sig = lit ? a.state + frame : 'off';
  if (s.sig === sig) return; s.sig = sig;
  const g = s.ctx; g.fillStyle = lit ? (a.state === 'coding' ? '#0b3d3a' : '#12304f') : '#2b3044'; g.fillRect(0, 0, 64, 40);
  if (lit) { g.fillStyle = a.state === 'coding' ? '#7ee0c8' : '#8ecae6'; for (let k = 0; k < 6; k++) g.fillRect(6, 5 + k * 6, 10 + (((t / 180) + k * 5) % 9 | 0) * 4, 3); }
  s.tex.needsUpdate = true;
}

// ---------- people (voxel) ----------
const SKIN = ['#f2c9a0', '#e0ac7e', '#c68863', '#8d5a3b'], HAIR = ['#2b2118', '#6b3f1d', '#d9a441', '#b5472b', '#1d1d24', '#8a8a8a'], PANTS = ['#3d405b', '#2f4858', '#4a3b52', '#2b3a2f', '#3b3b3b', '#2f3b5c'];
function makePerson(shirt, look, isBoss) {
  const root = new THREE.Group(), body = pivot(0, 0, 0, root), P = { root, body };
  const skin = isBoss ? '#f0c29a' : SKIN[look % 4], hair = HAIR[(look * 3 + 1) % HAIR.length], pants = isBoss ? '#1d1f33' : PANTS[look % PANTS.length], top = isBoss ? '#2b2d42' : shirt;
  P.legL = pivot(-0.28, 1.0, 0, body); P.legR = pivot(0.28, 1.0, 0, body);
  [P.legL, P.legR].forEach((l) => { box(0.46, 0.85, 0.52, pants, 0, -0.43, 0, l); box(0.5, 0.2, 0.7, '#1b1b26', 0, -0.9, 0.08, l); });
  box(1.15, 0.95, 0.62, top, 0, 1.45, 0, body);
  if (isBoss) { box(1.45, 0.8, 0.62, '#f4f1ea', 0, 1.3, 0.38, body); box(0.17, 0.75, 0.05, '#d62828', 0, 1.42, 0.71, body, { basic: true, noShadow: true }); }
  else box(0.5, 0.1, 0.06, '#ffffff', 0, 1.9, 0.32, body, { noShadow: true });
  P.armL = pivot(-0.74, 1.85, 0, body); P.armR = pivot(0.74, 1.85, 0, body);
  [P.armL, P.armR].forEach((a) => { box(0.36, 0.62, 0.4, top, 0, -0.31, 0, a); box(0.32, 0.3, 0.34, skin, 0, -0.75, 0, a); });
  P.head = pivot(0, 1.93, 0, body);
  box(0.95, 0.95, 0.95, skin, 0, 0.48, 0, P.head);
  if (isBoss) { box(0.2, 0.3, 0.6, '#9a9a9a', -0.52, 0.45, -0.05, P.head); box(0.2, 0.3, 0.6, '#9a9a9a', 0.52, 0.45, -0.05, P.head); box(0.95, 0.5, 0.2, '#9a9a9a', 0, 0.35, -0.5, P.head); }
  else { box(1.0, 0.3, 1.0, hair, 0, 0.98, 0, P.head); box(1.0, 0.7, 0.22, hair, 0, 0.62, -0.5, P.head); if (look % 3 === 0) { box(0.1, 0.4, 0.5, hair, -0.5, 0.65, 0.05, P.head); box(0.1, 0.4, 0.5, hair, 0.5, 0.65, 0.05, P.head); } }
  box(0.14, 0.16, 0.05, '#14141f', -0.23, 0.55, 0.49, P.head, { basic: true, noShadow: true }); box(0.14, 0.16, 0.05, '#14141f', 0.23, 0.55, 0.49, P.head, { basic: true, noShadow: true });
  box(0.3, 0.07, 0.05, isBoss ? '#7a2a2a' : '#a0524a', 0, 0.28, 0.49, P.head, { basic: true, noShadow: true });
  if (isBoss) { box(0.34, 0.08, 0.05, '#14141f', -0.23, 0.72, 0.5, P.head, { basic: true, noShadow: true }); box(0.34, 0.08, 0.05, '#14141f', 0.23, 0.72, 0.5, P.head, { basic: true, noShadow: true }); }
  root.scale.setScalar(isBoss ? 0.92 : 0.85);
  scene.add(root); return P;
}
function poseOf(P, pose, t, ph) {
  const s = t / 1000;
  const set = (ll, lr, al, ar, alz, arz) => { P.legL.rotation.x = ll; P.legR.rotation.x = lr; P.armL.rotation.x = al; P.armR.rotation.x = ar; P.armL.rotation.z = alz || 0; P.armR.rotation.z = arz || 0; };
  P.body.position.y = 0; P.head.rotation.set(0, 0, 0); P.body.rotation.set(0, 0, 0);
  switch (pose) {
    case 'walk': { const w = Math.sin(s * 9 + ph) * 0.7; set(w, -w, -w * 0.8, w * 0.8); P.body.position.y = Math.abs(Math.sin(s * 9 + ph)) * 0.06; break; }
    case 'type': { const k = Math.sin(s * 22 + ph); set(-1.57, -1.57, -1.15 + k * 0.12, -1.15 - k * 0.12); P.head.rotation.x = 0.12; break; }
    case 'think': set(-1.57, -1.57, -0.9, -2.55 + Math.sin(s * 2) * 0.05, 0, 0.35); P.head.rotation.z = Math.sin(s * 1.5) * 0.08; break;
    case 'wave': set(-1.57, -1.57, -0.7, 0, 0, 2.9 + Math.sin(s * 9) * 0.45); break;
    case 'sit': set(-1.57, -1.57, -0.7, -0.7); P.body.position.y = Math.sin(s * 2.2 + ph) * 0.02; break;
    case 'nag': set(0, 0, -2.7 + Math.sin(s * 25) * 0.25, -2.7 - Math.sin(s * 25) * 0.25, 0.2, -0.2); P.head.rotation.x = -0.1; break;
    default: set(0, 0, Math.sin(s * 1.6 + ph) * 0.04, -Math.sin(s * 1.6 + ph) * 0.04); P.body.position.y = Math.sin(s * 1.6 + ph) * 0.015;
  }
}
function makeBot(color) {
  const g = new THREE.Group();
  box(1.0, 0.9, 0.8, color, 0, 0.75, 0, g); box(0.8, 0.14, 0.82, '#2a2c40', 0, 0.35, 0, g); box(0.9, 0.7, 0.7, '#cfd6e6', 0, 1.55, 0, g);
  box(0.16, 0.16, 0.05, '#5dff9b', -0.2, 1.6, 0.36, g, { basic: true, noShadow: true }); box(0.16, 0.16, 0.05, '#5dff9b', 0.2, 1.6, 0.36, g, { basic: true, noShadow: true });
  box(0.06, 0.35, 0.06, '#9aa0b5', 0, 2.05, 0, g, { noShadow: true }); box(0.16, 0.16, 0.16, '#ff5d5d', 0, 2.3, 0, g, { basic: true, noShadow: true });
  box(0.2, 0.5, 0.2, '#cfd6e6', -0.62, 0.8, 0, g); box(0.2, 0.5, 0.2, '#cfd6e6', 0.62, 0.8, 0, g);
  scene.add(g); return g;
}

// ---------- overlay (DOM labels pinned to world points) ----------
const uiEls = new Map(); let used = new Set();
const tmpV = new THREE.Vector3();
function lab(key, cls, html, x, y, z, tx, ty) {
  let e = uiEls.get(key);
  if (!e) { e = { el: document.createElement('div'), html: '', cls: '' }; ov.appendChild(e.el); uiEls.set(key, e); }
  if (e.cls !== cls) { e.el.className = cls; e.cls = cls; }
  if (e.html !== html) { e.el.innerHTML = html; e.html = html; }
  tmpV.set(x, y, z).project(camera);
  const sx = (tmpV.x * 0.5 + 0.5) * stageW, sy = (-tmpV.y * 0.5 + 0.5) * stageH;
  e.el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(${tx || '-50%'},${ty || '-100%'})`;
  used.add(key); return e;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let stageW = 1280, stageH = 720;
function resize() {
  stageW = stage.clientWidth || 1280; stageH = stage.clientHeight || 720;
  renderer.setSize(stageW, stageH, false); camera.aspect = stageW / stageH; camera.updateProjectionMatrix();
  stage.style.setProperty('--u', (stageW / 1280).toFixed(3));
}
window.addEventListener('resize', resize); resize();

// ---------- agents ----------
function deskFor() {
  const usedD = new Set([...agents.values()].map((a) => a.desk));
  for (let i = 0; i < DESKS.length; i++) if (!usedD.has(i)) return i;
  return agents.size % DESKS.length;
}
function disposeFx(o) { if (o._fx) { scene.remove(o._fx); o._fx = null; } o._fxKind = ''; }
function upsert(a) {
  if (a.kind === 'helper') {
    let h = helpers.get(a.id);
    if (!h) { h = { born: performance.now() }; helpers.set(a.id, h); }
    Object.assign(h, a); return;
  }
  let o = agents.get(a.id);
  if (!o) {
    const desk = deskFor();
    o = { desk, color: COLORS[desk % COLORS.length], x: COOLER.x, y: COOLER.y, wander: 0, face: 0, ph: Math.random() * 6 };
    o.p = makePerson(o.color, desk, false); tag(o.p.root, 'agent', o);
    agents.set(a.id, o);
  }
  Object.assign(o, a);
}
function removeAgent(id) {
  const o = agents.get(id); if (o) { scene.remove(o.p.root); disposeFx(o); agents.delete(id); }
  const h = helpers.get(id); if (h) { if (h.g) scene.remove(h.g); helpers.delete(id); }
}
function tag(root, kind, o) { root.traverse((c) => { c.userData.owner = { kind, o }; }); }
const isSeated = (a) => a.state !== 'idle' && !(a.state === 'coding' && a.activity === 'pr');
const hitShake = (o) => { const age = performance.now() - (o.hitAt || -1e9); return age >= 0 && age < 450 ? Math.sin(age / 25) * 0.2 * (1 - age / 450) : 0; };

function updateAgent(a, t, dt) {
  const d = DESKS[a.desk], toMail = a.state === 'coding' && a.activity === 'pr', atDesk = a.state !== 'idle' && !toMail;
  if (atDesk) { a.tx = d.x + 22; a.ty = d.y + 30; }
  else if (toMail) { const slot = [...agents.values()].filter((o) => o.state === 'coding' && o.activity === 'pr' && o.desk < a.desk).length; a.tx = 288 - slot * 16; a.ty = 98; }
  else if (t > a.wander) { a.wander = t + 3000 + Math.random() * 4000; a.tx = 262 + Math.random() * 24; a.ty = COOLER.y + 14 + Math.random() * 28; }
  const dx = a.tx - a.x, dy = a.ty - a.y, dist = Math.hypot(dx, dy), moving = dist > 1;
  if (moving) { const st = Math.min(36 * dt, dist); a.x += dx / dist * st; a.y += dy / dist * st; a.face = Math.atan2(dx, dy); }
  const seated = atDesk && !moving, pose = moving ? 'walk' : seated ? (a.state === 'coding' ? 'type' : (a.state === 'thinking' || a.state === 'background') ? 'think' : a.state === 'waiting_approval' ? 'wave' : 'sit') : 'stand';
  a._seated = seated; a._moving = moving;
  const p = a.p, now = performance.now();
  poseOf(p, pose, t, a.ph);
  const ackAge = now - (a.ackAt || -1e9), hitAge = now - (a.hitAt || -1e9);
  const hop = ackAge < 520 ? Math.abs(Math.sin(ackAge / 85)) * 0.7 * (1 - ackAge / 520) : 0;
  let rotY = seated ? Math.PI : a.face;
  const dr = ((rotY - p.root.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  p.root.rotation.y += dr * Math.min(1, dt * 12);
  const w = wp(a.x, a.y);
  p.root.position.set(w.x + hitShake(a), (seated ? -0.2 : 0) + hop, w.z);
  a._head = new THREE.Vector3(w.x, (seated ? 2.45 : 2.45), w.z);
  if (p.hitStars) { p.hitStars.visible = hitAge >= 0 && hitAge < 700; p.hitStars.rotation.y = hitAge / 90; }
  else { const sg = new THREE.Group(); sg.position.y = 3.0; for (let k = 0; k < 3; k++) { const m = new THREE.Mesh(G(0.22, 0.22, 0.22), B('#ffd166')); m.position.set(Math.cos(k * 2.1) * 0.9, 0, Math.sin(k * 2.1) * 0.9); sg.add(m); } sg.visible = false; p.root.add(sg); p.hitStars = sg; }
  // labels
  const hx = a._head.x, hz = a._head.z, k = 'a' + a.id;
  const mdl = window.sessionModels[a.id] || a.model;
  lab(k + 'n', 'tag', esc(a.name) + (mdl && window.modelName ? '<small>' + esc(window.modelName(mdl)) + '</small>' : ''), hx, 3.45, hz);
  if (hitAge >= 0 && hitAge < 1300) lab(k + 's', 'say hit', esc(a.hitLine || '哎呀！'), hx, 3.7 + hitAge / 900, hz);
  else if (ackAge >= 0 && ackAge < 1300) lab(k + 's', 'say', '收到！', hx, 3.7 + ackAge / 900, hz);
  else if (a.waiting > 0) lab(k + 's', 'say wait', '等待處理中…' + (a.waiting > 1 ? ' ×' + a.waiting : ''), hx, 3.7 + (boss.id === a.id && boss.state !== 'away' ? 0.9 : 0), hz);
  if (!moving) {
    let txt = '', badge = false;
    if (a.state === 'waiting_approval') { txt = '需要你確認' + (a.action ? '：' + a.action : ''); badge = ((t / 400) | 0) % 2 === 1; }
    else if (a.state === 'background') txt = '等背景工作' + '.'.repeat((((t / 500) | 0) % 3) + 1);
    else if (a.state === 'thinking') txt = '思考中' + '.'.repeat((((t / 350) | 0) % 3) + 1);
    else if (a.state === 'coding') txt = (a.action || '工作中') + (a.target ? '：' + a.target : '');
    if (txt) {
      const left = (w.x * stageW / ROOM_W + 260 * (stageW / 1280)) > stageW;      // near the right edge: open to the left
      lab(k + 'b', 'bub' + (left ? ' left' : ''), esc(txt) + (badge ? '<span class="bang">!</span>' : ''), hx + (left ? -0.9 : 0.9), 3.0, hz, left ? '-100%' : '8px', '-100%');
    }
  }
  updateFx(a, t, hx, hz);
}

// Git / GitHub / server / DB / container effects. Only a category comes from the hook, never the command.
const CLOUD = new THREE.Vector3(24.3, 2.7, 4.8), MAIL = new THREE.Vector3(30.3, 2.0, 9.0), RACK = new THREE.Vector3(15.9, 2.6, 4.9), DBP = new THREE.Vector3(30.8, 1.6, 15.8);
function makeFx(kind) {
  const g = new THREE.Group();
  if (kind === 'push') { box(0.9, 0.06, 0.4, '#ffffff', 0, 0, 0, g, { basic: true, noShadow: true }); box(0.4, 0.28, 0.06, '#bcd0ff', -0.2, 0.1, 0, g, { basic: true, noShadow: true }); }
  else if (kind === 'pull') { box(0.7, 0.55, 0.7, '#c8935a', 0, 0, 0, g); box(0.1, 0.57, 0.72, '#e9c46a', 0, 0, 0, g, { noShadow: true }); }
  else if (kind === 'pr') { box(0.8, 0.5, 0.08, '#ffffff', 0, 0, 0, g, { basic: true, noShadow: true }); box(0.1, 0.1, 0.1, '#d62828', 0, 0, 0.06, g, { basic: true, noShadow: true }); }
  else if (kind === 'ssh' || kind === 'db') for (let i = 0; i < 3; i++) box(0.26, 0.26, 0.26, kind === 'ssh' ? '#6ff0ff' : '#ffd166', 0, 0, 0, g, { basic: true, noShadow: true });
  else if (kind === 'commit') { box(1.0, 1.2, 0.08, '#ffffff', 0, 0, 0, g, { basic: true, noShadow: true }); [0.3, 0.05, -0.2].forEach((y) => box(0.6, 0.06, 0.04, '#aab4cf', 0, y, 0.05, g, { basic: true, noShadow: true })); g.userData.stamp = box(0.5, 0.5, 0.5, '#b83232', 0, 1, 0.1, g, { basic: true, noShadow: true }); g.userData.check = box(0.5, 0.2, 0.05, '#2fbf71', 0, -0.35, 0.08, g, { basic: true, noShadow: true }); }
  else if (kind === 'container') { for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) box(0.45, 0.35, 0.45, '#2496ed', (c - 1) * 0.5, r * 0.4, 0, g, { noShadow: true }); box(1.6, 0.12, 0.6, '#1f7ac2', 0, -0.25, 0, g, { noShadow: true }); }
  else { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), B(kind === 'merge' ? '#a371f7' : kind === 'gh' ? '#8ecae6' : '#f05033')); g.add(m); }
  scene.add(g); return g;
}
function updateFx(a, t, hx, hz) {
  const kind = a.state === 'coding' && a.activity ? a.activity : '';
  if (a._fxKind !== kind) { disposeFx(a); if (kind) { a._fx = makeFx(kind); a._fxKind = kind; } }
  const g = a._fx; if (!g) return;
  const head = new THREE.Vector3(hx, 3.2, hz);
  const arc = (from, to, rot) => { const p = (t % 1500) / 1500; g.position.lerpVectors(from, to, p); g.position.y += Math.sin(Math.PI * p) * 1.6; g.lookAt(to); if (rot) g.rotateZ(p * 6); };
  if (kind === 'push') arc(head, CLOUD);
  else if (kind === 'pull') { arc(CLOUD, head); g.rotation.set(0, t / 400, 0); }
  else if (kind === 'pr') arc(new THREE.Vector3(hx + 0.6, 2.2, hz), MAIL);
  else if (kind === 'ssh' || kind === 'db') {
    const to = kind === 'ssh' ? RACK : DBP;
    g.children.forEach((c, i) => { const p = ((t + i * 500) % 1500) / 1500; c.position.lerpVectors(head, to, p); c.position.y += Math.sin(Math.PI * p) * 1.1; });
  } else if (kind === 'commit') {
    const down = ((t / 350) | 0) % 4 >= 2; g.position.set(hx - 1.6, 3.4, hz + 0.2); g.userData.stamp.position.y = down ? 0 : 1.0; g.userData.check.visible = down;
  } else if (kind === 'container') { g.position.set(hx - 1.7, 3.3 + (((t / 300) | 0) % 2) * 0.06, hz); g.children.forEach((c, i) => { if (i < 6) c.position.y = Math.floor(i / 3) * 0.4 + ((((t / 300) | 0) % 2) && i % 3 === 1 ? 0.07 : 0); }); }
  else { g.position.set(hx - 1.5, 3.6, hz); g.children[0].rotation.y = t / 500; g.children[0].rotation.x = t / 900; }
}

// helpers: little robots, left of the owner's desk
const HELPER_NAMES = { Explore: '探索', Plan: '規劃', 'general-purpose': '通用' };
function updateHelpers(t) {
  const byParent = new Map();
  for (const [id, h] of helpers) {
    if (!agents.has(h.parent)) { if (h.g) h.g.visible = false; continue; }
    if (!byParent.has(h.parent)) byParent.set(h.parent, []);
    byParent.get(h.parent).push(h);
  }
  for (const [pid, list] of byParent) {
    const pa = agents.get(pid), d = DESKS[pa.desk];
    list.sort((p, q) => p.born - q.born).forEach((h, i) => {
      if (!h.g) { h.g = makeBot(pa.color); tag(h.g, 'helper', h); }
      if (i >= 4) { h.g.visible = false; return; }
      h.g.visible = true;
      const lx = d.x - 10 - (i % 2) * 14, ly = d.y + 30 + Math.floor(i / 2) * 21; h._x = lx; h._y = ly;
      const w = wp(lx, ly), age = t - h.born, hop = age < 450 ? Math.abs(Math.sin(age / 70)) * 1.0 * (1 - age / 450) : 0;
      const idle = h.state === 'idle' ? 0 : Math.abs(Math.sin(t / 160 + i)) * 0.12;
      h.g.position.set(w.x + hitShake(h), hop + idle, w.z); h.g.rotation.y = 0.35;
      const k = 'h' + h.id;
      lab(k, 'tag bot', esc(HELPER_NAMES[h.name] || String(h.name || '助手').slice(0, 3)), w.x, 2.9, w.z);
      if (i === 3 && list.length > 4) lab(k + 'm', 'tag more', '+' + (list.length - 4), w.x - 1.2, 2.0, w.z);
    });
  }
}

// ---------- tokens spent: floating "-1.2K" ----------
function addSpend(id, tokens) {
  if (!agents.has(id)) return;
  const now = performance.now(), queued = floats.filter((x) => x.id === id && now - x.born < 600).length;
  floats.push({ id, text: '-' + fmtTok(tokens), big: tokens >= 50000, born: now + queued * 260, dx: (Math.random() - 0.5) * 1.4, key: 'f' + Math.random() });
  if (floats.length > 40) floats.shift();
  if (window.pulseHp) window.pulseHp();
  if (tokens >= BOSS_SPEND_MIN) bossVisit(id, pick(BOSS_SPEND_LINES)(tokens));
}
function updateFloats() {
  const now = performance.now();
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i], a = agents.get(f.id), age = now - f.born, life = f.big ? 1900 : 1500;
    if (age < 0) continue;
    if (!a || age > life) { floats.splice(i, 1); continue; }
    const p = age / life, rise = 1 - Math.pow(1 - p, 2), e = lab(f.key, 'fl' + (f.big ? ' big' : ''), esc(f.big ? f.text + '!' : f.text), a.p.root.position.x + f.dx, 3.6 + rise * 1.1, a.p.root.position.z);
    e.el.style.opacity = p > 0.6 ? String(1 - (p - 0.6) / 0.4) : '1';
  }
}

// ---------- "got it!" + boss ----------
function onPrompt(id) {
  const a = agents.get(id); if (!a) return;
  const now = performance.now(); a.ackAt = now;
  if (now - boss.lastPrompt > BOSS_COOLDOWN_MS && Math.random() < BOSS_CHANCE) { boss.lastPrompt = now; bossVisit(id, pick(BOSS_LINES)); }
}
function onWaiting(id, n) {
  const a = agents.get(id); if (!a) return;
  const was = a.waiting || 0; a.waiting = n;
  if (n > 0) bossHold(id); else if (was > 0) { a.ackAt = performance.now(); bossRelease(id); }
}
function bossHold(id) {
  const line = pick(BOSS_HURRY_LINES);
  if (boss.state === 'away') { boss.queue = boss.queue.filter((q) => q.id !== id); boss.queue.unshift({ id, line, hurry: true, hold: true }); return; }
  if (boss.id === id) { boss.hold = true; boss.hurry = true; if (boss.state === 'out') boss.state = 'in'; return; }
  if (boss.hold) return;
  Object.assign(boss, { id, line, state: 'in', hurry: true, hold: true, lineAt: performance.now() });
}
function bossRelease(id) {
  boss.queue = boss.queue.filter((q) => q.id !== id);
  if (boss.id !== id || boss.state === 'away') return;
  boss.hold = false;
  const next = [...agents.values()].find((o) => o.id !== id && (o.waiting || 0) > 0);
  if (next) { Object.assign(boss, { id: next.id, line: pick(BOSS_HURRY_LINES), state: 'in', hurry: true, hold: true, lineAt: performance.now() }); return; }
  boss.until = performance.now() + 1200; if (boss.state === 'in') boss.state = 'out';
}
function bossVisit(id, line) {
  if (!agents.has(id) || boss.queue.length >= 3 || boss.queue.some((q) => q.id === id) || (boss.id === id && boss.state !== 'away')) return;
  boss.queue.push({ id, line });
}
const bossStand = (a) => (isSeated(a) ? { x: a.x + 26, y: DESKS[a.desk].y + 34 } : { x: a.x + 22, y: a.y });
function bossShowNow(id, line) {                                  // used by tests/preview.js
  const a = agents.get(id); if (!a) return;
  const s = bossStand(a); Object.assign(boss, { state: 'nag', id, line: line || pick(BOSS_LINES), x: s.x, y: s.y, until: performance.now() + 60000 });
}
let bossP = null;
function updateBoss(t, dt) {
  if (!bossP) { bossP = makePerson('#2b2d42', 0, true); tag(bossP.root, 'boss', boss); bossP.root.visible = false; }
  const now = performance.now();
  if (boss.state === 'away') {
    while (boss.queue.length && !agents.has(boss.queue[0].id)) boss.queue.shift();
    if (!boss.queue.length) { bossP.root.visible = false; return; }
    const q = boss.queue.shift();
    Object.assign(boss, { id: q.id, line: q.line, x: BOSS_DOOR.x, y: BOSS_DOOR.y, state: 'in', hurry: !!q.hurry, hold: !!q.hold, lineAt: now });
  }
  const a = agents.get(boss.id);
  if (!a && boss.state !== 'out') boss.state = 'out';
  const speed = (boss.hurry ? 114 : 66) * dt;
  if (boss.state === 'in' || boss.state === 'out') {
    const dest = boss.state === 'in' ? bossStand(a) : BOSS_DOOR, dx = dest.x - boss.x, dy = dest.y - boss.y, dist = Math.hypot(dx, dy);
    if (dist <= speed) { boss.x = dest.x; boss.y = dest.y; if (boss.state === 'in') { boss.state = 'nag'; boss.until = now + 5500; } else { boss.state = 'away'; boss.hold = false; bossP.root.visible = false; return; } }
    else { boss.x += dx / dist * speed; boss.y += dy / dist * speed; boss.face = Math.atan2(dx, dy); }
  } else {
    const s = bossStand(a); boss.x = s.x; boss.y = s.y;
    if (boss.hold) { if (now - boss.lineAt > 3200) { boss.line = pick(BOSS_HURRY_LINES); boss.lineAt = now; } if (!(a.waiting > 0)) boss.hold = false; }
    if (!boss.hold && now > boss.until) boss.state = 'out';
  }
  const nag = boss.state === 'nag', w = wp(boss.x, boss.y);
  bossP.root.visible = true;
  poseOf(bossP, nag ? 'nag' : 'walk', t, 0);
  if (nag && a) { const dx = a.x - boss.x, dy = a.y - boss.y; bossP.root.rotation.y = Math.atan2(dx, dy); } else bossP.root.rotation.y = boss.face;
  bossP.root.position.set(w.x + hitShake(boss) + (nag ? Math.sin(t / 45) * 0.06 : 0), 0, w.z);
  lab('boss', 'tag boss', '老闆', w.x, 0.0, w.z, '-50%', '0%');
  if (nag && a) {
    lab('bossb', 'bub boss', esc(boss.line), w.x, 3.4, w.z, '-50%', '-100%').el.style.transform += ` translate(${Math.round(Math.sin(t / 35) * 1.5)}px,0)`;
    if (isSeated(a)) { const sy = ((t / 220) | 0) % 3; lab('sweat', 'say', '💦', a.p.root.position.x + 0.9, 3.0 + sy * 0.1, a.p.root.position.z); }
  }
}

// ---------- whip (click a person: pure fun, no effect on anything) ----------
const whipObjs = [];
const hitPoint = (kind, o) => (kind === 'helper' ? new THREE.Vector3(o.g.position.x, 1.2, o.g.position.z) : kind === 'boss' ? new THREE.Vector3(bossP.root.position.x, 1.6, bossP.root.position.z) : new THREE.Vector3(o.p.root.position.x, isSeated(o) ? 1.9 : 1.6, o.p.root.position.z));
function whipTarget(kind, o) {
  o.hitAt = performance.now(); o.hitLine = pick(HIT_LINES);
  whips.push({ kind, o, born: o.hitAt, mesh: null, burst: null }); if (whips.length > 6) { const w = whips.shift(); cleanWhip(w); }
}
function cleanWhip(w) { if (w.mesh) { scene.remove(w.mesh); w.mesh.geometry.dispose(); w.mesh = null; } if (w.burst) { scene.remove(w.burst); w.burst = null; } }
function updateWhips() {
  const now = performance.now(), DUR = 800;
  for (let i = whips.length - 1; i >= 0; i--) {
    const w = whips[i], age = now - w.born, alive = w.kind === 'helper' ? helpers.has(w.o.id) : w.kind === 'boss' || agents.has(w.o.id);
    if (age > DUR || !alive) { cleanWhip(w); whips.splice(i, 1); continue; }
    const c = hitPoint(w.kind, w.o), u = age / DUR, hand = c.clone().add(new THREE.Vector3(4.2, 5.2, 1.5));
    const back = c.clone().add(new THREE.Vector3(4.6, 7.4, 0)), hit = c.clone(), away = c.clone().add(new THREE.Vector3(3.4, 3.2, 1.2));
    let tip, ctrl;
    if (u < 0.35) { tip = back.clone().lerp(away, 1 - u / 0.35); ctrl = c.clone().add(new THREE.Vector3(5.4, 6.4, 1)); }
    else if (u < 0.5) { tip = back.clone().lerp(hit, (u - 0.35) / 0.15); ctrl = c.clone().add(new THREE.Vector3(2.4, 5, 1)); }
    else { tip = hit.clone().lerp(away, Math.max(0, Math.min(1, (u - 0.62) / 0.3))); ctrl = c.clone().add(new THREE.Vector3(2, 3, 1)); }
    if (w.mesh) { scene.remove(w.mesh); w.mesh.geometry.dispose(); }
    w.mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(hand, ctrl, tip), 16, 0.06, 5, false), M('#9c6b3c')); scene.add(w.mesh);
    if (u >= 0.5 && u < 0.78) {
      const p = (u - 0.5) / 0.28;
      if (!w.burst) { w.burst = new THREE.Group(); for (let k = 0; k < 8; k++) w.burst.add(new THREE.Mesh(G(0.18, 0.18, 0.18), B(k % 2 ? '#ffd166' : '#ffffff'))); w.burst.position.copy(hit); scene.add(w.burst); }
      w.burst.children.forEach((m, k) => { const ang = k * Math.PI / 4, r = 0.4 + p * 1.1; m.position.set(Math.cos(ang) * r, Math.sin(ang) * r, 0.3); });
      lab('crack' + i, 'say crack', '啪！', hit.x + 1.2, hit.y + 1.2 + p * 0.5, hit.z);
    } else if (w.burst) { scene.remove(w.burst); w.burst = null; }
  }
}

// click / hover
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
function pickAt(e) {
  const r = cv.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, camera);
  const roots = [...[...agents.values()].map((a) => a.p.root), ...[...helpers.values()].map((h) => h.g).filter((g) => g && g.visible), ...(bossP && bossP.root.visible ? [bossP.root] : [])];
  const hits = ray.intersectObjects(roots, true); return hits.length ? hits[0].object.userData.owner : null;
}
cv.addEventListener('click', (e) => {
  const o = pickAt(e); if (!o) return;
  if (o.kind === 'boss') { boss.line = '你敢鞭打老闆！？'; boss.until = Math.max(boss.until, performance.now() + 3000); boss.hitAt = performance.now(); return; }
  whipTarget(o.kind, o.o);
});
cv.addEventListener('mousemove', (e) => { cv.style.cursor = pickAt(e) ? 'pointer' : 'default'; });

// ---------- connection ----------
function connect() {
  const es = new EventSource('/events');
  es.onopen = () => (statusEl.textContent = '已連線');
  es.onerror = () => (statusEl.textContent = '連線中斷，重試中…');
  es.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === 'snapshot') { [...agents.keys(), ...helpers.keys()].forEach(removeAgent); msg.agents.forEach(upsert); }
    else if (msg.type === 'update') upsert(msg.agent);
    else if (msg.type === 'spend') addSpend(msg.id, msg.tokens);
    else if (msg.type === 'prompt') onPrompt(msg.id);
    else if (msg.type === 'waiting') onWaiting(msg.id, msg.n);
    else if (msg.type === 'remove') removeAgent(msg.id);
    statusEl.textContent = `已連線 · ${agents.size} 位員工` + (helpers.size ? ` · ${helpers.size} 位小助手` : '');
  };
}
connect();

// ---------- main loop ----------
buildRoom();
const emptyEl = document.createElement('div'); emptyEl.id = 'empty'; emptyEl.textContent = '辦公室沒人… 等待 Claude 上班'; ov.appendChild(emptyEl);
let last = performance.now();
function frame() {
  const t = performance.now(), dt = Math.min(0.05, (t - last) / 1000); last = t;
  used = new Set();
  const d = new Date(); dynamic.clockMin.rotation.z = -(d.getMinutes() + d.getSeconds() / 60) / 60 * Math.PI * 2; dynamic.clockHour.rotation.z = -((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2;
  const all = [...agents.values()];
  const opSsh = all.find((o) => o.state === 'coding' && o.activity === 'ssh'), opDb = all.find((o) => o.state === 'coding' && o.activity === 'db');
  dynamic.rackLeds.forEach((l, k) => { const on = opSsh ? ((t / (120 + k * 50)) | 0) % 2 : k === 0; l.material = B(on ? '#5dff9b' : '#2a7a4d'); });
  dynamic.dbTop.material = M(opDb ? (((t / 250) | 0) % 2 ? '#ffd166' : '#e9b949') : '#a9c8f0');
  const busy = all.some((o) => o.state === 'coding' && (o.activity === 'push' || o.activity === 'pull')), glow = busy && ((t / 200) | 0) % 2;
  dynamic.cloud.forEach((s) => { s.material = M(glow ? '#ffffff' : '#eaf2ff', glow ? { emissive: new THREE.Color('#9db4ff') } : null); });
  dynamic.flag.rotation.z = all.some((o) => o.state === 'coding' && o.activity === 'pr') ? -0.9 : 0;
  DESKS.forEach((dk, i) => drawScreen(i, all.find((o) => o.desk === i), t));
  all.forEach((a) => updateAgent(a, t, dt));
  updateHelpers(t); updateBoss(t, dt); updateWhips(); updateFloats();
  (window.__labels || []).forEach((l) => lab(l.k, 'tag sign', l.t, l.p[0], l.p[1], l.p[2]));
  lab('sRack', 'tag sign' + (opSsh ? ' hot' : ''), esc(opSsh && opSsh.target ? opSsh.target : '伺服器'), 15.9, 1.55, FLOOR_Z0 + 0.9);
  lab('sDb', 'tag sign' + (opDb ? ' hot' : ''), esc(opDb && opDb.target ? opDb.target : '資料庫'), 30.8, 2.3, 15.8);
  emptyEl.style.display = agents.size ? 'none' : '';
  for (const [k, e] of uiEls) if (!used.has(k)) { e.el.remove(); uiEls.delete(k); }
  if (!window.__noRender) renderer.render(scene, camera);   // tests skip drawing (software WebGL is slow)
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__po = {
  agents, helpers, DESKS, boss, BOSS_HURRY_LINES, updateBoss: (t, dt) => updateBoss(t, dt || 0.016), onPrompt, onWaiting, bossShowNow, whipAgent: (id) => { const a = agents.get(id); if (a) whipTarget('agent', a); },
  placeAll() {   // test hook (tests/preview.js): snap people to where they would be in steady state
    agents.forEach((a) => { const d = DESKS[a.desk];
      if (a.state !== 'idle' && !(a.state === 'coding' && a.activity === 'pr')) { a.x = d.x + 22; a.y = d.y + 30; }
      else if (a.activity === 'pr') { a.x = 288; a.y = 98; }
      else { a.x = 262 + (a.desk % 3) * 10; a.y = 150; a.tx = a.x; a.ty = a.y; a.wander = 1e12; } });
    helpers.forEach((h) => { h.born = -9999; });
  },
};
})();
