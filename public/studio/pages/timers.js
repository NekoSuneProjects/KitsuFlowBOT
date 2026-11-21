import { $, e, h, card, grid, actions, btn, input, form, table, editorSlot } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { engagement } from '../core/store.js';
import { reloadView } from '../core/router.js';

// Timed chat announcements.
function editTimer(item) {
  const pane = card('Edit timer: ' + item.name, 'Update its message, interval and enabled state.');
  const message = input('Announcement message', item.message, 'textarea');
  const minutes = input('Interval (minutes)', item.minutes, 'number');
  const enabled = input('Enabled', Boolean(item.enabled), 'checkbox');
  pane.append(
    grid('cols2', message.node, minutes.node, enabled.node),
    actions(
      btn(
        'Save changes',
        async () => {
          await api('/api/engagement/timer', 'POST', {
            name: item.name,
            message: message.value(),
            minutes: minutes.value(),
            enabled: enabled.value()
          });
          notify('Timer updated');
          await reloadView();
        },
        'primary'
      ),
      btn('Cancel', () => reloadView())
    )
  );
  return pane;
}
export function timers() {
  const rows = engagement.timers.map(x => [
    x.name,
    x.message,
    'Every ' + x.minutes + ' min',
    x.enabled ? 'Enabled' : 'Paused',
    actions(
      btn('Edit', () => {
        const target = $('#timer-editor');
        target.replaceChildren(editTimer(x));
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }),
      btn(
        'Delete',
        async () => {
          if (!confirm('Delete timer ' + x.name + '?')) return;
          await api('/api/engagement/timer/' + encodeURIComponent(x.name), 'DELETE');
          await reloadView();
        },
        'danger'
      )
    )
  ]);
  return h(
    'div',
    'stack',
    h(
      'div',
      'grid cols2',
      form(
        'Create chat timer',
        [
          ['name', 'Timer name'],
          ['message', 'Announcement message'],
          ['minutes', 'Interval (minutes)', 'number', 15]
        ],
        'Save timer',
        x => api('/api/engagement/timer', 'POST', x)
      ),
      h(
        'section',
        'card',
        e('h2', 'Current timers'),
        e(
          'p',
          'Timers post only while live and viewers have chatted in the past 10 minutes.',
          'description'
        ),
        table(['Name', 'Message', 'Interval', 'Status', 'Actions'], rows)
      )
    ),
    editorSlot('timer-editor')
  );
}
