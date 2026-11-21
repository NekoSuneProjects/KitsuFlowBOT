'use strict';
// Interactive overlay: shows !slap / !boop / !pat … events one at a time (GIF, text, optional sound).
const key = encodeURIComponent(location.pathname.split('/').pop());
const card = document.getElementById('card');
const gif = document.getElementById('gif');
const text = document.getElementById('text');
const queue = [];
let after = null,
  busy = false;

function play() {
  if (busy || !queue.length) return;
  busy = true;
  const e = queue.shift();
  gif.hidden = !e.gif;
  if (e.gif) gif.src = e.gif;
  else gif.removeAttribute('src');
  text.textContent = e.text;
  card.classList.add('show');
  if (e.sound) {
    const audio = new Audio(e.sound);
    audio.volume = Math.max(0, Math.min(1, Number(e.volume) || 0.3));
    audio.play().catch(() => {});
  }
  setTimeout(() => {
    card.classList.remove('show');
    gif.removeAttribute('src');
    setTimeout(() => {
      busy = false;
      play();
    }, 400);
  }, e.duration || 7500);
}

async function poll() {
  try {
    const res = await fetch('/api/interactive/public/' + key + '/overlay?after=' + (after ?? 0), {
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      // First poll only sets the starting point, so old events are not replayed on reload.
      if (after === null) after = data.latest;
      else
        for (const e of data.events) {
          after = Math.max(after, e.id);
          if (queue.length < 10) queue.push(e);
        }
      play();
    }
  } catch {
    // Network blips: try again on the next tick.
  }
  setTimeout(poll, 1500);
}
poll();
