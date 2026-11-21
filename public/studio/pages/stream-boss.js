import { e, h, card, grid, actions, btn, link, input, table } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { reloadView } from '../core/router.js';

// Stream Boss widget, HP controls and damage rules.
export async function streamboss() {
  const d = await api('/api/stream-boss');
  const root = h('div', 'stack'),
    settings = card(
      'Stream Boss',
      'A standalone OBS boss widget. Event damage is OFF by default. The viewer delivering the final blow becomes the new boss.'
    );
  const enabled = input('Enable Stream Boss', d.enabled, 'checkbox'),
    name = input('Current boss name', d.name),
    title = input('Overlay title', d.title);
  const hp = input('Max HP', d.max_hp, 'number'),
    step = input('HP increase after a K.O.', d.step_hp, 'number');
  const accent = input('Accent colour', d.accent, 'color'),
    background = input('Background', d.background, 'color'),
    textColour = input('Text colour', d.text_color, 'color');
  const transparent = input('Transparent background', d.transparent, 'checkbox'),
    animate = input('Animations', d.show_animation, 'checkbox');
  const save = async () => {
    await api('/api/stream-boss/settings', 'POST', {
      enabled: enabled.value(),
      name: name.value(),
      title: title.value(),
      max_hp: hp.value(),
      step_hp: step.value(),
      accent: accent.value(),
      background: background.value(),
      text_color: textColour.value(),
      transparent: transparent.value(),
      show_animation: animate.value()
    });
    notify('Stream Boss settings saved');
    await reloadView();
  };
  settings.append(
    e(
      'p',
      'Current health: ' +
        d.hp.toLocaleString() +
        ' / ' +
        d.max_hp.toLocaleString() +
        ' · Boss defeats: ' +
        d.wins,
      'description'
    ),
    grid(
      'cols2',
      enabled.node,
      name.node,
      title.node,
      hp.node,
      step.node,
      accent.node,
      background.node,
      textColour.node,
      transparent.node,
      animate.node
    ),
    actions(btn('Save Stream Boss settings', save, 'primary'))
  );
  root.append(settings);
  const controls = card('Live HP controls', 'Manually test damage or heal while live.');
  const amount = input('HP amount', 500, 'number');
  controls.append(
    amount.node,
    actions(
      btn('Test a hit', async () => {
        await api('/api/stream-boss/control', 'POST', { action: 'hit', amount: amount.value() });
        await reloadView();
      }),
      btn('Heal', async () => {
        await api('/api/stream-boss/control', 'POST', { action: 'heal', amount: amount.value() });
        await reloadView();
      }),
      btn('Reset HP', async () => {
        await api('/api/stream-boss/control', 'POST', { action: 'reset', amount: 0 });
        await reloadView();
      })
    )
  );
  root.append(controls);
  const source = card(
    'Stream Boss OBS browser source',
    'Separate from your subathon timer and information overlays.'
  );
  const url = location.origin + '/stream-boss/overlay/' + d.public_key,
    field = input('Stream Boss URL', url);
  field.el.readOnly = true;
  source.append(
    field.node,
    actions(
      btn('Copy browser source', () => navigator.clipboard.writeText(url)),
      link('Open preview', url)
    )
  );
  root.append(source);
  const rewards = card(
    'Damage rules',
    'Enable which platform events damage the boss. Per unit applies to Bits, Kicks and gifted subscriptions when a reliable amount is provided.'
  );
  const rules = new Map(d.rules.map(x => [x.platform + ':' + x.event_type, x]));
  for (const [platform, events] of Object.entries(d.capabilities)) {
    const section = card(platform.toUpperCase());
    for (const event_type of events) {
      const entry = rules.get(platform + ':' + event_type) || {
        enabled: false,
        damage: ['subscription', 'subscription_renewal', 'subscription_gift'].includes(event_type)
          ? 500
          : 0,
        per_unit: ['cheer', 'kicks', 'donation', 'subscription_gift'].includes(event_type)
      };
      const on = input(event_type.replaceAll('_', ' '), Boolean(entry.enabled), 'checkbox'),
        damage = input('HP damage', entry.damage, 'number'),
        unit = input('Per unit', Boolean(entry.per_unit), 'checkbox');
      section.append(
        h(
          'div',
          'list-row',
          on.node,
          damage.node,
          unit.node,
          btn('Save', async () => {
            await api('/api/stream-boss/rule', 'POST', {
              platform,
              event_type,
              enabled: on.value(),
              damage: damage.value(),
              per_unit: unit.value()
            });
            notify('Boss damage rule saved');
          })
        )
      );
    }
    rewards.append(section);
  }
  root.append(rewards);
  const history = card('Recent boss hits');
  history.append(
    table(
      ['Who', 'Platform', 'Event', 'HP lost', 'Time'],
      d.history.map(x => [x.actor, x.platform, x.event_type, x.damage, x.created])
    )
  );
  root.append(history);
  return root;
}
