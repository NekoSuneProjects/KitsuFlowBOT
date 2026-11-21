import { e, h, card, actions, btn, link, input, table } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { reloadView } from '../core/router.js';

// Chat relay routing and Twitch chat diagnostics.
export async function relay() {
  const c = h('div', 'stack');
  const chatDiag = await api('/api/chat-diagnostics').catch(err => ({ error: err.message }));
  const diagnosticCard = card(
    'Twitch chat command diagnostics',
    'Shows the Twitch bot connection and whether this channel subscribed to chat events. A subscribed status does not guarantee Twitch is delivering messages.'
  );
  diagnosticCard.append(
    e(
      'p',
      'Bot socket: ' +
        (chatDiag.socketConnected ? 'Connected' : 'Disconnected') +
        ' · Channel enabled: ' +
        (chatDiag.channelEnabled ? 'Yes' : 'No') +
        ' · Chat EventSub: ' +
        (chatDiag.subscription?.status || chatDiag.error || 'Unknown'),
      'description'
    )
  );
  if (chatDiag.subscription?.detail)
    diagnosticCard.append(e('p', chatDiag.subscription.detail, 'description'));
  diagnosticCard.append(
    actions(
      btn(
        'Test sending Twitch chat',
        async () => {
          try {
            const result = await api('/api/chat-diagnostics/test-send', 'POST', {});
            notify(result.message || 'Twitch message sent');
          } catch (err) {
            notify('Chat test failed: ' + err.message);
          }
        },
        'primary'
      )
    )
  );
  diagnosticCard.append(
    table(
      ['Event', 'Detail', 'Time'],
      (chatDiag.recentLogs || []).map(x => [x.event, x.detail, x.created])
    )
  );
  c.append(diagnosticCard);
  const engagementScopes = await api('/api/twitch/engagement-scopes').catch(() => null);
  if (engagementScopes?.missing?.length) {
    const missing = card(
      'Twitch event permissions missing',
      'Some subscriptions, Bits or follower events will not work until the broadcaster grants the relevant OAuth scopes. This does not necessarily stop chat commands.'
    );
    missing.append(
      e('p', 'Missing: ' + engagementScopes.missing.join(', '), 'description'),
      actions(link('Reconnect broadcaster Twitch permissions', '/auth/connect/streamer', 'primary'))
    );
    c.append(missing);
  }
  const relayData = await api('/api/relay').catch(() => ({
    enabled: false,
    routes: [],
    history: []
  }));
  const relayCard = card(
    'Cross-platform chat relay',
    'One master toggle. Choose which connected platforms participate; enabled platforms share messages with each other. OBS multi-chat works independently without relay.'
  );
  const relayEnabled = input(
    'Enable cross-platform chat relay',
    Boolean(relayData.enabled),
    'checkbox'
  );
  const relayJoins = input(
    'Relay join notifications',
    Boolean(relayData.eventPreferences?.joins),
    'checkbox'
  );
  const relayAlerts = input(
    'Relay system alerts (follows, gifts, raids, etc.)',
    Boolean(relayData.eventPreferences?.alerts),
    'checkbox'
  );
  relayCard.append(
    e(
      'p',
      'Viewer chat is relayed normally. VPZone join notices and system alerts are excluded unless enabled below. These switches apply to outgoing relay, not the OBS activity feed.',
      'description'
    ),
    relayJoins.node,
    relayAlerts.node,
    actions(
      btn('Save event relay preferences', async () => {
        await api('/api/relay/events', 'POST', {
          joins: relayJoins.value(),
          alerts: relayAlerts.value()
        });
        notify('Relay event preferences saved');
      })
    )
  );

  const active = new Set(
    (relayData.routes || []).filter(r => r.enabled).flatMap(r => [r.source, r.target])
  );
  const selected = {};
  for (const platform of ['twitch', 'kick', 'vpzone', 'nekolive', 'beam', 'tiktok'])
    selected[platform] = input(
      'Include ' + platform.toUpperCase() + (platform === 'tiktok' ? ' (receive only)' : ''),
      active.has(platform),
      'checkbox'
    );
  relayCard.append(
    relayEnabled.node,
    h('div', 'kf-platforms', ...Object.values(selected).map(x => x.node)),
    actions(
      btn(
        'Save relay settings',
        async () => {
          const platforms = Object.entries(selected)
            .filter(([, control]) => control.value())
            .map(([name]) => name);
          await api('/api/relay/group', 'POST', { enabled: relayEnabled.value(), platforms });
          notify('Cross-platform relay settings saved');
          await reloadView();
        },
        'primary'
      )
    )
  );
  const relayLog = card('Chat relay history', 'Latest routed messages and their delivery status.');
  relayLog.append(
    table(
      ['Source', 'Target', 'Sender', 'Status'],
      relayData.history.map(x => [x.source, x.target, x.sender, x.status])
    )
  );
  const feed = card(
    'Cross-platform activity',
    'Verified provider events appear here when event delivery is configured. Twitch remains the primary dashboard login.'
  );
  const events = await api('/api/platform-events').catch(() => []);
  feed.append(
    table(
      ['Platform', 'Type', 'When'],
      events.slice(0, 30).map(x => [x.platform, x.event_type, x.created])
    )
  );
  c.append(diagnosticCard, relayCard, relayLog, feed);
  return c;
}
