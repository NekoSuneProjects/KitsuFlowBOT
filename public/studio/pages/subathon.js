import { e, h, card, grid, actions, btn, link, input, selector, table } from '../core/dom.js';
import { notify, api } from '../core/api.js';

// Subathon timer, OBS sources and automatic time rewards.
export async function subathon() {
  const d = await api('/api/subathon');
  const root = h('div', 'stack');
  const current = card(
    'Subathon countdown',
    'Persistent timer: continues to count down on the server after you close Studio. A paused timer keeps its remaining time.'
  );
  const shown = e('div', '', 'description');
  const format = ms => {
    const n = Math.ceil(Math.max(0, ms) / 1000);
    return (
      String(Math.floor(n / 3600)).padStart(2, '0') +
      ':' +
      String(Math.floor((n % 3600) / 60)).padStart(2, '0') +
      ':' +
      String(n % 60).padStart(2, '0')
    );
  };
  let remaining = d.remaining_ms,
    started = Date.now(),
    running = d.running;
  const render = () => {
    if (!shown.isConnected) return;
    shown.textContent =
      format(remaining - (running ? Date.now() - started : 0)) +
      ' · ' +
      (running ? 'Running' : 'Paused / ended');
  };
  render();
  const refresh = setInterval(() => {
    if (!shown.isConnected) {
      clearInterval(refresh);
      return;
    }
    render();
  }, 1000);
  const adjust = input('Time (seconds)', 3600, 'number');
  adjust.el.min = '0';
  adjust.el.max = '31536000';
  const control = async action => {
    const b = await api('/api/subathon/control', 'POST', { action, seconds: adjust.value() });
    remaining = b.remaining_ms;
    started = Date.now();
    running = b.running;
    render();
    notify('Subathon ' + action + ' saved');
  };
  current.append(
    shown,
    adjust.node,
    actions(
      btn('Start', () => control('start'), 'primary'),
      btn('Pause', () => control('pause')),
      btn('Add time', () => control('add')),
      btn('Remove time', () => control('remove')),
      btn('Set time', () => control('set')),
      btn('Reset', () => control('reset'))
    )
  );
  root.append(current);
  const ov = card(
    'OBS subathon countdown overlay',
    'Use as a Browser Source in OBS. Timer updates automatically and supports transparent backgrounds.'
  );
  const split = card(
    'Separate OBS sources',
    'Add each link as a separate Browser Source in OBS. The compact layout displays timer and time-reward rows like the reference image.'
  );
  for (const [label, mode] of [
    ['Timer only', 'timer'],
    ['Subathon rewards only', 'info'],
    ['Compact blue timer + rewards', 'compact']
  ]) {
    const u = location.origin + '/subathon/overlay/' + mode + '/' + d.public_key,
      field = input(label, u);
    field.el.readOnly = true;
    split.append(
      field.node,
      actions(
        btn('Copy ' + label, () => navigator.clipboard.writeText(u)),
        link('Preview', u)
      )
    );
  }
  root.append(split);
  const url = location.origin + '/subathon/overlay/' + d.public_key;
  const urlField = input('OBS Browser Source URL', url);
  urlField.el.readOnly = true;
  const titleField = input('Overlay title', d.title),
    maximum = input('Maximum timer hours (0 = no limit)', d.max_ms / 3600000, 'number');
  const accent = input('Accent colour', d.accent, 'color'),
    textColour = input('Text colour', d.text_color, 'color'),
    background = input('Background colour', d.background, 'color');
  const transparency = input('Transparent background', d.transparent, 'checkbox'),
    showEvents = input('Show latest time reward event', d.show_events, 'checkbox');
  const font = selector('Font', ['Inter', 'Arial', 'Verdana', 'Georgia', 'monospace'], d.font);
  maximum.el.min = '0';
  maximum.el.max = '8760';
  ov.append(
    urlField.node,
    actions(
      btn('Copy overlay URL', () => navigator.clipboard.writeText(url)),
      link('Open preview', url)
    ),
    grid(
      'cols2',
      titleField.node,
      maximum.node,
      accent.node,
      textColour.node,
      background.node,
      font.node,
      transparency.node,
      showEvents.node
    ),
    actions(
      btn(
        'Save overlay style',
        async () => {
          await api('/api/subathon/settings', 'POST', {
            title: titleField.value(),
            max_hours: maximum.value(),
            accent: accent.value(),
            text_color: textColour.value(),
            background: background.value(),
            font: font.value(),
            transparent: transparency.value(),
            show_events: showEvents.value()
          });
          notify('Subathon overlay style saved');
        },
        'primary'
      )
    )
  );
  root.append(ov);
  const rewards = card(
    'Automatic time rewards',
    'All rewards are OFF by default. Seconds per unit means Bits, Kicks or gifted-sub count where reported by the platform; other events count once.'
  );
  const rules = new Map(d.rules.map(x => [x.platform + ':' + x.event_type, x]));
  const names = {
    subscription: 'Subscription',
    subscription_renewal: 'Resub / renewal',
    subscription_gift: 'Gifted subscriptions',
    cheer: 'Bits / NyaTreats / Embers',
    kicks: 'Kick Kicks',
    follow: 'Follow',
    raid: 'Raid',
    donation: 'Donation'
  };
  for (const [platform, events] of Object.entries(d.capabilities)) {
    const sect = card(platform.toUpperCase());
    for (const event_type of events) {
      const rule = rules.get(platform + ':' + event_type) || {
        enabled: false,
        seconds:
          event_type === 'subscription' ||
          event_type === 'subscription_renewal' ||
          event_type === 'subscription_gift'
            ? 60
            : 0,
        per_unit: ['cheer', 'kicks', 'subscription_gift'].includes(event_type)
      };
      const enabled = input(
        'Enable ' + (names[event_type] || event_type),
        Boolean(rule.enabled),
        'checkbox'
      );
      const seconds = input('Seconds added', rule.seconds, 'number');
      seconds.el.min = '0';
      seconds.el.max = '86400';
      const perUnit = input('Per unit / gift', Boolean(rule.per_unit), 'checkbox');
      const save = btn('Save', async () => {
        await api('/api/subathon/rule', 'POST', {
          platform,
          event_type,
          enabled: enabled.value(),
          seconds: seconds.value(),
          per_unit: perUnit.value()
        });
        notify(platform + ' ' + event_type + ' reward saved');
      });
      sect.append(h('div', 'list-row', enabled.node, seconds.node, perUnit.node, save));
    }
    rewards.append(sect);
  }
  root.append(rewards);
  const history = card('Time added by recent events');
  history.append(
    table(
      ['Platform', 'Event', 'Viewer', 'Seconds', 'When'],
      (d.history || []).map(x => [x.platform, x.event_type, x.actor, '+' + x.seconds, x.created])
    )
  );
  root.append(history);
  return root;
}
