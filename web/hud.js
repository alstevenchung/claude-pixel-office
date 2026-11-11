// HP/MP bars: remaining daily / weekly token budget, plus the model currently in use.
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(n));
function modelName(id) {
  if (!id) return '—';
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?/.exec(id);
  if (!m) return id;
  return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '');
}
function setBar(id, used, budget, label) {
  const el = document.getElementById(id), left = Math.max(0, budget - used), pct = budget ? (left / budget) * 100 : 0;
  const fill = el.querySelector('.fill');
  if (!el.dataset.init) { fill.style.transition = 'none'; el.dataset.init = '1'; requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.transition = ''; })); } // no animation on first paint
  fill.style.width = pct.toFixed(1) + '%';
  el.classList.toggle('low', pct < 20);
  document.getElementById(id + 'T').textContent = `${pct.toFixed(0)}% · 剩 ${fmt(left)} / ${fmt(budget)}`;
  el.title = `${label}已用 ${fmt(used)}（預算 ${fmt(budget)}）`;
}
async function refreshUsage() {
  try {
    const u = await (await fetch('/usage', { cache: 'no-store' })).json();
    window.sessionModels = u.sessions || {};
    setBar('hp', u.today.used, u.dailyBudget, '今日');
    setBar('mp', u.week.used, u.weeklyBudget, '近 7 天');
  } catch { /* server not ready; try again next tick */ }
}
// A spend event: shake the HP bar and refresh the numbers soon after (instead of waiting for the 10 s timer).
window.pulseHp = () => {
  const el = document.getElementById('hp');
  if (el) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
  clearTimeout(window._hpTimer); window._hpTimer = setTimeout(refreshUsage, 1500);
};
refreshUsage(); setInterval(refreshUsage, 10000);
