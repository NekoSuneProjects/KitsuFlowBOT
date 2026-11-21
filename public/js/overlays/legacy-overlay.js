const key = location.pathname.split('/').pop(),
  root = document.querySelector('#app');
async function update() {
  try {
    const r = await fetch('/api/overlay/' + encodeURIComponent(key), { cache: 'no-store' });
    if (!r.ok) return;
    const x = await r.json();
    const items =
      x.kind === 'leaderboard'
        ? x.leaders.map((v, i) => '#' + (i + 1) + ' ' + v.username + ' — ' + v.points + ' points')
        : x.kind === 'queue'
          ? x.queue.map((v, i) => i + 1 + '. ' + v.username)
          : x.events.map(v => v.message);
    root.replaceChildren();
    for (const value of items.slice(0, 10)) {
      const e = document.createElement('div');
      e.className = 'row';
      e.textContent = value;
      root.append(e);
    }
  } catch (e) {
    console.error(e);
  }
}
update();
setInterval(update, 5000);
