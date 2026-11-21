import { $, e, table } from './core/dom.js';
import { api, error } from './core/api.js';
import { page } from './core/store.js';
import { load, reloadView, popup } from './core/router.js';

// KitsuFlowBOT Studio entry point (loaded by dashboard.html as an ES module).
$('#profile').onclick = popup;
$('#side-channel').onclick = popup;
$('#refresh').onclick = error(reloadView);
// Live dashboard activity refresh while the Activity Feed page is displayed.
let lastActivitySignature = '';
async function refreshActivity() {
  try {
    if (page === 'activity') {
      const events = await api('/api/stream-activity');
      const signature = JSON.stringify(events);
      if (signature !== lastActivitySignature) {
        lastActivitySignature = signature;
        const container = document.querySelector('#view .card');
        if (container) {
          const old = container.querySelector('table,.empty');
          const replacement = events.length
            ? table(
                ['When', 'Platform', 'Event', 'Viewer', 'Details'],
                events.map(x => [
                  x.created,
                  x.platform.toUpperCase(),
                  x.event_type.replaceAll('_', ' '),
                  x.actor || '—',
                  x.detail || '—'
                ])
              )
            : e('div', 'No stream engagement events received yet.', 'empty');
          if (old) old.replaceWith(replacement);
          else container.append(replacement);
        }
      }
    }
  } catch (err) {
    console.warn('Activity refresh:', err.message);
  }
  setTimeout(refreshActivity, 1800);
}
setTimeout(refreshActivity, 1800);
fetch('/api/build-info', { cache: 'no-store' })
  .then(r => r.json())
  .then(info => {
    const el = $('#studio-version');
    if (el) el.textContent = 'Studio · ' + String(info.version).slice(0, 12);
  })
  .catch(() => {});
load();
