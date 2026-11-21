import { e, h, card, grid, actions, btn, input } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { reloadView } from '../core/router.js';

// Creator goals.
export async function goals() {
  const data = await api('/api/creator-goals'),
    root = h('div', 'stack');
  const summary = card(
    'Creator goals',
    'Choose a target such as follows, subscriptions, gifted subscriptions, Bits, Kick Kicks, VPZone events or verified donations. Progress updates from real platform events. Completed goals remain visible.'
  );
  summary.append(
    e(
      'p',
      data.summary.active + ' active · ' + data.summary.completed + ' completed',
      'description'
    )
  );
  root.append(summary);
  const editor = card('Create a goal');
  const title = input('Goal title', 'Reach 50 new followers'),
    platform = input('Platform', '', 'select'),
    eventType = input('Event type', '', 'select'),
    target = input('Target', 50, 'number'),
    unit = input('Count as', '', 'select');
  for (const p of Object.keys(data.capabilities)) platform.el.add(new Option(p.toUpperCase(), p));
  for (const [v, label] of [
    ['events', 'Number of events'],
    ['amount', 'Amount or quantity (Bits, Kicks, donations)']
  ])
    unit.el.add(new Option(label, v));
  const update = () => {
    eventType.el.replaceChildren();
    for (const e of data.capabilities[platform.value()] || [])
      eventType.el.add(new Option(e.replaceAll('_', ' '), e));
  };
  platform.el.addEventListener('change', update);
  update();
  editor.append(
    grid('cols2', title.node, platform.node, eventType.node, target.node, unit.node),
    actions(
      btn(
        'Create goal',
        async () => {
          await api('/api/creator-goals', 'POST', {
            title: title.value(),
            platform: platform.value(),
            event_type: eventType.value(),
            target: Number(target.value()),
            unit: unit.value()
          });
          notify('New goal created');
          await reloadView();
        },
        'primary'
      )
    )
  );
  root.append(editor);
  const existing = card(
    'Goal progress and achievements',
    'Completed goals stay marked as completed until you reset or delete them.'
  );
  for (const g of data.goals) {
    const panel = card(
      g.title,
      (g.status === 'completed'
        ? '✓ Completed'
        : g.status === 'paused'
          ? 'Paused'
          : 'In progress') +
        ' · ' +
        g.platform.toUpperCase() +
        ' ' +
        g.event_type.replaceAll('_', ' ')
    );
    const percent = Math.min(100, Math.round((g.progress / g.target) * 100));
    const bar = e('progress');
    bar.value = g.progress;
    bar.max = g.target;
    bar.style.width = '100%';
    panel.append(
      e(
        'div',
        g.progress.toLocaleString() + ' / ' + g.target.toLocaleString() + ' (' + percent + '%)',
        'description'
      ),
      bar,
      actions(
        ...[
          ['pause', 'Pause'],
          ['resume', 'Resume'],
          ['complete', 'Mark completed'],
          ['reset', 'Reset'],
          ['delete', 'Delete']
        ]
          .filter(([action]) =>
            action === 'delete' || g.status === 'active' ? true : action !== 'pause'
          )
          .map(([action, label]) =>
            btn(label, async () => {
              if (action === 'delete' && !confirm('Delete ' + g.title + '?')) return;
              await api('/api/creator-goals/' + g.id, 'POST', { action });
              await reloadView();
            })
          )
      )
    );
    existing.append(panel);
  }
  if (!data.goals.length) existing.append(e('p', 'No goals created yet.', 'description'));
  root.append(existing);
  return root;
}
