'use strict';
const parts = location.pathname.split('/'),
  mode = parts[parts.length - 2],
  key = encodeURIComponent(parts[parts.length - 1]),
  clock = document.getElementById('clock'),
  rewardList = document.getElementById('rewards');
document.body.classList.toggle('compact', mode === 'compact');
if (mode === 'timer') {
  rewardList.classList.add('hidden');
}
if (mode === 'info') {
  clock.classList.add('hidden');
  document.getElementById('status').classList.add('hidden');
}
let current = null,
  fetched = Date.now();
const format = ms => {
  const n = Math.ceil(Math.max(0, ms) / 1000);
  return [Math.floor(n / 3600), Math.floor((n % 3600) / 60), n % 60]
    .map(x => String(x).padStart(2, '0'))
    .join(':');
};
function paint() {
  if (!current) return;
  const ms = current.remaining_ms - (current.running ? Date.now() - fetched : 0);
  clock.textContent = format(ms);
  document.getElementById('status').textContent = current.running && ms > 0 ? '● LIVE' : 'Ⅱ PAUSED';
}
async function refresh() {
  try {
    const r = await fetch('/api/subathon/rewards/' + key, { cache: 'no-store' });
    if (!r.ok) throw Error('HTTP ' + r.status);
    current = await r.json();
    fetched = Date.now();
    document.body.style.fontFamily = current.font + ',Arial,sans-serif';
    document.body.style.color = current.text_color;
    const panel = document.getElementById('panel');
    panel.style.setProperty('--accent', current.accent);
    panel.style.setProperty('--background', current.background);
    if (mode !== 'compact')
      panel.style.background = current.transparent ? 'transparent' : current.background;
    document.getElementById('title').textContent = current.title;
    rewardList.replaceChildren();
    for (const rule of current.rules || []) {
      const li = document.createElement('li');
      const label = document.createElement('span'),
        seconds = document.createElement('strong');
      label.textContent =
        rule.platform.toUpperCase() +
        ' · ' +
        rule.event_type.replaceAll('_', ' ') +
        (rule.per_unit ? ' / unit' : '');
      seconds.textContent = '+' + rule.seconds + 's';
      li.append(label, seconds);
      rewardList.append(li);
    }
    if (!rewardList.children.length && mode !== 'timer') {
      const li = document.createElement('li');
      li.textContent = 'No time rewards configured';
      rewardList.append(li);
    }
    paint();
  } catch (e) {
    console.warn('Subathon overlay unavailable', e.message);
  }
}
refresh();
setInterval(refresh, 2500);
setInterval(paint, 200);
