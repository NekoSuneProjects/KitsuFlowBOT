'use strict';
const key = encodeURIComponent(location.pathname.split('/').pop());
let after = null,
  busy = false,
  settings = null;
const queue = [];
const label = {
  follow: 'just followed!',
  subscription: 'just subscribed!',
  subscription_renewal: 'resubscribed!',
  subscription_gift: 'gifted subscriptions!',
  cheer: 'cheered Bits!',
  kicks: 'sent Kicks!',
  raid: 'raided the stream!',
  donation: 'sent a donation!',
  membership: 'became a member!',
  membership_update: 'updated their membership!',
  membership_end: 'membership ended',
  purchase: 'made a purchase!'
};
const box = document.getElementById('alert');
function play() {
  if (busy || !queue.length) return;
  busy = true;
  const e = queue.shift();
  box.style.setProperty('--accent', settings.accent);
  box.style.setProperty('--bg', settings.transparent ? 'transparent' : settings.background);
  box.style.color = settings.text_color;
  document.getElementById('title').textContent = settings.title;
  document.getElementById('headline').textContent =
    (e.actor || 'A supporter') + ' ' + (label[e.event_type] || e.event_type);
  document.getElementById('platform').textContent = e.platform;
  document.getElementById('details').textContent = settings.show_amount
    ? e.detail || e.event_type
    : e.event_type;
  box.classList.add('show');
  setTimeout(() => {
    box.classList.remove('show');
    setTimeout(() => {
      busy = false;
      play();
    }, 450);
  }, settings.duration_ms);
}
async function poll() {
  try {
    const r = await fetch('/api/stream-alerts/public/' + key + '?after=' + (after ?? 0), {
      cache: 'no-store'
    });
    if (!r.ok) throw Error('HTTP ' + r.status);
    const d = await r.json();
    settings = d;
    if (after === null) {
      after = d.latest;
      return;
    }
    for (const e of d.events || [])
      if (e.id > after) {
        after = e.id;
        if (queue.length < 30) queue.push(e);
      }
    after = Math.max(after, d.events?.length ? d.events[d.events.length - 1].id : after);
    play();
  } catch (e) {
    console.warn('Alert feed unavailable', e.message);
  }
}
poll();
setInterval(poll, 1400);
