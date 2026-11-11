// Procedurally generated pixel characters (16x24 standing, 16x20 seated from behind),
// auto-outlined. Each office worker gets a distinct hair style / hair colour / skin tone / outfit.
// To use real art later, replace getSprite() so it returns a canvas/image per (name, frame, color, look, flip).
const HAIRS = ['#3a2e39', '#7a4a2a', '#1d1d1d', '#d4a72c', '#8e3b2e', '#5a5f8a'];
const SKINS = ['#f2cc8f', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#f1c27d'];
const OUT = [0x1d, 0x1a, 0x2b];
const cache = new Map();

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return '#' + [c(n >> 16), c((n >> 8) & 255), c(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function head(r, look, blink, dy, back) {
  const hair = HAIRS[look % 6], skin = SKINS[(look * 5 + 2) % 6], hl = shade(hair, 1.45), hd = shade(hair, 0.75);
  const style = look % 6, y = 1 + dy;
  if (back) {                                     // seen from behind: all hair
    r(3, y - 1, 10, 9, hair); r(4, y, 8, 1, hair); r(5, y, 4, 1, hl); r(3, y + 6, 10, 2, hd);
    r(2, y + 4, 1, 2, skin); r(13, y + 4, 1, 2, skin);
    if (style === 2) { r(2, y + 3, 2, 9, hair); r(12, y + 3, 2, 9, hair); }
    if (style === 4) { r(12, y + 4, 3, 5, hair); r(13, y + 9, 2, 2, hd); }
    if (style === 5) { r(6, y - 3, 4, 3, hair); r(7, y - 3, 2, 1, hl); }
    if (style === 3) { r(4, y - 2, 2, 1, hair); r(7, y - 2, 2, 1, hair); r(10, y - 2, 2, 1, hair); }
    r(6, y + 8, 4, 2, shade(skin, 0.85));         // neck
    return;
  }
  r(6, y + 9, 4, 1, shade(skin, 0.85));           // neck
  r(4, y + 3, 8, 6, skin);                        // face
  r(4, y + 8, 8, 1, shade(skin, 0.92));
  if (style === 2) { r(2, y + 3, 2, 9, hair); r(12, y + 3, 2, 9, hair); }
  if (style === 4) { r(12, y + 3, 2, 6, hair); r(13, y + 8, 2, 2, hd); }
  r(3, y, 10, 4, hair); r(4, y - 1, 8, 1, hair);  // hair cap
  r(5, y, 4, 1, hl);
  r(3, y + 3, 1, 3, hair); r(12, y + 3, 1, 3, hair);
  if (style === 0) r(4, y + 3, 4, 1, hair);       // fringe
  if (style === 1) { r(4, y + 3, 7, 1, hair); r(4, y + 4, 2, 1, hair); }
  if (style === 3) { r(4, y - 2, 2, 1, hair); r(7, y - 2, 2, 1, hair); r(10, y - 2, 2, 1, hair); }
  if (style === 5) { r(6, y - 3, 4, 3, hair); r(7, y - 3, 2, 1, hl); }
  r(5, y + 5 + (blink ? 1 : 0), 2, blink ? 1 : 2, '#22223b');   // eyes
  r(9, y + 5 + (blink ? 1 : 0), 2, blink ? 1 : 2, '#22223b');
  r(4, y + 7, 1, 1, '#f08a8a'); r(11, y + 7, 1, 1, '#f08a8a'); // cheeks
  r(7, y + 8, 2, 1, shade(skin, 0.7));                          // mouth
}

function front(r, o) {
  const body = o.color, bd = shade(body, 0.78), bl = shade(body, 1.22);
  const skin = SKINS[(o.look * 5 + 2) % 6], pants = '#33385c', pd = '#272b48', shoe = '#2a2433';
  const dy = -(o.bob || 0), lift = o.lift;
  const leg = (x, lifted) => {
    const l = lifted ? 1 : 0;
    r(x, 18 - l, 3, 4, pants); r(x + 2, 18 - l, 1, 4, pd);
    r(x - 1, 22 - l, 4, 2 - l, shoe); r(x, 22 - l, 3, 1, shade(shoe, 1.5));
  };
  leg(5, lift === 'L'); leg(8, lift === 'R');
  r(4, 11 + dy, 8, 7, body); r(10, 11 + dy, 2, 7, bd); r(4, 11 + dy, 8, 1, bl); r(7, 11 + dy, 2, 2, '#f4f1ea'); // torso + collar
  r(4, 17 + dy, 8, 1, '#4a3b2f'); r(7, 17 + dy, 2, 1, '#d4b24a');                                               // belt
  const sw = o.swing || 0;
  r(2, 12 + dy + (sw > 0 ? 1 : 0), 2, 6, body); r(12, 12 + dy + (sw < 0 ? 1 : 0), 2, 6, bd);
  r(2, 18 + dy + (sw > 0 ? 1 : 0), 2, 2, skin); r(12, 18 + dy + (sw < 0 ? 1 : 0), 2, 2, skin);
  head(r, o.look, o.blink, dy, false);
}

function back(r, o) {
  const body = o.color, bd = shade(body, 0.78), bl = shade(body, 1.22), skin = SKINS[(o.look * 5 + 2) % 6];
  r(3, 10, 10, 8, body); r(3, 10, 10, 1, bl); r(7, 11, 2, 7, bd); r(11, 11, 2, 7, bd);   // torso from behind
  head(r, o.look, false, o.headDy || 0, true);
  if (o.pose === 'wave') {                        // right arm up, waving
    r(1, 12, 2, 6, body); r(1, 18, 2, 2, skin);
    r(13, 4, 2, 8, body); r(13 + (o.f ? 1 : 0), 1, 2, 3, skin);
  } else if (o.pose === 'think') {                // hand on head
    r(1, 12, 2, 6, body); r(1, 18, 2, 2, skin);
    r(12, 5, 2, 8, body); r(11 + (o.f ? 1 : 0), 3, 2, 2, skin);
  } else if (o.pose === 'type') {                 // hands alternate on keyboard
    r(2, 12, 2, 6, body); r(2 + (o.f ? 1 : 0), 18, 2, 2, skin);
    r(12, 12, 2, 6, bd); r(12 - (o.f ? 0 : 1), 18, 2, 2, skin);
  } else {                                        // sit: hands resting
    r(2, 12, 2, 6, body); r(2, 18, 2, 2, skin); r(12, 12, 2, 6, bd); r(12, 18, 2, 2, skin);
  }
}

function applyOutline(g, W, H) {
  const d = g.getImageData(0, 0, W, H), a = d.data, out = new Uint8ClampedArray(a);
  const op = (x, y) => x >= 0 && y >= 0 && x < W && y < H && a[(y * W + x) * 4 + 3] > 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!op(x, y) && (op(x - 1, y) || op(x + 1, y) || op(x, y - 1) || op(x, y + 1))) {
      const i = (y * W + x) * 4; out[i] = OUT[0]; out[i + 1] = OUT[1]; out[i + 2] = OUT[2]; out[i + 3] = 255;
    }
  }
  g.putImageData(new ImageData(out, W, H), 0, 0);
}

// Little robot assistant (a "subagent"): blinking antenna light, glowing eyes, arms typing.
function makeBot(frame, color) {
  const W = 14, H = 17;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x + 1, y + 1, w, h); };
  const f = frame % 2, metal = '#9fb4d9', metalHi = '#c4d2ee', metalDk = '#5a6a8a';
  r(5, 0, 2, 2, '#cfd6e6'); r(5, 0, 2, 1, f ? '#ff5d5d' : '#5dff9b');                 // antenna + light
  r(2, 2, 8, 6, metal); r(2, 2, 8, 1, metalHi); r(2, 7, 8, 1, shade(metal, 0.85));  // head
  r(4, 4, 1, 2, '#6ff0ff'); r(7, 4, 1, 2, '#6ff0ff'); r(5, 7, 2, 1, metalDk);       // eyes, mouth
  r(3, 8, 6, 5, color); r(8, 8, 1, 5, shade(color, 0.78)); r(3, 8, 6, 1, shade(color, 1.22)); r(5, 10, 2, 1, '#ffffff'); // body
  r(1, 9 + f, 2, 3, metal); r(9, 10 - f, 2, 3, metal);                                // arms (typing)
  r(3, 13, 2, 2, metalDk); r(7, 13, 2, 2, metalDk);                                   // feet
  applyOutline(g, W, H);
  g.globalCompositeOperation = 'destination-over'; g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(3, H - 2, 8, 2);
  return c;
}

// The boss: bald with grey side hair, angry brows, moustache, big round belly, red tie.
// nag=false: walking (4 frames). nag=true: wagging a finger with the mouth opening and closing (2 frames).
function makeBoss(nag, frame, flip) {
  const W = 22, H = 29;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x + 1, y + 1, w, h); };
  const skin = '#f0b98d', skinD = shade(skin, 0.88), suit = '#4a4e69', suitL = shade(suit, 1.35), suitD = shade(suit, 0.72), dark = '#2b2b2b', pants = '#2f3447', shoe = '#1d1a2b';
  const f = frame % 2, step = nag ? 0 : frame % 4, by = nag ? 0 : -(step % 2);
  const u = (x, y, w, h, col) => r(x, y + by, w, h, col);                  // upper body bobs while walking
  const lift = (i) => (!nag && ((step === 1 && i === 0) || (step === 3 && i === 1)) ? 1 : 0);
  r(5, 23, 4, 3 - lift(0), pants); r(11, 23, 4, 3 - lift(1), pants);        // legs
  r(4, 26 - lift(0), 5, 1, shoe); r(11, 26 - lift(1), 5, 1, shoe);          // shoes
  u(3, 11, 14, 1, suit); u(2, 12, 16, 4, suit);                             // shoulders + chest
  u(2, 16, 16, 1, suit); u(1, 17, 18, 4, suit); u(2, 21, 16, 1, suit); u(3, 22, 14, 1, suitD);   // the belly
  u(4, 17, 3, 2, suitL); u(12, 19, 5, 2, suitD);                            // belly shading
  u(8, 12, 4, 3, '#f4f1ea'); u(8, 16, 4, 5, '#f4f1ea'); u(9, 18, 1, 1, '#bbbbbb');   // shirt showing through
  u(9, 12, 2, 8, '#d62828'); u(10, 13, 1, 6, '#a81d1d');                    // tie
  if (nag) {                                                                // one arm up wagging a finger, one hand on the hip
    const wag = f ? 0 : 1;
    u(0, 6 + wag, 2, 7, suit); u(0, 4 + wag, 2, 2, skin); u(0, 3 + wag, 1, 1, skin);
    u(18, 12, 2, 5, suit); u(17, 16, 2, 2, skin);
  } else {
    const l = step === 0 ? 1 : 0, rr = step === 2 ? 1 : 0;
    u(0, 12 + l, 2, 8, suit); u(0, 20 + l, 2, 2, skin); u(18, 12 + rr, 2, 8, suit); u(18, 20 + rr, 2, 2, skin);
  }
  u(6, 1, 8, 1, skin); u(5, 2, 10, 1, skin); u(4, 3, 12, 5, skin); u(5, 8, 10, 1, skin); u(6, 9, 8, 1, skinD);   // bald head
  u(7, 2, 3, 1, '#fff1d6'); u(6, 3, 1, 1, '#fff1d6');                       // shine on the bald spot
  u(3, 4, 2, 3, '#8a8a8a'); u(15, 4, 2, 3, '#8a8a8a');                      // grey hair at the sides
  u(5, 4, 2, 1, dark); u(7, 5, 1, 1, dark); u(13, 4, 2, 1, dark); u(12, 5, 1, 1, dark);   // angry eyebrows
  u(6, 6, 2, 1, '#111111'); u(12, 6, 2, 1, '#111111'); u(9, 6, 2, 2, skinD);             // eyes, nose
  u(7, 8, 6, 1, '#555555');                                                 // moustache
  if (nag && f) { u(8, 9, 4, 2, '#7a1f1f'); u(9, 9, 2, 1, '#f4f1ea'); } else u(8, 9, 4, 1, '#7a1f1f');   // mouth
  u(8, 10, 4, 1, skinD);                                                    // neck
  if (nag) { u(17, 0, 1, 3, '#e63946'); u(16, 1, 3, 1, '#e63946'); }       // anger mark
  applyOutline(g, W, H);
  g.globalCompositeOperation = 'destination-over'; g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(3, H - 2, 16, 2);
  if (!flip) return c;
  const f2 = document.createElement('canvas'); f2.width = W; f2.height = H;
  const h2 = f2.getContext('2d'); h2.translate(W, 0); h2.scale(-1, 1); h2.drawImage(c, 0, 0);
  return f2;
}

function make(name, frame, color, look, flip) {
  if (name === 'boss' || name === 'bossnag') return makeBoss(name === 'bossnag', frame, flip);
  if (name === 'bot') return makeBot(frame, color);
  const tall = name === 'stand' || name === 'walk';
  const W = 18, H = tall ? 26 : 22;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x + 1, y + 1, w, h); }; // +1 = outline margin
  const o = { color, look, f: frame % 2 };
  if (name === 'stand') front(r, { ...o, blink: frame % 2 === 1 });
  else if (name === 'walk') {
    const f = frame % 4;
    front(r, { ...o, bob: f % 2 ? 1 : 0, lift: f === 1 ? 'L' : f === 3 ? 'R' : null, swing: f === 0 ? 1 : f === 2 ? -1 : 0 });
  } else back(r, { ...o, pose: name, headDy: name === 'type' && frame % 4 === 3 ? 1 : 0 });
  applyOutline(g, W, H);
  if (tall) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(3, H - 2, 12, 2); }
  if (!flip) return c;
  const f2 = document.createElement('canvas'); f2.width = W; f2.height = H;
  const h = f2.getContext('2d'); h.translate(W, 0); h.scale(-1, 1); h.drawImage(c, 0, 0);
  return f2;
}

function getSprite(name, frame, color, look, flip) {
  const key = `${name}|${frame}|${color}|${look}|${flip ? 1 : 0}`;
  let c = cache.get(key);
  if (!c) { c = make(name, frame, color, look, flip); cache.set(key, c); }
  return c;
}
