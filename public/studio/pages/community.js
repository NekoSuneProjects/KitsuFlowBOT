import { e, h, wrap, actions, btn, form, table, list } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { creator, engagement } from '../core/store.js';
import { reloadView } from '../core/router.js';

// Loyalty, giveaways, stream store, viewer queue, quotes and counters.
export function loyalty() {
  return wrap(
    form(
      'Loyalty settings',
      [
        ['enabled', 'Enabled', 'checkbox', !!engagement.loyalty.enabled],
        [
          'points_per_interval',
          'Points per interval',
          'number',
          engagement.loyalty.points_per_interval
        ],
        ['interval_minutes', 'Interval minutes', 'number', engagement.loyalty.interval_minutes]
      ],
      'Save loyalty',
      x => api('/api/engagement/loyalty', 'POST', x)
    ),
    h(
      'section',
      'card',
      e('h2', 'Points leaderboard'),
      table(
        ['Viewer', 'Points', 'Estimated active minutes'],
        creator.leaderboard.map(x => [x.username, x.points, x.watch_minutes])
      )
    )
  );
}
export function campaigns() {
  return wrap(
    form(
      'New giveaway or contest',
      [
        ['title', 'Title'],
        ['kind', 'Type', 'options', ['giveaway', 'contest']],
        ['cost', 'Entry points', 'number', 0]
      ],
      'Create event',
      x => api('/api/creator/campaign', 'POST', x)
    ),
    h(
      'section',
      'card',
      e('h2', 'Events'),
      table(
        ['Title', 'Type', 'Status', 'Draw'],
        creator.campaigns.map(x => [
          x.title,
          x.kind,
          x.status,
          x.status === 'open'
            ? btn('Draw winner', async () => {
                const y = await api('/api/creator/campaign/draw', 'POST', { id: x.id });
                notify('Winner: ' + y.winner);
                await reloadView();
              })
            : x.winner || 'Closed'
        ])
      )
    )
  );
}
export function store() {
  return wrap(
    form(
      'New store reward',
      [
        ['title', 'Reward name'],
        ['cost', 'Points cost', 'number', 100],
        ['stock', 'Stock (-1 unlimited)', 'number', -1]
      ],
      'Create reward',
      x => api('/api/creator/store', 'POST', x)
    ),
    h(
      'section',
      'card',
      e('h2', 'Available rewards'),
      table(
        ['Reward', 'Cost', 'Stock'],
        creator.store.map(x => [x.title, x.cost, x.stock < 0 ? 'Unlimited' : x.stock])
      )
    ),
    h(
      'section',
      'card',
      e('h2', 'Redemption requests'),
      table(
        ['Viewer', 'Status', 'Manage'],
        creator.redemptions.map(x => [
          x.username,
          x.status,
          x.status === 'pending'
            ? actions(
                btn('Fulfill', async () => {
                  await api('/api/creator/redeem/resolve', 'POST', {
                    id: x.id,
                    status: 'fulfilled'
                  });
                  await reloadView();
                }),
                btn(
                  'Refund',
                  async () => {
                    await api('/api/creator/redeem/resolve', 'POST', {
                      id: x.id,
                      status: 'refunded'
                    });
                    await reloadView();
                  },
                  'danger'
                )
              )
            : 'Completed'
        ])
      )
    )
  );
}
export function queue() {
  return h(
    'section',
    'card',
    e('h2', 'Viewer Queue'),
    e('p', 'Viewers use !queue join or !queue leave in chat.', 'description'),
    actions(
      btn(
        'Call next viewer',
        async () => {
          const x = await api('/api/creator/queue/next', 'POST');
          notify(x.next ? 'Next: ' + x.next : 'Queue empty');
          await reloadView();
        },
        'primary'
      ),
      btn(
        'Clear queue',
        async () => {
          if (!confirm('Clear all viewers?')) return;
          await api('/api/creator/queue/clear', 'POST');
          await reloadView();
        },
        'danger'
      )
    ),
    table(
      ['Position', 'Viewer', 'Joined'],
      creator.queue.map((x, i) => [i + 1, x.username, x.added])
    )
  );
}
export function quotes() {
  return wrap(
    form('Save a quote', [['text', 'Quote text']], 'Add quote', x =>
      api('/api/engagement/quote', 'POST', x)
    ),
    form(
      'Configure counter',
      [
        ['name', 'Counter name'],
        ['value', 'Current count', 'number', 0]
      ],
      'Save counter',
      x => api('/api/engagement/counter', 'POST', x)
    ),
    h(
      'section',
      'card',
      e('h2', 'Quotes'),
      list(
        engagement.quotes,
        x => '#' + x.id + ' ' + x.text,
        x => api('/api/engagement/quote/' + x.id, 'DELETE')
      )
    ),
    h(
      'section',
      'card',
      e('h2', 'Counters'),
      list(
        engagement.counters,
        x => x.name + ' = ' + x.value,
        x => api('/api/engagement/counter/' + x.name, 'DELETE')
      )
    )
  );
}
