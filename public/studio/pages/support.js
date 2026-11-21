import { h, card, grid, actions, btn, link, input, table } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { reloadView } from '../core/router.js';

// Alerts overlay, donation providers and membership webhooks.
export async function support() {
  const [a, p] = await Promise.all([api('/api/stream-alerts'), api('/api/payment-integrations')]);
  const root = h('div', 'stack');
  const box = card(
    'OBS alert overlay',
    'Displays new follows, subs, resubs, gifted subs, Bits, Kicks, VPZone support events and enabled donation/membership events. Alerts are disabled by default.'
  );
  const source = location.origin + '/stream-alerts/overlay/' + a.public_key,
    sourceField = input('Alert Browser Source URL', source);
  sourceField.el.readOnly = true;
  const title = input('Overlay heading', a.title),
    accent = input('Accent colour', a.accent, 'color'),
    bg = input('Background', a.background, 'color'),
    fg = input('Text colour', a.text_color, 'color');
  const transparent = input('Transparent overlay', a.transparent, 'checkbox'),
    amount = input('Show event details / amount', a.show_amount, 'checkbox'),
    duration = input('Alert duration (milliseconds)', a.duration_ms, 'number');
  box.append(
    sourceField.node,
    actions(
      btn('Copy alert overlay URL', () => navigator.clipboard.writeText(source)),
      link('Open preview', source)
    ),
    grid(
      'cols2',
      title.node,
      accent.node,
      bg.node,
      fg.node,
      transparent.node,
      amount.node,
      duration.node
    ),
    actions(
      btn(
        'Save alert style',
        async () => {
          await api('/api/stream-alerts/settings', 'POST', {
            title: title.value(),
            accent: accent.value(),
            background: bg.value(),
            text_color: fg.value(),
            transparent: transparent.value(),
            show_amount: amount.value(),
            duration_ms: duration.value()
          });
          notify('Alert style saved');
        },
        'primary'
      )
    )
  );
  root.append(box);
  const rules = card(
    'Alert event switches',
    'Choose which notifications appear in your OBS alert Browser Source. Disabling an alert never disables the originating Twitch, Kick or VPZone event feed.'
  );
  const map = new Map(a.rules.map(r => [r.platform + ':' + r.event_type, r]));
  for (const [platform, kinds] of Object.entries(a.capabilities)) {
    const section = card(platform.toUpperCase());
    for (const event_type of kinds) {
      const toggle = input(
        event_type.replaceAll('_', ' '),
        Boolean(map.get(platform + ':' + event_type)?.enabled),
        'checkbox'
      );
      section.append(
        h(
          'div',
          'list-row',
          toggle.node,
          btn('Save', async () => {
            await api('/api/stream-alerts/rule', 'POST', {
              platform,
              event_type,
              enabled: toggle.value()
            });
            notify('Alert rule saved');
          })
        )
      );
    }
    rules.append(section);
  }
  root.append(rules);
  const payments = card(
    'Donations and monthly memberships',
    'Tokens and webhook secrets are encrypted on the server. Existing credentials are never displayed in Studio. Use a different provider secret for each channel.'
  );
  for (const entry of p.providers) {
    const label = {
      streamelements: 'StreamElements JWT (Astro WebSocket)',
      streamlabs: 'Streamlabs Socket API token',
      tipeeestream: 'TipeeeStream API key',
      kofi: 'Ko-fi webhook verification token',
      patreon: 'Patreon webhook secret'
    }[entry.provider];
    const secret = input(entry.connected ? 'Replace ' + label : label, '', 'password');
    const fields = [secret.node],
      username =
        entry.provider === 'tipeeestream'
          ? input('TipeeeStream username', entry.username || '')
          : entry.provider === 'streamelements'
            ? input('StreamElements channel ID (room ID)', entry.username || '')
            : null;
    if (username) fields.push(username.node);
    const row = card(label, entry.connected ? 'Configured · ' + entry.status : 'Not configured');
    row.append(...fields);
    if (['kofi', 'patreon'].includes(entry.provider)) {
      const url = input('Webhook URL (configure at the provider)', entry.webhook_url);
      url.el.readOnly = true;
      row.append(
        url.node,
        actions(btn('Copy webhook URL', () => navigator.clipboard.writeText(entry.webhook_url)))
      );
    }
    row.append(
      actions(
        btn(
          'Save and connect',
          async () => {
            await api('/api/payment-integrations/' + entry.provider, 'POST', {
              secret: secret.value(),
              username: username?.value() || ''
            });
            notify(label + ' configured');
            await reloadView();
          },
          'primary'
        ),
        btn('Disconnect', async () => {
          if (!confirm('Disconnect ' + entry.provider + '?')) return;
          await api('/api/payment-integrations/' + entry.provider + '/disconnect', 'POST', {});
          await reloadView();
        })
      )
    );
    payments.append(row);
  }
  root.append(payments);
  const feed = card(
    'Recent donations and memberships',
    'Only verified webhook or connected socket events appear here. Provider currencies are shown as received without conversion.'
  );
  feed.append(
    table(
      ['Provider', 'Type', 'Supporter', 'Amount', 'Tier', 'When'],
      p.history.map(x => [
        x.provider,
        x.type,
        x.actor,
        x.amount ? x.amount + ' ' + x.currency : '—',
        x.tier || '—',
        x.created
      ])
    )
  );
  root.append(feed);
  return root;
}
