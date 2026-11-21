import { WebSocket } from 'ws';

// Twitch EventSub WebSockets: one shared-bot session carrying chat for every enabled channel,
// plus one session per broadcaster for engagement events (follows, subs, cheers, raids).
export function createEventSub({ db, twitch, log, onChatMessage, features }) {
  const { api, getAccount, botId } = twitch;
  // stream-activity is installed after EventSub is created; resolve it when events arrive.
  const streamActivity = { emit: (...args) => features.streamActivity.emit(...args) };
  // EventSub keepalive watchdog. Twitch sends session_keepalive messages; if none arrive within
  // keepalive_timeout_seconds the TCP link is dead even though 'close' may never fire (NAT/proxy
  // drops, laptop sleep, Docker network blips). Terminating forces the normal reconnect path.
  function keepaliveWatchdog(ws, label) {
    let limit = 30000,
      timer = null;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.warn(
          label + ': no EventSub keepalive for ' + Math.round(limit / 1000) + 's, forcing reconnect'
        );
        try {
          ws.terminate();
        } catch {}
      }, limit);
      timer.unref?.();
    };
    ws.on('open', arm);
    ws.on('message', arm);
    ws.on('ping', arm);
    ws.on('close', () => clearTimeout(timer));
    return {
      setTimeoutSeconds(sec) {
        const n = Number(sec);
        if (n > 0) limit = (n + 10) * 1000;
        arm();
      }
    };
  }
  const engagementSockets = new Map();
  const engagementFailures = new Map();
  function connectEngagement(channel) {
    if (!getAccount(channel)) return;
    const previous = engagementSockets.get(channel);
    if (previous) previous.close();
    const ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws', { handshakeTimeout: 15000 });
    engagementSockets.set(channel, ws);
    const watchdog = keepaliveWatchdog(ws, 'Engagement ' + channel);
    ws.on('message', async raw => {
      try {
        const d = JSON.parse(String(raw)),
          type = d.metadata?.message_type;
        if (type === 'notification') {
          const event = d.payload?.event || {},
            name = d.metadata.subscription_type;
          streamActivity.emit(
            channel,
            'twitch',
            name,
            event.user_name ||
              event.from_broadcaster_user_name ||
              event.to_broadcaster_user_name ||
              '',
            event.message?.text ||
              String(
                name === 'channel.subscription.gift'
                  ? event.total || 1
                  : event.bits || event.viewers || event.tier || ''
              ),
            d.metadata.message_id
          );
        } else if (type === 'session_reconnect') {
          // Simplest safe handling: open a fresh session and resubscribe.
          connectEngagement(channel);
          return;
        } else if (type === 'session_welcome') {
          watchdog.setTimeoutSeconds(d.payload.session.keepalive_timeout_seconds);
          engagementFailures.set(channel, 0);
          const sid = d.payload.session.id;
          const config = [
            ['channel.follow', '2', { broadcaster_user_id: channel, moderator_user_id: channel }],
            ['channel.subscribe', '1', { broadcaster_user_id: channel }],
            ['channel.subscription.gift', '1', { broadcaster_user_id: channel }],
            ['channel.subscription.message', '1', { broadcaster_user_id: channel }],
            ['channel.cheer', '1', { broadcaster_user_id: channel }],
            ['channel.raid', '1', { to_broadcaster_user_id: channel }]
          ];
          const broadcaster = getAccount(channel);
          let granted = [];
          try {
            granted = JSON.parse(broadcaster?.scopes || '[]');
          } catch {}
          const requiredScope = {
            'channel.subscribe': 'channel:read:subscriptions',
            'channel.subscription.gift': 'channel:read:subscriptions',
            'channel.subscription.message': 'channel:read:subscriptions',
            'channel.cheer': 'bits:read',
            'channel.follow': 'moderator:read:followers'
          };
          for (const [name, version, condition] of config) {
            const required = requiredScope[name];
            if (required && !granted.includes(required)) {
              log(
                channel,
                'twitch-eventsub-missing-scope',
                name +
                  ': ' +
                  required +
                  ' — broadcaster must reconnect Twitch in Studio to grant access'
              );
              continue;
            }
            try {
              await api(channel, 'eventsub/subscriptions', 'POST', {
                type: name,
                version,
                condition,
                transport: { method: 'websocket', session_id: sid }
              });
            } catch (err) {
              log(channel, 'twitch-eventsub-error', name + ': ' + err.message);
            }
          }
        }
      } catch (err) {
        log(channel, 'twitch-engagement-error', err.message);
      }
    });
    ws.on('close', code => {
      if (engagementSockets.get(channel) === ws) {
        const n = engagementFailures.get(channel) || 0;
        engagementFailures.set(channel, n + 1);
        const delay = Math.min(120000, 10000 * 2 ** Math.min(n, 4));
        log(
          channel,
          'twitch-engagement-reconnect',
          'Socket closed (' + code + '), retrying in ' + delay / 1000 + 's'
        );
        const handle = setTimeout(() => {
          if (engagementSockets.get(channel) === ws) connectEngagement(channel);
        }, delay);
        handle.unref?.();
      }
    });
    ws.on('error', err => log(channel, 'twitch-engagement-ws-error', err.message));
  }
  const sockets = new Map();
  const chatHealth = new Map();
  let chatGeneration = 0,
    chatFailures = 0,
    chatRetry = null;
  async function connectChat() {
    const id = botId();
    if (!id) return;
    clearTimeout(chatRetry);
    chatRetry = null;
    const generation = ++chatGeneration;
    const previous = sockets.get('bot');
    if (previous) {
      sockets.delete('bot');
      previous.close();
    }
    function openSocket(url, isReconnect = false) {
      if (generation !== chatGeneration) return;
      const ws = new WebSocket(url, { handshakeTimeout: 15000 });
      sockets.set('bot', ws);
      const watchdog = keepaliveWatchdog(ws, 'Chat EventSub');
      ws.on('message', async raw => {
        try {
          const d = JSON.parse(String(raw)),
            type = d.metadata?.message_type;
          if (type === 'session_reconnect') {
            // Twitch sends a reconnect URL; the replacement must have the SAME handlers.
            const next = d.payload?.session?.reconnect_url;
            if (next) {
              openSocket(next, true);
              ws.close();
            }
            return;
          }
          if (type === 'notification') {
            if (d.metadata.subscription_type === 'channel.chat.message') {
              const event = d.payload?.event || {},
                channel = String(event.broadcaster_user_id || '');
              const state = chatHealth.get(channel) || {};
              chatHealth.set(channel, {
                ...state,
                lastMessageAt: Date.now(),
                lastMessageId: String(event.source_message_id || event.message_id || '')
              });
              await onChatMessage(event);
              return;
            }
            const ev = d.payload?.event || {};
            const target = String(ev.broadcaster_user_id || ev.to_broadcaster_user_id || '');
            if (target && db.prepare('SELECT 1 FROM channels WHERE id=?').get(target))
              streamActivity.emit(
                target,
                'twitch',
                d.metadata.subscription_type,
                ev.user_name || ev.from_broadcaster_user_name || '',
                ev.message?.text || ev.tier || String(ev.bits || ev.viewers || ''),
                d.metadata.message_id
              );
            return;
          }
          if (type === 'session_welcome') {
            watchdog.setTimeoutSeconds(d.payload.session.keepalive_timeout_seconds);
            chatFailures = 0;
            if (isReconnect) return; // Twitch preserves existing EventSub subscriptions across reconnect URLs.
            const sessionId = d.payload.session.id;
            for (const ch of db.prepare('SELECT id FROM channels WHERE enabled=1').all()) {
              chatHealth.set(ch.id, { status: 'subscribing', updatedAt: Date.now() });
              try {
                await api(id, 'eventsub/subscriptions', 'POST', {
                  type: 'channel.chat.message',
                  version: '1',
                  condition: { broadcaster_user_id: ch.id, user_id: id },
                  transport: { method: 'websocket', session_id: sessionId }
                });
                chatHealth.set(ch.id, { status: 'subscribed', updatedAt: Date.now() });
                log(ch.id, 'chat-eventsub', 'Subscribed to chat messages');
              } catch (err) {
                chatHealth.set(ch.id, {
                  status: 'failed',
                  detail: err.message.slice(0, 250),
                  updatedAt: Date.now()
                });
                log(ch.id, 'chat-eventsub-error', err.message);
              }
            }
          }
        } catch (err) {
          console.error('Chat EventSub:', err.message);
        }
      });
      ws.on('close', (code, reason) => {
        if (generation === chatGeneration && sockets.get('bot') === ws) {
          sockets.delete('bot');
          const delay = Math.min(60000, 5000 * 2 ** Math.min(chatFailures++, 4));
          console.warn(
            'Chat EventSub closed (' +
              code +
              (reason?.length ? ' ' + reason : '') +
              '), reconnecting in ' +
              delay / 1000 +
              's'
          );
          chatRetry = setTimeout(() => {
            chatRetry = null;
            if (generation === chatGeneration)
              void connectChat().catch(err => console.error('Chat reconnect:', err.message));
          }, delay);
          chatRetry.unref?.();
        }
      });
      ws.on('error', err => console.error('Chat EventSub socket:', err.message));
    }
    openSocket('wss://eventsub.wss.twitch.tv/ws');
  }
  // Safety net: if the bot socket is gone and no retry is scheduled, bring it back.
  function startHealthCheck() {
    setInterval(() => {
      const ws = sockets.get('bot');
      if (botId() && !chatRetry && (!ws || ws.readyState === WebSocket.CLOSED)) {
        console.warn('Chat EventSub health check: socket missing, reconnecting');
        void connectChat().catch(err => console.error('Chat reconnect:', err.message));
      }
    }, 60000).unref?.();
  }
  function connectAllEngagement() {
    for (const row of db.prepare('SELECT id FROM channels').all()) connectEngagement(row.id);
  }
  const botSocket = () => sockets.get('bot');
  return {
    connectChat,
    connectEngagement,
    connectAllEngagement,
    startHealthCheck,
    chatHealth,
    botSocket
  };
}
