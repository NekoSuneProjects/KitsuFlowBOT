import { e, h, card, grid, actions, btn, link, input, table, stat, banner } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { state } from '../core/store.js';
import { reloadView, show } from '../core/router.js';

// Operator Admin Panel.
export async function admin() {
  if (!state.isOperator)
    return card('Restricted', 'Only the configured Twitch administrator can access this page.');
  const x = await api('/api/admin/overview');
  const c = card(
    'Global public Twitch bot',
    'The public bot account is connected once by the platform owner. Streamers can then enable this bot for their own channels.'
  );
  c.append(
    banner(
      x.bot ? 'Public bot connected: @' + x.bot.login : 'Public bot needs authorisation',
      x.bot
        ? 'EventSub: ' + x.connection_status + ' · Twitch ID: ' + x.bot.id
        : 'Sign into the intended Twitch bot account when Twitch asks for authorisation.',
      link(
        x.bot ? 'Reauthorise public bot' : 'Connect public Twitch bot',
        '/auth/connect/bot',
        'primary'
      )
    ),
    grid(
      'stats',
      stat('Registered channels', x.channels.length, '♙', 'All configured channels'),
      stat('Enabled channels', x.enabled_count, '✓', 'Channels using the bot'),
      stat('Connection', x.connection_status, '⇄', 'EventSub WebSocket status'),
      stat('OAuth', x.bot ? 'Connected' : 'Not linked', '◇', 'Global bot identity')
    )
  );
  const device = card(
    'Connect bot from another browser or device',
    'Use a one-time Twitch activation code. Sign into the dedicated bot Twitch account on the other browser; never authorise your streamer account here.'
  );
  const deviceOutput = e('div', undefined, 'stack');
  const activate = btn('Generate Twitch device code', async () => {
    const result = await api('/api/admin/bot/device/start', 'POST');
    deviceOutput.replaceChildren();
    deviceOutput.append(
      e('div', 'Code: ' + result.user_code, 'stat-value'),
      e('div', 'Expires: ' + new Date(result.expires_at).toLocaleTimeString(), 'description'),
      link('Open Twitch activation ↗', result.verification_uri, 'primary')
    );
    deviceOutput.append(
      btn('Check authorisation', async () => {
        const status = await api('/api/admin/bot/device/check', 'POST');
        if (status.status === 'connected') {
          notify('Global bot connected: @' + status.bot.login);
          await reloadView();
        } else {
          notify(
            status.status === 'pending'
              ? 'Awaiting approval. Retry after ' + (status.retry_after || 5) + ' seconds.'
              : 'Device code expired; generate a new code.'
          );
        }
      })
    );
  });
  device.append(actions(activate), deviceOutput);
  c.append(device);
  const platformBots = card(
    'Shared Kick / VPZone bot accounts',
    'Platform administrators can link dedicated bot accounts without replacing broadcaster accounts.'
  );
  const pb = await api('/api/admin/platform-bots');
  for (const platform of ['kick', 'vpzone']) {
    const bot = pb.bots.find(b => b.platform === platform),
      config = pb.configured.find(b => b.platform === platform);
    platformBots.append(
      h(
        'div',
        'list-row',
        h(
          'div',
          '',
          e('strong', platform.toUpperCase()),
          e(
            'div',
            bot
              ? 'Shared bot @' + bot.display_name
              : config?.ready
                ? 'Not connected'
                : 'Configure OAuth client credentials first',
            'tiny'
          )
        ),
        actions(
          config?.ready
            ? link(bot ? 'Reauthorise' : 'Connect bot', '/auth/platform-bot/' + platform, 'primary')
            : e('span', 'Not configured', 'tiny'),
          bot
            ? btn(
                'Disconnect',
                async () => {
                  if (!confirm('Disconnect ' + platform + ' shared bot?')) return;
                  await api('/api/admin/platform-bots/' + platform + '/disconnect', 'POST');
                  await reloadView();
                },
                'danger'
              )
            : null
        )
      )
    );
  }
  const nb = await api('/api/admin/nekolive/bot').catch(() => ({ base: null, bot: null }));
  const nekoToken = input(
      nb.bot ? 'Replace NekoLive bot token' : 'NekoLive bot token',
      '',
      'password'
    ),
    nekoName = input('Bot account name (as shown on NekoLive)', nb.bot?.display_name || '');
  platformBots.append(
    h(
      'div',
      'kf-result',
      e('strong', 'NEKOLIVE'),
      e(
        'div',
        !nb.base
          ? 'Set NEKOLIVE_BASE_URL first'
          : nb.bot
            ? 'Fallback bot @' +
              nb.bot.display_name +
              ' (used only for channels that did not grant the app chatbot)'
            : 'Optional. Channels normally post as the chatbot linked to the KitsuFlowBOT app in NekoLive /developers. A bot token here is only a fallback for channels that did not approve that permission.',
        'tiny'
      ),
      grid('cols2', nekoToken.node, nekoName.node),
      actions(
        btn(
          'Save NekoLive bot',
          async () => {
            await api('/api/admin/nekolive/bot', 'POST', {
              token: nekoToken.value(),
              name: nekoName.value()
            });
            notify('NekoLive bot saved');
            await reloadView();
          },
          'primary'
        ),
        nb.bot
          ? btn(
              'Disconnect',
              async () => {
                if (!confirm('Remove the NekoLive bot token?')) return;
                await api('/api/admin/nekolive/bot/disconnect', 'POST');
                await reloadView();
              },
              'danger'
            )
          : null
      )
    )
  );
  c.append(platformBots);
  c.append(
    actions(
      btn('Reconnect bot EventSub', async () => {
        await api('/api/admin/bot/reconnect', 'POST');
        notify('Reconnection requested');
        await show('admin');
      })
    ),
    e('h3', 'Connected channels'),
    table(
      ['Channel', 'Twitch ID', 'Enabled'],
      x.channels.map(v => ['@' + v.login, v.id, v.enabled ? 'Yes' : 'No'])
    )
  );
  if (x.bot?.login === state.channel.login)
    c.append(
      e(
        'div',
        'Warning: The bot and broadcaster are the same Twitch account. For a public multi-channel bot, authorise a dedicated bot Twitch account instead.',
        'empty'
      )
    );
  const logs = await adminLogs();
  const diagnostics = card(
    'Bot & platform logs',
    'Operational diagnostics, integration errors, chat command logs and connection history.'
  );
  diagnostics.append(
    table(
      ['Time', 'Channel', 'Type', 'Detail'],
      logs.map(v => [v.created, v.login || v.channel, v.event, v.detail])
    )
  );
  return h('div', 'stack', c, diagnostics);
}
async function adminLogs() {
  return await api('/api/admin/logs').catch(() => []);
}
