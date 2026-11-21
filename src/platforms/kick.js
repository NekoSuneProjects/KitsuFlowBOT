import crypto from 'node:crypto';
import { conf, clean, platformSafe as safe } from './oauth.js';

// Kick: signed webhook receiver (engagement events + chat), event-subscription provisioning,
// custom commands and bot-mode chat output through the creator's own Kick grant.
export function createKick({
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
  db.exec(
    "CREATE TABLE IF NOT EXISTS kick_chat_status(channel TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'pending',detail TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL DEFAULT 0)"
  );
  const commandCooldowns = new Map();
  async function kickIncomingCommand(channel, event) {
    const body = String(event.content || '').trim(),
      sender = event.sender || {};
    const parts = body.split(/\\s+/),
      name = parts[0]?.toLowerCase();
    if (!name?.startsWith('!')) return;
    const key = name.slice(1);
    if (!/^[a-z0-9_]{1,32}$/.test(key)) return;
    const cmd = db
      .prepare('SELECT name,response,cooldown,level FROM commands WHERE channel=? AND name=?')
      .get(channel, key);
    if (!cmd || cmd.level !== 'everyone') return;
    const ck = channel + ':kick:' + key,
      now = Date.now();
    if ((commandCooldowns.get(ck) || 0) > now) return;
    commandCooldowns.set(ck, now + Math.max(0, Number(cmd.cooldown) || 0) * 1000);
    const username = clean(sender.username || 'viewer');
    const reply = String(cmd.response)
      .replaceAll('{user}', username)
      .replaceAll(
        '{channel}',
        db.prepare('SELECT login FROM channels WHERE id=?').get(channel)?.login || ''
      )
      .replaceAll('{args}', parts.slice(1).join(' '))
      .slice(0, 500);
    await kickBotSay(channel, reply);
    log(channel, 'kick-command', key);
  }
  async function subscribeKickChat(channel) {
    const account = db
      .prepare("SELECT external_id,scopes FROM platform_oauth WHERE platform='kick' AND channel=?")
      .get(channel);
    if (!account) return;
    const status = (state, detail) =>
      db
        .prepare(
          'INSERT INTO kick_chat_status(channel,status,detail,updated_at) VALUES(?,?,?,?) ON CONFLICT(channel) DO UPDATE SET status=excluded.status,detail=excluded.detail,updated_at=excluded.updated_at'
        )
        .run(channel, state, String(detail).slice(0, 240), Date.now());
    if (process.env.KICK_WEBHOOK_ENABLED === 'false')
      return status('disabled', 'KICK_WEBHOOK_ENABLED=false');
    if (
      !String(account.scopes || '')
        .split(/[\s,]+/)
        .includes('events:subscribe')
    )
      return status(
        'missing_scope',
        'Stored Kick OAuth grant lacks events:subscribe; reauthorise the linked broadcaster in Connections. Saved: ' +
          String(account.scopes || '(none)')
      );
    try {
      const token = await refresh(channel, 'kick');
      const url = 'https://api.kick.com/public/v1/events/subscriptions';
      const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw Error('List subscriptions HTTP ' + response.status);
      const data = await response.json();
      const rows = Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.data?.subscriptions)
          ? data.data.subscriptions
          : [];
      const wanted = [
        'chat.message.sent',
        'channel.followed',
        'channel.subscription.new',
        'channel.subscription.renewal',
        'channel.subscription.gifts',
        'kicks.gifted'
      ];
      const existing = new Set(rows.map(x => String(x.event?.name || x.event || x.name || '')));
      const missing = wanted.filter(name => !existing.has(name));
      if (!missing.length)
        return status('subscribed', 'Chat and engagement subscriptions already registered');
      const created = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          broadcaster_user_id: Number(account.external_id),
          method: 'webhook',
          events: missing.map(name => ({ name, version: 1 }))
        }),
        signal: AbortSignal.timeout(12000)
      });
      if (!created.ok)
        throw Error(
          'Create Kick subscriptions HTTP ' +
            created.status +
            ' ' +
            (await created.text()).slice(0, 150)
        );
      status('subscribed', 'Chat and engagement subscriptions requested: ' + missing.join(', '));
      log(channel, 'kick-event-subscriptions', 'registered: ' + missing.join(', '));
    } catch (err) {
      status('error', err.message);
      log(channel, 'kick-subscription-error', err.message);
    }
  }
  app.post(
    '/api/platforms/kick/subscribe',
    withUser,
    access.channelOnly('owner'),
    csrf,
    safe(async (req, res) => {
      await subscribeKickChat(req.channelId);
      res.json(
        db
          .prepare('SELECT status,detail,updated_at FROM kick_chat_status WHERE channel=?')
          .get(req.channelId)
      );
    })
  );
  app.get('/api/platforms/kick/scopes', withUser, access.channelOnly('owner'), (req, res) => {
    const account = db
      .prepare("SELECT scopes FROM platform_oauth WHERE channel=? AND platform='kick'")
      .get(req.channelId);
    const requested = String(conf('kick')?.scope || '')
      .split(/[\s,]+/)
      .filter(Boolean);
    const stored = String(account?.scopes || '')
      .split(/[\s,]+/)
      .filter(Boolean);
    res.set('Cache-Control', 'no-store').json({
      linked: Boolean(account),
      requested,
      stored,
      missing: requested.filter(scope => !stored.includes(scope)),
      requiresReauthorisation: !stored.includes('events:subscribe')
    });
  });
  async function kickBotSay(channel, text) {
    // Kick's official Chat API requires UserAccessToken with chat:write even when type='bot'.
    // Always use the OAuth grant for this creator's selected, linked Kick channel.
    const linked = db
      .prepare("SELECT external_id,scopes FROM platform_oauth WHERE channel=? AND platform='kick'")
      .get(channel);
    if (!linked || !/^[0-9]+$/.test(String(linked.external_id)))
      throw Error("Connect the selected creator's Kick channel through OAuth");
    if (
      !String(linked.scopes || '')
        .split(/\s+/)
        .includes('chat:write')
    )
      throw Error(
        "Kick chat:write permission missing. Reconnect this creator's Kick OAuth in Connections."
      );
    const content = String(text || '')
      .trim()
      .slice(0, 500);
    if (!content) throw Error('Empty Kick bot message');
    const send = async token => {
      const response = await fetch('https://api.kick.com/public/v1/chat', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, type: 'bot' }),
        signal: AbortSignal.timeout(12000)
      });
      return {
        status: response.status,
        ok: response.ok,
        detail: response.ok ? '' : (await response.text()).slice(0, 300)
      };
    };
    let result = await send(await refresh(channel, 'kick'));
    if (result.status === 401) {
      const row = db
        .prepare("SELECT refresh_token FROM platform_oauth WHERE channel=? AND platform='kick'")
        .get(channel);
      const p = conf('kick');
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
          'Kick linked channel token refresh rejected (' +
            response.status +
            '). Reconnect Kick through Connections.'
        );
      const t = await response.json();
      if (!t.access_token) throw Error('Kick did not issue a renewed channel token');
      db.prepare(
        "UPDATE platform_oauth SET access_token=?,refresh_token=?,expires_at=? WHERE channel=? AND platform='kick'"
      ).run(
        enc(t.access_token),
        enc(t.refresh_token || dec(row.refresh_token)),
        Date.now() + Number(t.expires_in || 3600) * 1000,
        channel
      );
      result = await send(t.access_token);
    }
    if (!result.ok)
      throw Error(
        'Kick bot-mode chat failed (' +
          result.status +
          '): ' +
          result.detail +
          '. Verify the linked Kick broadcaster granted chat:write and has app bot posting enabled.'
      );
    log(channel, 'kick-bot-message', 'oauth-bot-mode');
    return { ok: true, mode: 'oauth-bot' };
  }
  relay.register('kick', kickBotSay);
  streamActivity.setSender('kick', kickBotSay);
  app.post(
    '/api/platforms/kick/chat',
    withUser,
    access.channelOnly('owner'),
    csrf,
    safe(async (req, res) => {
      const result = await kickBotSay(req.channelId, req.body.message);
      res.json(result);
    })
  );
  // Kick signs the raw bytes using its rotating RSA public key.
  let kickKey = null,
    keyTime = 0;
  async function currentKickKey() {
    if (kickKey && Date.now() - keyTime < 3600000) return kickKey;
    const r = await fetch('https://api.kick.com/public/v1/public-key', {
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) throw Error('Kick public key retrieval failed');
    const j = await r.json();
    const pem = j.data?.public_key || j.public_key;
    if (!pem) throw Error('Kick public key missing');
    kickKey = crypto.createPublicKey(pem);
    keyTime = Date.now();
    return kickKey;
  }
  app.post(
    '/webhooks/kick',
    safe(async (req, res) => {
      if (process.env.KICK_WEBHOOK_ENABLED === 'false') return res.sendStatus(204);
      const msg = req.get('Kick-Event-Message-Id'),
        timestamp = req.get('Kick-Event-Message-Timestamp'),
        sig = req.get('Kick-Event-Signature'),
        kind = req.get('Kick-Event-Type');
      if (!msg || !timestamp || !sig || !kind || !Buffer.isBuffer(req.rawBody))
        return res.sendStatus(400);
      const time = Date.parse(timestamp);
      if (!Number.isFinite(time) || Math.abs(Date.now() - time) > 300000)
        return res.sendStatus(401);
      const signed = Buffer.concat([Buffer.from(msg + '.' + timestamp + '.'), req.rawBody]);
      const key = await currentKickKey();
      if (!crypto.verify('RSA-SHA256', signed, key, Buffer.from(sig, 'base64')))
        return res.sendStatus(401);
      if (
        db
          .prepare('SELECT 1 FROM platform_delivery WHERE platform=? AND message_id=?')
          .get('kick', msg)
      )
        return res.sendStatus(204);
      const event = JSON.parse(req.rawBody.toString('utf8'));
      const broadcaster = String(
        event.broadcaster?.user_id || event.broadcaster_user_id || event.broadcaster?.id || ''
      );
      const linked = db
        .prepare('SELECT channel FROM platform_oauth WHERE platform=? AND external_id=?')
        .get('kick', broadcaster);
      db.prepare('INSERT INTO platform_delivery(platform,message_id,created_at) VALUES(?,?,?)').run(
        'kick',
        msg,
        Date.now()
      );
      if (linked) {
        const actor = clean(
          event.follower?.username ||
            event.sender?.username ||
            event.user?.username ||
            event.subscriber?.username ||
            event.gifter?.username ||
            event.raid?.username ||
            ''
        );
        const detail = clean(
          [kind, actor, event.amount || event.gift?.amount || event.giftees?.length || '']
            .filter(Boolean)
            .join(' ')
        );
        db.prepare(
          'INSERT INTO platform_events(channel,platform,event_type,actor,detail) VALUES(?,?,?,?,?)'
        ).run(linked.channel, 'kick', kind, actor, detail);
        db.prepare('INSERT INTO overlay_events(channel,kind,message) VALUES(?,?,?)').run(
          linked.channel,
          kind,
          detail
        );
        streamActivity.emit(linked.channel, 'kick', kind, actor, detail, msg);
        log(linked.channel, 'kick-event', detail);
        if (kind === 'chat.message.sent' || kind === 'chat.message.created') {
          const body = String(event.content || event.message?.content || '').slice(0, 350);
          const bot = db
            .prepare('SELECT external_id FROM platform_bot_accounts WHERE platform=?')
            .get('kick');
          if (body) {
            const isBot = Boolean(
              (bot && String(event.sender?.user_id || event.sender?.id) === bot.external_id) ||
              event.sender?.is_bot === true ||
              (process.env.KICK_BOT_USERNAME &&
                String(event.sender?.username || '').toLowerCase() ===
                  process.env.KICK_BOT_USERNAME.toLowerCase())
            );
            if (!isBot && event.sender?.is_anonymous !== true) {
              void relay
                .relay(linked.channel, 'kick', event.sender?.username || actor, body, {
                  isBot: false,
                  fragments: event.fragments || []
                })
                .catch(err => log(linked.channel, 'relay-error', err.message));
              void kickIncomingCommand(linked.channel, event).catch(err =>
                log(linked.channel, 'kick-command-error', err.message)
              );
            }
          }
        }
      }
      db.prepare('DELETE FROM platform_delivery WHERE created_at<?').run(Date.now() - 86400000);
      res.sendStatus(204);
    })
  );
  setImmediate(() => {
    for (const row of db.prepare("SELECT channel FROM platform_oauth WHERE platform='kick'").all())
      void subscribeKickChat(row.channel);
  });
  function chatStatus(channel) {
    const kickLinked = Boolean(
      db.prepare("SELECT 1 FROM platform_oauth WHERE channel=? AND platform='kick'").get(channel)
    );
    const kick = db
      .prepare('SELECT status,detail FROM kick_chat_status WHERE channel=?')
      .get(channel);
    const kickStatus = !kickLinked
      ? 'pending'
      : kick?.status === 'subscribed'
        ? 'connected'
        : kick?.status === 'failed' || kick?.status === 'error' || kick?.status === 'missing_scope'
          ? 'failed'
          : 'pending';
    return {
      status: kickStatus,
      detail: kickLinked
        ? String(kick?.detail || 'Subscription awaiting confirmation').slice(0, 120)
        : 'Connect Kick'
    };
  }
  return { subscribe: subscribeKickChat, chatStatus };
}
