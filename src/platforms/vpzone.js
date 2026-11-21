import { WebSocket } from 'ws';
import { conf, platformSafe as safe } from './oauth.js';

// VPZone: public chat WebSocket listener, custom commands, dedicated-bot chat output and
// polling of the recent follows/subs/raids/pixels endpoints.
export function createVpzone({
  app,
  db,
  withUser,
  csrf,
  access,
  enc,
  dec,
  log,
  relay,
  streamActivity,
  refresh
}) {
  const vpCommandCooldowns = new Map();
  async function handleVpzoneCommand(channel, username, body, raw) {
    const parts = body.trim().split(/\s+/);
    const name = parts[0]?.toLowerCase();
    if (!name?.startsWith('!')) return;
    const key = name.slice(1);
    if (!/^[a-z0-9_]{1,32}$/.test(key)) return;
    const cmd = db
      .prepare('SELECT name,response,cooldown,level FROM commands WHERE channel=? AND name=?')
      .get(channel, key);
    if (!cmd) return;
    // Do not elevate viewers to moderator/subscriber; only unrestricted custom commands are safe here.
    if (cmd.level !== 'everyone') return;
    const throttleKey = channel + ':vpzone:' + key,
      now = Date.now();
    if ((vpCommandCooldowns.get(throttleKey) || 0) > now) return;
    const bot = db.prepare("SELECT 1 FROM platform_bot_accounts WHERE platform='vpzone'").get();
    if (!bot) return;
    vpCommandCooldowns.set(throttleKey, now + Math.max(0, Number(cmd.cooldown) || 0) * 1000);
    const broadcaster = db.prepare('SELECT login FROM channels WHERE id=?').get(channel);
    const reply = String(cmd.response)
      .replaceAll('{user}', username)
      .replaceAll('{channel}', broadcaster?.login || '')
      .replaceAll('{args}', parts.slice(1).join(' '))
      .slice(0, 450);
    await vpzoneBotSay(channel, reply);
    log(channel, 'vpzone-command', key);
  }
  const vpSockets = new Map();
  function vpzoneConnect(channel, slug) {
    if (!/^[a-z0-9_-]{2,32}$/i.test(slug)) return;
    const existing = vpSockets.get(channel);
    if (
      existing?.slug === slug &&
      [WebSocket.OPEN, WebSocket.CONNECTING].includes(existing.ws.readyState)
    )
      return;
    if (existing) {
      clearTimeout(existing.timer);
      existing.ws.close();
      vpSockets.delete(channel);
    }
    const entry = { slug, ws: null, timer: null };
    const connect = () => {
      if (
        db
          .prepare(
            "SELECT 1 FROM platform_oauth WHERE channel=? AND platform='vpzone' AND display_name=?"
          )
          .get(channel, slug) === undefined
      ) {
        vpSockets.delete(channel);
        return;
      }
      const ws = new WebSocket('wss://chat.vpzone.tv/ws?channel=' + encodeURIComponent(slug));
      entry.ws = ws;
      ws.on('open', () => log(channel, 'vpzone-chat-connected', slug));
      ws.on('message', raw => {
        try {
          const event = JSON.parse(String(raw));
          const item = event.message || event.data || event;
          const eventKind = String(event.type || event.event || '');
          if (eventKind)
            streamActivity.emit(
              channel,
              'vpzone',
              eventKind,
              String(item.username || item.sender?.username || ''),
              String(item.amount || item.message || '').slice(0, 200),
              String(event.id || '') || null
            );
          const username = String(item.username || item.sender?.username || '');
          const body = String(item.body || item.content || item.text || '').slice(0, 350);
          if (!username || !body) return;
          // VPZone sends platform-generated events through its websocket alongside viewer chat.
          // Classify them before relay so joins and alerts are OFF unless explicitly enabled.
          const kindText = String(item.type || item.event || eventKind || '').toLowerCase();
          const isSystemSender =
            /^(system|vpzone|notification|server)$/i.test(username) ||
            item.is_system === true ||
            item.system === true ||
            event.is_system === true;
          const isJoin =
            /\\b(join|joined|user_join|member_join|viewer_join|enter)\\b/i.test(kindText) ||
            (isSystemSender &&
              /\\b(just joined|joined (the )?(channel|chat|stream)|entered (the )?(channel|chat))\\b/i.test(
                body
              ));
          const isAlert =
            /\\b(follow|subscribe|subscription|gift|donation|tip|raid|alert|cheer|redeem)\\b/i.test(
              kindText
            ) ||
            (isSystemSender &&
              /\\b(followed|subscribed|gifted|donated|raided|redeemed|cheered)\\b/i.test(body));
          const eventType = isJoin
            ? 'joins'
            : isAlert
              ? 'alerts'
              : isSystemSender
                ? 'system'
                : 'chat';
          const bot = db
            .prepare(
              "SELECT external_id,display_name FROM platform_bot_accounts WHERE platform='vpzone'"
            )
            .get();
          const isBot = Boolean(
            bot &&
            (String(item.user_id || item.sender?.id || '') === bot.external_id ||
              username.toLowerCase() === bot.display_name.toLowerCase())
          );
          if (!isBot) {
            void relay
              .relay(channel, 'vpzone', username, body, {
                isBot: false,
                kind: eventType,
                fragments: item.fragments || item.emotes || []
              })
              .catch(err => log(channel, 'vpzone-relay-error', err.message));
            if (eventType === 'chat')
              void handleVpzoneCommand(channel, username, body, item).catch(err =>
                log(channel, 'vpzone-command-error', err.message)
              );
          }
        } catch (err) {
          log(channel, 'vpzone-event-error', err.message);
        }
      });
      ws.on('error', err => log(channel, 'vpzone-ws-error', err.message));
      ws.on('close', () => {
        if (vpSockets.get(channel) !== entry) return;
        entry.timer = setTimeout(connect, 10000);
        entry.timer.unref?.();
      });
    };
    vpSockets.set(channel, entry);
    connect();
  }
  function vpzoneDisconnect(channel) {
    const entry = vpSockets.get(channel);
    if (!entry) return;
    vpSockets.delete(channel);
    clearTimeout(entry.timer);
    entry.ws?.close();
  }
  // Restore chat connectivity after process restarts as well as after OAuth callbacks.
  const restore = () => {
    for (const item of db
      .prepare("SELECT channel,display_name FROM platform_oauth WHERE platform='vpzone'")
      .all())
      vpzoneConnect(item.channel, item.display_name);
  };
  restore();
  // VPZone chat sending requires an explicitly linked dedicated bot identity.
  // Broadcaster OAuth is never used silently as a bot substitute.
  async function vpzoneBotAccessToken() {
    const row = db.prepare("SELECT * FROM platform_bot_accounts WHERE platform='vpzone'").get();
    if (!row) throw Error('VPZone bot not connected. Link it in Admin Panel first.');
    if (row.expires_at > Date.now() + 120000) return dec(row.access_token);
    const p = conf('vpzone');
    if (!p?.clientId || !p.clientSecret) throw Error('VPZone developer credentials missing');
    const response = await fetch(p.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: dec(row.refresh_token),
        client_id: p.clientId,
        client_secret: p.clientSecret
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok)
      throw Error(
        'VPZone bot OAuth expired or revoked (' +
          response.status +
          '). Reconnect bot from Admin Panel.'
      );
    const json = await response.json();
    if (!json.access_token || !json.refresh_token)
      throw Error('VPZone did not return rotated bot tokens');
    db.prepare(
      "UPDATE platform_bot_accounts SET access_token=?,refresh_token=?,expires_at=? WHERE platform='vpzone'"
    ).run(
      enc(json.access_token),
      enc(json.refresh_token),
      Date.now() + Number(json.expires_in || 3600) * 1000
    );
    return json.access_token;
  }
  async function vpzoneBotSay(channel, text) {
    const linked = db
      .prepare("SELECT display_name FROM platform_oauth WHERE channel=? AND platform='vpzone'")
      .get(channel);
    if (!linked) throw Error('Link your VPZone broadcaster channel first');
    if (!/^[a-z0-9_-]{2,32}$/i.test(linked.display_name))
      throw Error('Invalid VPZone channel slug');
    const content = String(text || '')
      .trim()
      .slice(0, 300);
    if (!content) throw Error('Message is empty');
    const token = await vpzoneBotAccessToken();
    const url =
      'https://vpzone.tv/api/v1/channels/' + encodeURIComponent(linked.display_name) + '/chat';
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) {
      const reason = (await response.text()).slice(0, 280);
      if (response.status === 401 || response.status === 403)
        throw Error(
          'VPZone bot chat permission denied (' +
            response.status +
            '). Reconnect the dedicated bot with chat:write. ' +
            reason
        );
      throw Error('VPZone bot message failed (' + response.status + '): ' + reason);
    }
    log(channel, 'vpzone-bot-message', linked.display_name);
    return { ok: true };
  }
  relay.register('vpzone', vpzoneBotSay);
  streamActivity.setSender('vpzone', vpzoneBotSay);
  app.post(
    '/api/platforms/vpzone/chat',
    withUser,
    access.channelOnly('owner'),
    csrf,
    safe(async (req, res) => {
      res.json(await vpzoneBotSay(req.channelId, req.body?.message));
    })
  );
  // Poll VPZone's published recent engagement endpoints for channel events.
  // Stable remote IDs deduplicate results; skip stale history on first deployment.
  let polling = false;
  async function pollVpzoneActivity() {
    if (polling) return;
    polling = true;
    try {
      const accounts = db
        .prepare("SELECT channel,display_name FROM platform_oauth WHERE platform='vpzone'")
        .all();
      for (const account of accounts) {
        if (!/^[a-z0-9_-]{2,32}$/i.test(account.display_name)) continue;
        let token;
        try {
          token = await refresh(account.channel, 'vpzone');
        } catch (err) {
          log(account.channel, 'vpzone-activity-auth', err.message);
          continue;
        }
        for (const [endpoint, type] of [
          ['follows/recent', 'follow'],
          ['subscriptions/recent', 'subscription'],
          ['raids/recent', 'raid'],
          ['pixels/recent', 'donation']
        ]) {
          try {
            const uri =
              'https://vpzone.tv/api/v1/channels/' +
              encodeURIComponent(account.display_name) +
              '/' +
              endpoint;
            const response = await fetch(uri, {
              headers: { Authorization: 'Bearer ' + token },
              signal: AbortSignal.timeout(9000)
            });
            if (!response.ok) {
              if (response.status !== 404 && response.status !== 403)
                log(account.channel, 'vpzone-activity-http', type + ': ' + response.status);
              continue;
            }
            const body = await response.json();
            const list = Array.isArray(body.data)
              ? body.data
              : Array.isArray(body.data?.items)
                ? body.data.items
                : Array.isArray(body.items)
                  ? body.items
                  : [];
            for (const item of list.slice(0, 40)) {
              const eventId = String(item.id || item.event_id || '');
              if (!eventId) continue;
              const at = Date.parse(String(item.created_at || item.timestamp || ''));
              if (Number.isFinite(at) && Date.now() - at > 86400000) continue;
              const actor = String(
                item.username ||
                  item.user?.username ||
                  item.sender?.username ||
                  item.from?.username ||
                  ''
              );
              const detail = String(item.amount || item.quantity || item.tier || item.title || '');
              streamActivity.emit(
                account.channel,
                'vpzone',
                type,
                actor,
                detail,
                account.display_name + ':' + endpoint + ':' + eventId
              );
            }
          } catch (err) {
            log(account.channel, 'vpzone-activity-error', type + ': ' + err.message);
          }
        }
      }
    } finally {
      polling = false;
    }
  }
  const activityTimer = setInterval(() => {
    void pollVpzoneActivity().catch(err => console.error('VPZone activity poll', err.message));
  }, 60000);
  activityTimer.unref?.();
  setImmediate(() => {
    void pollVpzoneActivity().catch(err => console.error('VPZone activity poll', err.message));
  });
  function chatStatus(channel) {
    const linked = Boolean(
      db.prepare("SELECT 1 FROM platform_oauth WHERE channel=? AND platform='vpzone'").get(channel)
    );
    const vp = vpSockets.get(channel);
    return {
      status: !linked
        ? 'pending'
        : vp?.ws?.readyState === WebSocket.OPEN
          ? 'connected'
          : vp?.ws?.readyState === WebSocket.CONNECTING
            ? 'pending'
            : 'failed',
      detail: linked ? 'Live chat WebSocket' : 'Connect VPZone'
    };
  }
  const isChatOpen = channel => vpSockets.get(channel)?.ws?.readyState === WebSocket.OPEN;
  return { connect: vpzoneConnect, disconnect: vpzoneDisconnect, chatStatus, isChatOpen };
}
