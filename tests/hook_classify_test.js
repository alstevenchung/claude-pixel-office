// Hook test: classifies shell commands (git / gh / ssh / database / container), checks the HOST NAME is the only
// detail that leaves the machine, and that the person's name is the project root even when cwd is a subfolder.
// Run: node tests/hook_classify_test.js
const ROOT = require('path').join(__dirname, '..');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
// [command, expected activity, expected target]
const cases = [
  ['git status', 'git', ''], ['git add -A', 'git', ''],
  ['git commit -m "fix: push the button"', 'commit', ''],
  ['git -C D:/x commit -m wip', 'commit', ''],
  ['git add . && git commit -m "x" && git push origin main', 'push', ''],
  ['git pull --rebase', 'pull', ''], ['git clone https://example.com/a.git', 'pull', ''],
  ['git merge feature', 'merge', ''],
  ['gh pr create --title "t" --body "b"', 'pr', ''],
  ['git push -u origin feat && gh pr create --fill', 'pr', ''],
  ['gh pr merge 12 --squash', 'merge', ''], ['gh issue list', 'gh', ''],
  ['echo "git push" > note.txt', '', ''], ['npm run build', '', ''], ['ls -la', '', ''],
  ['git commit -m "a && git push"', 'commit', ''],
  // ssh / copy
  ['ssh user@web01.example.com', 'ssh', 'web01.example.com'],
  ['ssh -p 2222 -i ~/.ssh/k deploy@10.0.0.5 "sudo systemctl restart app"', 'ssh', '10.0.0.5'],
  ['scp ./a.txt root@backup01:/data/', 'ssh', 'backup01'],
  ['rsync -av dist/ deploy@web02:/var/www/', 'ssh', 'web02'],
  ['scp C:\\x\\a.txt D:\\y', '', ''],
  ['git add . && ssh deploy@web03 ./deploy.sh', 'ssh', 'web03'],
  ['git push && mysql -h x', 'push', ''],
  // databases
  ['mysql -h db-prod -u root -pSECRETPW mydb', 'db', 'db-prod'],
  ['mysql -u root -p mydb', 'db', '本機'],
  ['psql postgres://admin:pa55word@pg01.internal:5432/app', 'db', 'pg01.internal'],
  ['psql -h pg02 -U me -d app', 'db', 'pg02'],
  ['sqlcmd -S tcp:sql01,1433 -U sa -P Secret123 -Q "select * from users"', 'db', 'sql01'],
  ['sqlcmd -S .\\SQLEXPRESS -d x', 'db', '本機'],
  ['mongosh "mongodb+srv://u:p4ss@cluster0.abc.mongodb.net/test"', 'db', 'cluster0.abc.mongodb.net'],
  ['redis-cli -h cache01 ping', 'db', 'cache01'],
  ['sqlite3 data/app.db .tables', 'db', 'app.db'],
  ['PGPASSWORD=hunter2 pg_dump -h pg03 mydb > out.sql', 'db', 'pg03'],
  // containers
  ['docker ps', 'container', ''], ['docker compose up -d', 'container', ''],
  ['kubectl --context prod-east get pods', 'container', 'prod-east'],
];
const SECRETS = ['SECRETPW', 'pa55word', 'Secret123', 'p4ss', 'hunter2', 'admin', 'root', 'deploy@', '2222', 'select * from', 'systemctl', 'id_rsa', '.ssh'];
const got = [];
const srv = http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)).on('end', () => { got.push(b); r.writeHead(204).end(); }); })
  .listen(8798, '127.0.0.1', async () => {
    for (const [cmd] of cases) {
      await new Promise((res) => {
        const c = execFile('node', ['hook/send.js'], { cwd: ROOT, env: { ...process.env, PIXEL_OFFICE_PORT: '8798', CLAUDE_PROJECT_DIR: 'D:/work/MyProject' } }, res);
        c.stdin.end(JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's', cwd: 'D:/work/MyProject/e2e', tool_name: 'Bash', tool_input: { command: cmd, description: 'desc' } }));
      });
    }
    srv.close();
    let fail = 0;
    cases.forEach(([cmd, wantA, wantT], i) => {
      const j = JSON.parse(got[i] || '{}');
      const a = j.activity || '', t = j.target || '';
      const ok = a === wantA && t === wantT; if (!ok) fail++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(cmd).slice(0, 70).padEnd(72)} -> ${a || '(none)'}${t ? ' @ ' + t : ''}${ok ? '' : `   want ${wantA || '(none)'}${wantT ? ' @ ' + wantT : ''}`}`);
    });
    const all = got.join('\n');
    const leaked = SECRETS.filter((x) => all.includes(x));
    console.log(leaked.length ? 'FAIL  leaked into payloads: ' + leaked.join(', ') : 'PASS  no secrets / command text in any payload');
    const names = new Set(got.map((b) => JSON.parse(b).name));
    console.log(names.size === 1 && names.has('MyProject') ? 'PASS  name is the project root even when cwd is a subfolder' : 'FAIL  names: ' + [...names].join(','));
    console.log('sample:', got[cases.findIndex((c) => c[0].startsWith('mysql -h db-prod'))]);
    console.log(fail || leaked.length || names.size !== 1 ? '\nSOME FAILED' : '\nALL PASSED');
  });
