// Adds / removes the Pixel Office hooks in a Claude Code settings.json. Used by install.ps1.
//   node tools/settings-hooks.js <install|uninstall> <settingsPath> <sendJsPath>
// Prints ONE line of JSON: {"ok":true,"changed":bool,"added":[...],"replaced":n,"removed":n,"backup":path|null,"otherInstalls":n}
// or {"ok":false,"error":"..."} (exit code 2) - in which case NOTHING was changed.
//
// Safety: strict JSON parse (so nothing is guessed), the user's own hooks and settings are never touched,
// a timestamped backup is written before any change, the result is re-read to verify, and the backup is
// restored if verification fails. Running it twice changes nothing the second time.
const fs = require('fs');
const path = require('path');

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd', 'SubagentStart', 'SubagentStop'];
const [mode, settingsPath, sendJsArg] = process.argv.slice(2);

const done = (o, code) => { console.log(JSON.stringify(o)); process.exit(code || 0); };
const fail = (error) => done({ ok: false, error }, 2);
if (!['install', 'uninstall'].includes(mode) || !settingsPath || !sendJsArg) fail('usage: settings-hooks.js <install|uninstall> <settingsPath> <sendJsPath>');

const sendJs = path.resolve(sendJsArg);
const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
const mine = norm(sendJs);
const command = `node "${sendJs.replace(/\\/g, '/')}"`;
const SCRIPT_RE = /node\s+"?([^"]*[\\/]hook[\\/]send\.js)"?/i;

// 'current' = points at THIS folder's send.js; 'stale' = a hook/send.js that no longer exists (e.g. folder moved);
// 'other-install' = another working copy of Pixel Office elsewhere; 'other' = not ours (never touched).
function classify(cmd) {
  const m = SCRIPT_RE.exec(String(cmd || ''));
  if (!m) return 'other';
  if (norm(m[1]) === mine) return 'current';
  try { return /pixel office/i.test(fs.readFileSync(m[1], 'utf8').slice(0, 400)) ? 'other-install' : 'other'; }
  catch { return 'stale'; }
}

let raw = '', existed = fs.existsSync(settingsPath), settings = {};
if (existed) {
  try { raw = fs.readFileSync(settingsPath, 'utf8').replace(/^﻿/, ''); } catch (e) { fail('cannot read settings file: ' + e.message); }
  if (raw.trim()) {
    try { settings = JSON.parse(raw); } catch { fail('settings file is not strict JSON (comments or trailing commas?) - nothing was changed'); }
  }
}
if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) fail('settings file is not a JSON object - nothing was changed');
if (settings.hooks !== undefined && (settings.hooks === null || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks))) fail('"hooks" in the settings file has an unexpected shape - nothing was changed');

const before = JSON.stringify(settings);
const added = [];
let replaced = 0, removed = 0, otherInstalls = 0;

if (mode === 'install') {
  settings.hooks = settings.hooks || {};
  for (const ev of EVENTS) {
    if (settings.hooks[ev] === undefined) settings.hooks[ev] = [];
    if (!Array.isArray(settings.hooks[ev])) fail(`hooks.${ev} has an unexpected shape - nothing was changed`);
    let has = false;
    for (const entry of settings.hooks[ev]) {
      for (const h of (entry && Array.isArray(entry.hooks) ? entry.hooks : [])) {
        if (!h || h.type !== 'command') continue;
        const c = classify(h.command);
        if (c === 'current') has = true;
        else if (c === 'stale') { h.command = command; has = true; replaced++; }
        else if (c === 'other-install') otherInstalls++;
      }
    }
    if (!has) { settings.hooks[ev].push({ hooks: [{ type: 'command', command }] }); added.push(ev); }
  }
} else if (settings.hooks) {
  for (const ev of Object.keys(settings.hooks)) {
    if (!Array.isArray(settings.hooks[ev])) continue;
    settings.hooks[ev] = settings.hooks[ev].filter((entry) => {
      if (!entry || !Array.isArray(entry.hooks)) return true;
      const keep = entry.hooks.filter((h) => !(h && h.type === 'command' && classify(h.command) === 'current'));
      removed += entry.hooks.length - keep.length;
      entry.hooks = keep;
      return keep.length > 0;                       // drop an entry only if it contained nothing but our hook
    });
    if (settings.hooks[ev].length === 0) delete settings.hooks[ev];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

if (JSON.stringify(settings) === before) done({ ok: true, changed: false, added, replaced, removed, backup: null, otherInstalls });

let backup = null;
try {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  if (existed) {
    const t = new Date(), p = (n) => String(n).padStart(2, '0');
    backup = `${settingsPath}.pixel-office-backup-${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
    fs.copyFileSync(settingsPath, backup);
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  JSON.parse(fs.readFileSync(settingsPath, 'utf8'));            // verify it is still valid JSON
} catch (e) {
  try { if (backup) fs.copyFileSync(backup, settingsPath); } catch {}
  fail('writing the settings file failed, original restored: ' + e.message);
}
done({ ok: true, changed: true, added, replaced, removed, backup, otherInstalls });
