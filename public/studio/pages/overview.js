import { e, h, card, wrap, grid, actions, btn, table, stat, banner } from '../core/dom.js';
import { api } from '../core/api.js';
import { state, creator } from '../core/store.js';
import { show } from '../core/router.js';

// Overview dashboard and the Data & Reports stat tiles.
export async function overview() {
  const v = e('div', undefined, 'stack');
  const goalData = await api('/api/creator-goals').catch(() => null);
  if (goalData) {
    const goalBox = card(
      'Creator goals · achievements',
      'Track your active goals and completed milestones from follows, subs, Bits, Kicks and donation events.'
    );
    goalBox.append(
      e(
        'p',
        goalData.summary.active + ' active goals · ' + goalData.summary.completed + ' completed',
        'description'
      )
    );
    for (const g of goalData.goals.slice(0, 8)) {
      const row = h(
        'div',
        'list-row',
        h(
          'div',
          '',
          e('strong', (g.status === 'completed' ? '✓ ' : '') + g.title),
          e(
            'div',
            g.platform.toUpperCase() +
              ' · ' +
              g.event_type.replaceAll('_', ' ') +
              ' · ' +
              g.progress +
              ' / ' +
              g.target,
            'tiny'
          )
        ),
        e(
          'strong',
          g.status === 'completed' ? 'Completed' : Math.round((100 * g.progress) / g.target) + '%'
        )
      );
      goalBox.append(row);
    }
    goalBox.append(actions(btn('Manage creator goals', () => show('goals'), 'primary')));
    v.append(goalBox);
  }
  v.append(
    grid(
      'stats',
      stat('Loyalty members', creator.stats.members, '♙', 'Active chat participants'),
      stat('Points in circulation', creator.stats.points.toLocaleString(), '✧', 'Current balances'),
      stat('Store redemptions', creator.stats.redemptions, '▣', 'All-time requests'),
      stat('Active commands', state.commands.length, '⌘', 'Available in this channel')
    )
  );
  if (!state.channel.enabled)
    v.append(
      banner(
        'Your channel bot is currently disabled',
        'Enable the bot to start receiving channel chat and responding to commands.',
        btn('Channel settings →', () => show('connections'), 'primary')
      )
    );
  v.append(
    wrap(
      h(
        'section',
        'card',
        e('h2', 'Recent activity'),
        table(
          ['When', 'Event', 'Details'],
          creator.activity.slice(0, 8).map(x => [x.created, x.event, x.detail])
        ),
        actions(btn('View activity feed', () => show('activity')))
      ),
      h(
        'section',
        'card',
        e('h2', 'Channel health'),
        h('div', 'list-row', e('span', 'Streamer account'), e('strong', 'Connected')),
        h(
          'div',
          'list-row',
          e('span', 'Shared Twitch bot'),
          e('strong', state.bot ? '@' + state.bot.login : 'Not linked')
        ),
        h(
          'div',
          'list-row',
          e('span', 'Bot enabled'),
          e('strong', state.channel.enabled ? 'Yes' : 'No')
        ),
        h('div', 'list-row', e('span', 'Your access'), e('strong', state.role))
      )
    )
  );
  return v;
}
export function reports() {
  return grid(
    'stats',
    stat('Total members', creator.stats.members, '♙', 'Chat-based activity'),
    stat('Loyalty points', creator.stats.points, '✧', 'Current issued balances'),
    stat('Redemptions', creator.stats.redemptions, '▣', 'Store requests'),
    stat('Queue', creator.queue.length, '☷', 'Waiting viewers')
  );
}
