'use strict';
const key = encodeURIComponent(location.pathname.split('/').pop());
async function tick() {
  try {
    const r = await fetch('/api/stream-boss/public/' + key, { cache: 'no-store' });
    if (!r.ok) throw Error('HTTP ' + r.status);
    const s = await r.json();
    const b = document.getElementById('boss');
    b.classList.toggle('hidden', !s.enabled);
    b.style.setProperty('--accent', s.accent);
    b.style.setProperty('--bg', s.transparent ? 'transparent' : s.background);
    b.style.color = s.text_color;
    document.getElementById('title').textContent = s.title;
    document.getElementById('name').textContent = s.name;
    document.getElementById('wins').textContent = '👑 ' + s.wins;
    document.getElementById('fill').style.width = (100 * s.hp) / Math.max(1, s.max_hp) + '%';
    document.getElementById('values').textContent =
      s.hp.toLocaleString() + ' / ' + s.max_hp.toLocaleString() + ' HP';
  } catch (e) {
    console.warn('Stream Boss unavailable', e.message);
  }
}
tick();
setInterval(tick, 2000);
