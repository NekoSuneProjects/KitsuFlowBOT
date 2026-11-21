import { e, h, card, grid, actions, btn, link, input } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { state } from '../core/store.js';
import { reloadView } from '../core/router.js';

// Connections: Twitch, Kick, VPZone, NekoLive and TikTok linking.
function enhanceCreatorPanels(root) {
  const icons = new Map([
    ['Unified creator profile', '◉'],
    ['Set title and game on linked platforms', '▤'],
    ['AI stream title helper', '✦'],
    ['Multi-chat OBS browser source', '◈'],
    ['Linked streaming channels', '⇄']
  ]);
  root.querySelectorAll('.card').forEach(c => {
    const heading = c.querySelector(':scope > h2');
    if (
      !heading ||
      !icons.has(heading.textContent) ||
      heading.parentElement.classList.contains('kf-panel-heading')
    )
      return;
    const description = heading.nextElementSibling?.classList.contains('description')
      ? heading.nextElementSibling
      : null;
    const title = heading.textContent,
      wrapper = h('div', 'kf-panel-heading', e('span', icons.get(title), 'kf-panel-icon'));
    const copy = h('div', '');
    copy.append(heading);
    if (description) copy.append(description);
    wrapper.append(copy);
    c.prepend(wrapper);
  });
}
export async function connections() {
  const c = card(
    'Unified creator profile',
    'Twitch is your primary login. Connect Kick and VPZone to this same workspace. Your saved settings and custom commands belong to this creator account.'
  );
  c.append(
    h(
      'div',
      'kf-connection-surface',
      h(
        'div',
        'kf-identity',
        e('div', 'Twitch broadcaster', 'kf-identity-label'),
        e('strong', '@' + state.channel.login)
      ),
      h(
        'div',
        'kf-identity',
        e('div', 'Shared bot', 'kf-identity-label'),
        e('strong', state.bot ? '@' + state.bot.login : 'Not connected')
      )
    )
  );
  const enabled = input('Enable bot for my channel', !!state.channel.enabled, 'checkbox'),
    links = input('Timeout unapproved links', !!state.channel.links, 'checkbox');
  c.append(
    grid('cols2', enabled.node, links.node),
    actions(
      btn(
        'Save Twitch settings',
        async () => {
          await api('/api/settings', 'POST', { enabled: enabled.value(), links: links.value() });
          await reloadView();
        },
        'primary'
      )
    )
  );
  const runtime = await api('/api/platforms/runtime').catch(() => null);
  const providerCard = card(
    'Linked streaming channels',
    'Kick and VPZone attach to your Twitch-based profile. You stay signed in with Twitch, and manage them from one dashboard. Connected platforms share creator settings and commands where their chat integrations support them.'
  );
  let result;
  try {
    result = await api('/api/platforms');
  } catch (err) {
    providerCard.append(
      e('div', 'Could not load Kick/VPZone connections: ' + err.message, 'empty')
    );
    result = { platforms: [] };
  }
  for (const provider of result.platforms.filter(x => x.platform !== 'twitch')) {
    const row = h(
      'div',
      'list-row',
      h(
        'div',
        '',
        e('strong', provider.platform === 'kick' ? 'Kick' : 'VPZone'),
        e(
          'div',
          provider.connection
            ? 'Linked: ' +
                provider.connection.display_name +
                ' · ' +
                (provider.platform === 'vpzone'
                  ? runtime?.vpzone?.chat_connected
                    ? 'Chat connected'
                    : 'Chat disconnected'
                  : runtime?.kick?.subscription_active
                    ? 'Chat subscribed'
                    : 'Chat subscription pending')
            : provider.configured
              ? 'Ready for OAuth connection'
              : 'Developer app credentials required',
          'tiny'
        )
      )
    );
    if (provider.connection) {
      row.append(
        actions(
          btn('View channel', async () => {
            const data = await api('/api/platforms/' + provider.platform + '/channel');
            notify(provider.platform + ' channel information loaded');
            console.info(data);
          }),
          btn(
            'Disconnect',
            async () => {
              if (!confirm('Disconnect ' + provider.platform + '?')) return;
              await api('/api/platforms/' + provider.platform + '/disconnect', 'POST');
              await reloadView();
            },
            'danger'
          )
        )
      );
    } else if (provider.configured) {
      row.append(
        link('Connect ' + provider.platform, '/auth/platform/' + provider.platform, 'primary')
      );
    } else row.append(e('span', 'Not configured', 'pill'));
    providerCard.append(row);
  }
  const neko = await api('/api/nekolive').catch(() => null);
  if (neko) {
    const status = neko.linked
      ? 'Linked: ' +
        neko.linked.display_name +
        ' · Chat ' +
        (neko.chat?.status === 'connected' ? 'connected' : neko.chat?.detail || 'disconnected') +
        ' · ' +
        (neko.send_mode === 'app'
          ? 'Bot: KitsuFlowBOT app chatbot'
          : neko.send_mode === 'token'
            ? 'Bot @' + neko.bot.display_name + ' (admin token)'
            : 'Bot not allowed yet: reconnect and approve the chatbot permission')
      : neko.configured.oauth
        ? 'Ready for OAuth connection'
        : 'Set NEKOLIVE_BASE_URL, NEKOLIVE_CLIENT_ID and NEKOLIVE_CLIENT_SECRET on the server';
    const row = h(
      'div',
      'list-row',
      h('div', '', e('strong', 'NekoLive'), e('div', status, 'tiny'))
    );
    if (neko.linked) {
      row.append(
        actions(
          btn('Send test message', async () => {
            await api('/api/nekolive/chat', 'POST', {});
            notify('NekoLive bot message sent');
          }),
          btn(
            'Disconnect',
            async () => {
              if (!confirm('Disconnect NekoLive?')) return;
              await api('/api/nekolive/disconnect', 'POST');
              await reloadView();
            },
            'danger'
          )
        )
      );
    } else if (neko.configured.oauth)
      row.append(link('Connect NekoLive', '/auth/nekolive', 'primary'));
    else row.append(e('span', 'Not configured', 'pill'));
    providerCard.append(row);
  }
  const beam = await api('/api/beam').catch(() => null);
  if (beam) {
    const status = beam.linked
      ? 'Linked: ' +
        beam.linked.slug +
        ' · Events ' +
        (beam.chat?.status === 'connected' ? 'connected' : beam.chat?.detail || 'disconnected') +
        ' · ' +
        (beam.bot ? 'Bot @' + beam.bot.display_name : 'BEAM bot not linked by admin yet')
      : beam.configured
        ? 'Ready for OAuth connection'
        : 'Set BEAM_CLIENT_ID and BEAM_CLIENT_SECRET on the server';
    const row = h('div', 'list-row', h('div', '', e('strong', 'BEAM'), e('div', status, 'tiny')));
    if (beam.linked) {
      row.append(
        actions(
          btn('Send test message', async () => {
            await api('/api/beam/chat', 'POST', {});
            notify('BEAM bot message sent');
          }),
          btn(
            'Disconnect',
            async () => {
              if (!confirm('Disconnect BEAM?')) return;
              await api('/api/beam/disconnect', 'POST');
              await reloadView();
            },
            'danger'
          )
        )
      );
    } else if (beam.configured) row.append(link('Connect BEAM', '/auth/beam', 'primary'));
    else row.append(e('span', 'Not configured', 'pill'));
    providerCard.append(row);
  }
  const tiktokConfig = await api('/api/tiktok-inbound').catch(() => ({
    username: '',
    enabled: false,
    status: { status: 'unavailable' }
  }));
  const tiktokCard = card(
    'TikTok LIVE incoming chat (receive only)',
    'Reads public TikTok LIVE comments using an unofficial connector. No TikTok login, app permission, or outbound posting is required. For relay, enable TikTok as a source and choose Twitch/Kick/VPZone destinations below.'
  );
  const tikUser = input('TikTok LIVE username', tiktokConfig.username || '');
  const tikEnabled = input(
    'Connect to TikTok LIVE chat',
    Boolean(tiktokConfig.enabled),
    'checkbox'
  );
  const challenge = e('div', '', 'stack');
  const bioCode = input('Ownership code (from Generate ownership code)', '');
  tiktokCard.append(
    tikUser.node,
    tikEnabled.node,
    e(
      'p',
      'Verification: ' +
        (tiktokConfig.verified ? 'Verified' : 'Required') +
        ' · Connection: ' +
        (tiktokConfig.status?.status || 'unknown') +
        (tiktokConfig.status?.detail ? ' — ' + tiktokConfig.status.detail : ''),
      'description'
    ),
    actions(
      btn('Generate ownership code', async () => {
        const x = await api('/api/tiktok-inbound/verify/start', 'POST', {
          username: tikUser.value()
        });
        bioCode.el.value = x.code;
        challenge.replaceChildren(
          e(
            'p',
            'Copy this code into your TikTok public profile bio, save it, then click Verify using bio. You do not need to go LIVE. Alternatively, send it in your LIVE chat:',
            'description'
          ),
          e('strong', x.code)
        );
        notify('Ownership challenge created. Add this code to your TikTok bio to verify.');
      }),
      btn(
        'Verify using TikTok bio',
        async () => {
          const x = await api('/api/tiktok-inbound/verify/bio', 'POST', {
            code: bioCode.value()
          });
          notify(x.verified ? 'TikTok profile bio verified!' : 'Verification incomplete');
          await reloadView();
        },
        'primary'
      ),
      btn('Check LIVE chat (20 sec)', async () => {
        const x = await api('/api/tiktok-inbound/verify/check', 'POST', {});
        notify(x.verified ? 'TikTok account verified!' : 'Verification incomplete');
        await reloadView();
      }),
      btn(
        'Save TikTok receiver',
        async () => {
          await api('/api/tiktok-inbound', 'POST', {
            username: tikUser.value(),
            enabled: tikEnabled.value()
          });
          notify('TikTok receiver saved');
          await reloadView();
        },
        'primary'
      )
    ),
    bioCode.node,
    challenge
  );
  c.append(tiktokCard);
  const layout = h('div', 'stack', c, providerCard);
  enhanceCreatorPanels(layout);
  return layout;
}
