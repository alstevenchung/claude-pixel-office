// Tests tools/settings-hooks.js on throw-away copies of a settings file (your real settings are never touched).
// Run: node tests/installer_test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const helper = path.join(ROOT, 'tools', 'settings-hooks.js');
const sendJs = path.join(ROOT, 'hook', 'send.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'po-inst-'));
const run = (mode, file, send) => { const r = spawnSync('node', [helper, mode, file, send || sendJs], { encoding: 'utf8' }); return { ...JSON.parse(r.stdout.trim().split('\n').pop()), code: r.status }; };
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const results = [];
const check = (name, ok, detail) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// a settings file with someone else's stuff in it, including one of THEIR OWN hooks
const original = {
  model: 'opus', theme: 'dark',
  permissions: { allow: ['Bash(git status)'] },
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo their-own-hook' }] }], UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node C:/tools/notify.js' }] }] },
};
const f = path.join(tmp, 'settings.json');
fs.writeFileSync(f, JSON.stringify(original, null, 2));

let r = run('install', f);
check('install succeeds and changes the file', r.ok && r.changed);
check('adds hooks for all 9 events', r.added.length === 9 || (r.added.length === 9), 'added: ' + r.added.length);
check('made a backup that equals the original', r.backup && same(read(r.backup), original));
let s = read(f);
check('other settings untouched', s.model === 'opus' && s.theme === 'dark' && same(s.permissions, original.permissions));
check('their own PreToolUse hook is still there, unchanged', same(s.hooks.PreToolUse[0], original.hooks.PreToolUse[0]));
check('their own UserPromptSubmit hook is still there', same(s.hooks.UserPromptSubmit[0], original.hooks.UserPromptSubmit[0]));
check('our hook was ADDED next to theirs (not replacing)', s.hooks.PreToolUse.length === 2 && /hook\/send\.js/.test(s.hooks.PreToolUse[1].hooks[0].command));

// show exactly what changed
console.log('--- what the installer added (events -> command) ---');
for (const ev of Object.keys(s.hooks)) for (const e of s.hooks[ev]) for (const h of e.hooks) if (/send\.js/.test(h.command)) console.log(`  ${ev.padEnd(17)} ${h.command}`);
console.log('');

const mtime = fs.statSync(f).mtimeMs;
r = run('install', f);
check('second install changes nothing, makes no backup', r.ok && !r.changed && r.backup === null && fs.statSync(f).mtimeMs === mtime);

r = run('uninstall', f);
check('uninstall removes exactly our 9 hooks', r.ok && r.changed && r.removed === 9, 'removed ' + r.removed);
check('after uninstall the file equals the original again', same(read(f), original));

// fresh machine: no settings file at all
const f2 = path.join(tmp, 'new', 'settings.json');
r = run('install', f2);
check('no settings file yet: creates one (no backup needed)', r.ok && r.changed && r.backup === null && Object.keys(read(f2).hooks).length === 9);
r = run('uninstall', f2);
check('uninstall on that leaves an empty object, no leftover "hooks"', r.ok && same(read(f2), {}));

// invalid JSON: must refuse and leave the file alone
const f3 = path.join(tmp, 'broken.json');
const brokenText = '{\n  // a comment makes this non-strict JSON\n  "model": "opus",\n}\n';
fs.writeFileSync(f3, brokenText);
r = run('install', f3);
check('non-strict JSON: refuses (exit 2) and file is unchanged', !r.ok && r.code === 2 && fs.readFileSync(f3, 'utf8') === brokenText, r.error);

// moved folder: an old entry whose send.js no longer exists is replaced, not duplicated
const f4 = path.join(tmp, 'moved.json');
fs.writeFileSync(f4, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "C:/old/place/hook/send.js"' }] }] } }));
r = run('install', f4);
const stop = read(f4).hooks.Stop;
check('stale hook from a moved folder is replaced, not duplicated', r.replaced === 1 && stop.length === 1 && stop[0].hooks[0].command.includes(ROOT.replace(/\\/g, '/')), 'replaced ' + r.replaced);

// a DIFFERENT tool that also happens to have hook/send.js and still exists: never touched
const other = path.join(tmp, 'othertool', 'hook'); fs.mkdirSync(other, { recursive: true });
fs.writeFileSync(path.join(other, 'send.js'), '// some other tool entirely\n');
const f5 = path.join(tmp, 'other.json');
const theirs = { type: 'command', command: `node "${path.join(other, 'send.js').replace(/\\/g, '/')}"` };
fs.writeFileSync(f5, JSON.stringify({ hooks: { Stop: [{ hooks: [theirs] }] } }));
run('install', f5);
check("another tool's hook/send.js is left alone", same(read(f5).hooks.Stop[0].hooks[0], theirs) && read(f5).hooks.Stop.length === 2);
run('uninstall', f5);
check("uninstall does not remove the other tool's hook", same(read(f5).hooks.Stop, [{ hooks: [theirs] }]));

console.log(results.join('\n'));
console.log(results.some((x) => x.startsWith('FAIL')) ? '\nSOME FAILED' : '\nALL PASSED');
fs.rmSync(tmp, { recursive: true, force: true });
