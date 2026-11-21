import { e, h, card, grid, actions, btn, input, table } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { access } from '../core/store.js';

// Activity feed and per-platform chat announcements.
export async function activity() {
  const events = await api('/api/stream-activity');
  const c = card(
    'Activity feed',
    'Live follows, subscriptions, gifts, Bits, Kicks and raids, where supported. Announcement settings below are owner-only and post only to the originating chat.'
  );
  if (!events.length)
    c.append(
      e(
        'div',
        'No stream engagement events received yet. Events appear once platform subscriptions are connected.',
        'empty'
      )
    );
  else
    c.append(
      table(
        ['When', 'Platform', 'Event', 'Viewer', 'Details'],
        events.map(x => [
          x.created,
          x.platform.toUpperCase(),
          x.event_type.replaceAll('_', ' '),
          x.actor || '—',
          x.detail || '—'
        ])
      )
    );
  c.dataset.liveActivity = 'true';
  if (access.role !== 'owner') return c;
  const config = await api('/api/stream-announcements');
  const settings = card(
    'Platform-local event announcements',
    'Each toggle controls only its own platform. Announcements are disabled by default; customise the message and save each event.'
  );
  const names = {
    follow: 'New follower',
    subscription: 'New subscription',
    subscription_gift: 'Gifted subscriptions',
    cheer: 'Bits / NyaTreats',
    kicks: 'Kick Kicks',
    raid: 'Raid'
  };
  for (const platform of ['twitch', 'kick', 'vpzone', 'nekolive']) {
    const group = h('section', 'kf-settings-section', e('h3', platform.toUpperCase()));
    for (const entry of config.settings.filter(x => x.platform === platform)) {
      const toggle = input(
        'Post ' + (names[entry.event_type] || entry.event_type) + ' to ' + platform + ' chat',
        entry.enabled,
        'checkbox'
      );
      const template = input('Announcement message', entry.template);
      group.append(
        h(
          'div',
          'kf-result',
          grid('cols2', toggle.node, template.node),
          actions(
            btn(
              'Save ' + (names[entry.event_type] || entry.event_type),
              async () => {
                await api('/api/stream-announcements', 'POST', {
                  platform,
                  event_type: entry.event_type,
                  enabled: toggle.value(),
                  template: template.value()
                });
                notify(platform.toUpperCase() + ' ' + entry.event_type + ' announcement saved');
              },
              'primary'
            )
          )
        )
      );
    }
    settings.append(group);
  }
  return h('div', 'stack', c, settings);
}
// All feature panels keep a consistent header, icon and accent treatment.
