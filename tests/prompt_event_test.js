// The "prompt submitted" signal (drives the "got it!" hop and the boss).
// Proves the TEXT of the prompt never leaves the hook: only a boolean flag is relayed.
// Uses a fake home directory and a spare port. Run: node tests/prompt_event_test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'po-prompt-'));
fs.mkdirSync(path.join(fakeHome, '.claude', 'projects'), { recursive: true });
const PORT = 8891;
const srv = spawn('node', ['server/server.js'], { cwd: ROOT, env: { ...process.env, USERPROFILE: fakeHome, HOME: fakeHome, PORT: String(PORT), PIXEL_OFFICE_STATE: path.join(fakeHome, 'state.json') } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`);
const SECRET = 'SECRET-PROMPT-TEXT-xyz fix the production password';
const events = []; let rawStream = '';
const hook = (obj) => new Promise((res) => {
  const c = execFile('node', [path.join(ROOT, 'hook', 'send.js')], { env: { ...process.env, PIXEL_OFFICE_PORT: String(PORT) } }, () => res());
  c.stdin.end(JSON.stringify(obj));
});

(async () => {
  await sleep(1500);
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/events', headers: { Host: '127.0.0.1:' + PORT } }, (res) => {
    res.on('data', (c) => { rawStream += c; for (const l of String(c).split('\n')) if (l.startsWith('data: ')) { try { events.push(JSON.parse(l.slice(6))); } catch {} } });
  });
  await sleep(500);
  // Claude Code puts the user's text in the hook input as "prompt"
  await hook({ hook_event_name: 'UserPromptSubmit', session_id: 'p1', cwd: 'D:/x/proj', prompt: SECRET });
  await sleep(600);
  const prompts = events.filter((e) => e.type === 'prompt');
  check('submitting a prompt -> exactly one "prompt" event', prompts.length === 1 && prompts[0].id === 'p1', JSON.stringify(prompts));
  check('the person goes to "thinking" as before', events.some((e) => e.type === 'update' && e.agent.id === 'p1' && e.agent.state === 'thinking'));
  check('the prompt text appears NOWHERE in what the server sends', !rawStream.includes('SECRET-PROMPT') && !rawStream.includes('production password'));
  const before = events.filter((e) => e.type === 'prompt').length;
  await hook({ hook_event_name: 'PreToolUse', session_id: 'p1', cwd: 'D:/x/proj', tool_name: 'Edit', tool_input: { file_path: 'a.js' }, prompt: SECRET });
  await hook({ hook_event_name: 'Stop', session_id: 'p1', cwd: 'D:/x/proj', prompt: SECRET });
  await sleep(600);
  check('other events do not produce a "prompt" event', events.filter((e) => e.type === 'prompt').length === before);
  check('still no prompt text after other events', !rawStream.includes('SECRET-PROMPT'));
  req.destroy(); srv.kill();
  console.log(results.join('\n'));
  console.log(results.some((r) => r.startsWith('FAIL')) ? '\nSOME FAILED' : '\nALL PASSED');
  await sleep(300);
  fs.rmSync(fakeHome, { recursive: true, force: true });
})();
