(function () {
  'use strict';
  const key = encodeURIComponent(location.pathname.split('/').pop()),
    wrap = document.getElementById('wrap'),
    clock = document.getElementById('clock'),
    status = document.getElementById('status'),
    title = document.getElementById('title'),
    events = document.getElementById('events');
  let data = null,
    at = Date.now();
  function format(ms) {
    const n = Math.ceil(Math.max(0, ms) / 1000),
      h = Math.floor(n / 3600),
      m = Math.floor((n % 3600) / 60),
      s = n % 60;
    return (
      String(h).padStart(2, '0') +
      ':' +
      String(m).padStart(2, '0') +
      ':' +
      String(s).padStart(2, '0')
    );
  }
  function paint() {
    if (!data) return;
    const ms = Math.max(0, data.remaining_ms - (data.running ? Date.now() - at : 0));
    clock.textContent = format(ms);
    status.textContent =
      data.running && ms > 0 ? '● LIVE SUBATHON' : ms === 0 ? 'TIMER ENDED' : 'Ⅱ PAUSED';
  }
  async function refresh() {
    try {
      const response = await fetch('/api/subathon/public/' + key, { cache: 'no-store' });
      if (!response.ok) throw Error('HTTP ' + response.status);
      data = await response.json();
      at = Date.now();
      wrap.style.background = data.transparent ? 'transparent' : data.background;
      wrap.style.borderColor = data.accent;
      wrap.style.color = data.text_color;
      document.body.style.fontFamily = data.font + ',Arial,sans-serif';
      title.textContent = data.title;
      clock.style.color = data.accent;
      events.style.display = data.show_events ? 'block' : 'none';
      const ev = data.last_event;
      events.textContent = ev
        ? ev.platform.toUpperCase() +
          ' · ' +
          ev.event_type.replaceAll('_', ' ') +
          ' · +' +
          ev.seconds +
          's'
        : '';
      paint();
    } catch (err) {
      status.textContent = 'Timer temporarily unavailable';
    }
  }
  setInterval(paint, 200);
  setInterval(refresh, 2000);
  refresh();
})();
