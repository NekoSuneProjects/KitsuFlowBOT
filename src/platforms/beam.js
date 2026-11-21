// BEAM (beamstream.gg) integration: broadcaster OAuth link, a dedicated bot account for chat
// output, and server-sent events for incoming chat, follows, raids and support.
//
// BEAM specifics (from https://developers.beamstream.gg/openapi.json):
// - OAuth 2.0 authorization code with PKCE (S256). Codes are single use and expire in 60 s.
//   Refresh tokens rotate; reusing a rotated one revokes the whole authorization, so a new
//   refresh token is always stored before it is used.
// - POST /v1/chat/rooms/{room}/messages sends as the grant's user. A broadcaster's token would
//   post as the broadcaster, so bot messages use a separate BEAM account an admin links once.
// - GET /v1/events/sse?topic=... streams events for the granted channel (one topic per
//   connection): `id:` cursor, `event:` type, `data:` JSON envelope. A comment line arrives at
//   least every 15 s. Control events: beam.reconnect, beam.gap, beam.capped, beam.error.
// - BEAM unifies chat and support from other platforms (author.platform = 'twitch', ...).
//   KitsuFlowBOT already receives those platforms directly, so only platform 'beam' is used.
// - The public API has no ban/timeout endpoints, so moderation commands are not available.
import crypto from 'node:crypto';
import { pkce, hash } from './oauth.js';

const CHANNEL_ID = /^chan_(?:test_)?[1-9][0-9]{0,19}$/;
const ROOM_ID = /^room_(?:test_)?[1-9][0-9]{0,19}$/;
const clean = (value, max = 250) =>
  String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);

// Event types read per SSE topic. Chat uses the channel's room; the others use the channel.
const TOPICS = {
  chat: ['chat.message.created'],
  channel: ['channel.follow.created', 'channel.raid.created'],
  support: [
    'support.tip.created',
    'support.chat_item.created',
    'support.subscription.created',
    'support.gift.created',
    'support.redemption.created'
  ]
};
const KEEPALIVE_TIMEOUT_MS = 45000; // BEAM sends a comment at least every 15 s.

function config() {
  const url = (name, fallback) => String(process.env[name] || fallback).replace(/\/+$/, '');
  return {
    api: url('BEAM_API_URL', 'https://api.beamstream.gg'),
    authorize: url('BEAM_AUTHORIZE_URL', 'https://beamstream.gg/oauth/authorize'),
    clientId: String(process.env.BEAM_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.BEAM_CLIENT_SECRET || '').trim(),
    scope: String(process.env.BEAM_AUTH_SCOPES || 'channel:read chat:read support:read').trim(),
    botScope: String(process.env.BEAM_BOT_SCOPES || 'profile chat:write').trim()
  };
}
const configured = cfg => Boolean(cfg.clientId && cfg.clientSecret);

// Converts a BEAM amount ({value, decimals, currency, type}) to a display string and a number.
function money(amount) {
  if (!amount || !Number.isFinite(Number(amount.value))) return { text: '', value: 0 };
  const value = Number(amount.value) / 10 ** Math.max(0, Number(amount.decimals) || 0);
  const unit = amount.type === 'fiat' ? String(amount.currency || '').toUpperCase() : amount.type;
  return { text: (value + ' ' + (unit || '')).trim(), value };
}

// BEAM roles are set by BEAM, so they can gate KitsuFlowBOT command levels.
function allowedLevel(level, roles) {
  const has = role => roles.includes(role);
  if (level === 'everyone') return true;
  if (has('broadcaster') || has('moderator')) return true;
  return level === 'subscriber' && (has('subscriber') || has('vip'));
}

export function installBeam({
  app,
  db,
  withUser,
  csrf,
  access,
  enc,
  dec,
  log,
  base,
  isOperator,
  relay,
  streamActivity
}) {
  // platform_oauth / platform_bot_accounts / provider_accounts come from platforms/index.js
  // and access.js. BEAM also needs the channel's chat room id.
  db.exec(
    'CREATE TABLE IF NOT EXISTS beam_channels(channel TEXT PRIMARY KEY,beam_channel_id TEXT NOT NULL,room_id TEXT NOT NULL,name TEXT NOT NULL,updated_at INTEGER NOT NULL)'
  );
  const linkedRow = channel =>
    db
      .prepare(
        "SELECT o.external_id,o.display_name,o.scopes,b.room_id,b.name FROM platform_oauth o LEFT JOIN beam_channels b ON b.channel=o.channel WHERE o.channel=? AND o.platform='beam'"
      )
      .get(channel);
  const botRow = () =>
    db
      .prepare("SELECT external_id,display_name FROM platform_bot_accounts WHERE platform='beam'")
      .get();
  const safe = fn => (req, res) =>
    Promise.resolve(fn(req, res)).catch(e => {
      console.error('beam:', e.message);
      res.status(400).json({ error: e.message });
    });
  const requireAdmin = (req, res, next) =>
    isOperator(req.session.uid) ? next() : res.status(403).json({ error: 'Admin access required' });
  const redirectUri = kind =>
    base + (kind === 'bot' ? '/auth/beam-bot/callback' : '/auth/beam/callback');

  // ---- HTTP helpers ----
  const problemText = (body, status) =>
    clean(body?.detail || body?.title || body?.code || body?.error || 'HTTP ' + status, 200);

  async function tokenRequest(params) {
    const cfg = config();
    const response = await fetch(cfg.api + '/oauth/token', {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        ...params,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret
      }),
      signal: AbortSignal.timeout(12000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(
        'BEAM token endpoint returned ' +
          response.status +
          ': ' +
          problemText(body, response.status)
      );
    if (!body.access_token || !body.refresh_token)
      throw Error('BEAM did not return renewable tokens');
    return body;
  }
  const expiry = token => Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000;

  // Token storage for the broadcaster grant (platform_oauth) and the bot (platform_bot_accounts).
  const stores = {
    channel: {
      read: channel =>
        db
          .prepare(
            "SELECT access_token,refresh_token,expires_at FROM platform_oauth WHERE channel=? AND platform='beam'"
          )
          .get(channel),
      write: (channel, t) =>
        db
          .prepare(
            "UPDATE platform_oauth SET access_token=?,refresh_token=?,expires_at=?,scopes=? WHERE channel=? AND platform='beam'"
          )
          .run(enc(t.access_token), enc(t.refresh_token), expiry(t), String(t.scope || ''), channel)
    },
    bot: {
      read: () =>
        db
          .prepare(
            "SELECT access_token,refresh_token,expires_at FROM platform_bot_accounts WHERE platform='beam'"
          )
          .get(),
      write: (_, t) =>
        db
          .prepare(
            "UPDATE platform_bot_accounts SET access_token=?,refresh_token=?,expires_at=? WHERE platform='beam'"
          )
          .run(enc(t.access_token), enc(t.refresh_token), expiry(t))
    }
  };
  // Parallel refreshes would reuse a rotated refresh token and revoke the grant: share one.
  const refreshing = new Map();
  async function accessToken(kind, channel, force = false) {
    const row = stores[kind].read(channel);
    if (!row)
      throw Error(
        kind === 'bot'
          ? 'BEAM bot account is not connected. Link it in Admin Panel.'
          : 'Link your BEAM channel first'
      );
    if (!force && row.expires_at > Date.now() + 120000) return dec(row.access_token);
    const key = kind + ':' + (channel || '');
    if (refreshing.has(key)) return refreshing.get(key);
    const job = (async () => {
      let token;
      try {
        token = await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: dec(row.refresh_token)
        });
      } catch (err) {
        throw Error(
          err.message +
            (kind === 'bot'
              ? '. Reconnect the BEAM bot in Admin Panel.'
              : '. Reconnect BEAM in Connections.')
        );
      }
      stores[kind].write(channel, token);
      return token.access_token;
    })().finally(() => refreshing.delete(key));
    refreshing.set(key, job);
    return job;
  }

  // Calls the BEAM API with a stored grant, refreshing once on 401.
  async function beamApi(kind, channel, path, { method = 'GET', body, headers = {} } = {}) {
    const cfg = config();
    const send = token =>
      fetch(cfg.api + path, {
        method,
        redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(12000)
      });
    let response = await send(await accessToken(kind, channel));
    if (response.status === 401) response = await send(await accessToken(kind, channel, true));
    const data = await response.json().catch(() => ({}));
    return {
      status: response.status,
      ok: response.ok,
      data,
      retryAfter: response.headers.get('retry-after')
    };
  }

  // ---- chat output through the BEAM bot account ----
  async function say(channel, text) {
    if (!configured(config())) throw Error('BEAM is not configured on this server');
    const linked = linkedRow(channel);
    if (!linked?.room_id || !ROOM_ID.test(linked.room_id))
      throw Error('Link your BEAM channel first');
    if (!botRow()) throw Error('BEAM bot account is not connected. Link it in Admin Panel.');
    const message = String(text || '')
      .trim()
      .slice(0, 500);
    if (!message) throw Error('Message is empty');
    const { status, ok, data, retryAfter } = await beamApi(
      'bot',
      null,
      '/v1/chat/rooms/' + encodeURIComponent(linked.room_id) + '/messages',
      {
        method: 'POST',
        body: { text: message },
        headers: { 'Idempotency-Key': crypto.randomUUID() }
      }
    );
    if (ok) {
      log(channel, 'beam-bot-message', status === 202 ? 'held by automod' : linked.display_name);
      return { ok: true, held: status === 202 };
    }
    const reason = problemText(data, status);
    if (status === 429)
      throw Error('BEAM slow mode/rate limit: retry in ' + (retryAfter || '?') + 's');
    if (status === 403 && /chat_(banned|timed_out|restricted)/.test(String(data.code)))
      throw Error(
        'The BEAM bot cannot chat in this channel (' +
          data.code +
          '). Unban it or remove chat restrictions.'
      );
    throw Error('BEAM chat failed (' + status + '): ' + reason);
  }

  // ---- custom commands from BEAM chat ----
  const cooldowns = new Map();
  async function command(channel, author, text) {
    const parts = text.split(/\s+/),
      name = parts[0]?.toLowerCase();
    if (!name?.startsWith('!')) return;
    const key = name.slice(1);
    if (!/^[a-z0-9_]{1,32}$/.test(key)) return;
    const cmd = db
      .prepare('SELECT response,cooldown,level FROM commands WHERE channel=? AND name=?')
      .get(channel, key);
    if (!cmd || !allowedLevel(cmd.level, author.roles || []) || !botRow()) return;
    const throttle = channel + ':beam:' + key,
      now = Date.now();
    if ((cooldowns.get(throttle) || 0) > now) return;
    cooldowns.set(throttle, now + Math.max(0, Number(cmd.cooldown) || 0) * 1000);
    if (cooldowns.size > 2000) for (const [k, t] of cooldowns) if (t < now) cooldowns.delete(k);
    const owner = db.prepare('SELECT login FROM channels WHERE id=?').get(channel)?.login || '';
    await say(
      channel,
      String(cmd.response)
        .replaceAll('{user}', clean(author.name, 40))
        .replaceAll('{channel}', owner)
        .replaceAll('{args}', parts.slice(1).join(' '))
    );
    log(channel, 'beam-command', key);
  }

  // ---- incoming events ----
  function alertRelay(channel, actor, text) {
    void relay
      .relay(channel, 'beam', actor || 'beam', text, { kind: 'alerts' })
      .catch(err => log(channel, 'beam-relay-error', err.message));
  }
  function handleEvent(channel, envelope) {
    const type = String(envelope?.type || ''),
      object = envelope?.data?.object || {},
      eventId = String(envelope?.id || '') || null;
    if (type === 'chat.message.created') {
      const author = object.author || {};
      // Messages unified from Twitch/YouTube/... already arrive through those integrations.
      if (author.platform !== 'beam') return;
      const bot = botRow();
      if (bot && author.channel_id && author.channel_id === bot.external_id) return;
      const text = clean(object.text, 350);
      const name = clean(author.name, 40);
      if (!text || !name) return;
      void relay
        .relay(channel, 'beam', name, text, { isBot: false })
        .catch(err => log(channel, 'beam-relay-error', err.message));
      void command(channel, author, text).catch(err =>
        log(channel, 'beam-command-error', err.message)
      );
      return;
    }
    if (type === 'channel.follow.created' || type === 'channel.raid.created') {
      if (object.platform !== 'beam') return;
      const actor = clean(object.actor?.name, 100);
      const kind = type === 'channel.follow.created' ? 'follow' : 'raid';
      streamActivity.emit(channel, 'beam', kind, actor, '', eventId);
      alertRelay(
        channel,
        actor,
        actor + (kind === 'follow' ? ' followed on BEAM' : ' raided on BEAM')
      );
      return;
    }
    if (type.startsWith('support.')) {
      if (object.platform !== 'beam' || object.reverses) return;
      const actor = clean(object.supporter?.name, 100) || 'Supporter';
      const amount = money(object.amount);
      const sub = object.subscription || {};
      let kind, detail;
      if (type === 'support.subscription.created') {
        kind = Number(sub.months) > 1 ? 'subscription_renewal' : 'subscription';
        detail = clean(
          [
            sub.tier,
            sub.months ? sub.months + (Number(sub.months) === 1 ? ' month' : ' months') : ''
          ]
            .filter(Boolean)
            .join(' · '),
          90
        );
      } else if (type === 'support.gift.created') {
        kind = 'subscription_gift';
        detail = String(sub.count || 1);
      } else if (type === 'support.redemption.created') {
        kind = 'reward';
        detail = clean(object.reward?.name, 90);
      } else {
        // Tips and paid chat items: Embers/Sparks behave like Bits; fiat is a donation.
        kind = ['embers', 'sparks'].includes(object.amount?.type) ? 'cheer' : 'donation';
        detail = kind === 'cheer' ? String(amount.value) : amount.text;
        if (object.item?.name) detail = clean(detail + ' · ' + object.item.name, 120);
      }
      streamActivity.emit(channel, 'beam', kind, actor, detail, eventId);
      alertRelay(
        channel,
        actor,
        clean(actor + ' ' + kind.replaceAll('_', ' ') + (detail ? ' (' + detail + ')' : ''), 300)
      );
    }
  }

  // One SSE connection per topic per linked channel, resumed with the last cursor.
  const streams = new Map(); // channel -> {sources, controllers, cursors, timers, status, failures}
  function stop(channel) {
    const entry = streams.get(channel);
    if (!entry) return;
    streams.delete(channel);
    for (const t of Object.values(entry.timers)) clearTimeout(t);
    for (const c of Object.values(entry.controllers)) c?.abort();
  }
  function connect(channel) {
    const linked = linkedRow(channel);
    if (!configured(config()) || !linked?.room_id || !CHANNEL_ID.test(String(linked.external_id)))
      return;
    stop(channel);
    const entry = {
      beamChannel: linked.external_id,
      room: linked.room_id,
      controllers: {},
      cursors: {},
      timers: {},
      status: {},
      failures: {}
    };
    streams.set(channel, entry);
    for (const topic of Object.keys(TOPICS)) openTopic(channel, entry, topic);
  }
  function schedule(channel, entry, topic, ms) {
    if (streams.get(channel) !== entry) return;
    clearTimeout(entry.timers[topic]);
    entry.timers[topic] = setTimeout(() => openTopic(channel, entry, topic), ms);
    entry.timers[topic].unref?.();
  }
  function backoff(entry, topic) {
    const n = (entry.failures[topic] = (entry.failures[topic] || 0) + 1);
    return Math.min(300000, 5000 * 2 ** Math.min(n - 1, 6)) + Math.floor(Math.random() * 2000);
  }
  async function openTopic(channel, entry, topic) {
    if (streams.get(channel) !== entry) return;
    const cfg = config();
    const query = new URLSearchParams({ topic });
    if (topic === 'chat') query.append('room', entry.room);
    else query.append('channel', entry.beamChannel);
    for (const type of TOPICS[topic]) query.append('types', type);
    if (entry.cursors[topic]) query.set('after', entry.cursors[topic]);
    const controller = new AbortController();
    entry.controllers[topic] = controller;
    let watchdog;
    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), KEEPALIVE_TIMEOUT_MS);
      watchdog.unref?.();
    };
    let nextDelay = null;
    try {
      const token = await accessToken('channel', channel);
      arm();
      const response = await fetch(cfg.api + '/v1/events/sse?' + query, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'text/event-stream' },
        redirect: 'error',
        signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) await accessToken('channel', channel, true).catch(() => {});
        const permanent = [403, 404].includes(response.status);
        entry.status[topic] = {
          state: 'failed',
          detail: topic + ': ' + problemText(body, response.status)
        };
        if (entry.failures[topic] === undefined || entry.failures[topic] < 2)
          log(
            channel,
            'beam-sse-error',
            topic + ' ' + response.status + ' ' + problemText(body, response.status)
          );
        nextDelay = permanent ? 300000 : backoff(entry, topic);
        return;
      }
      entry.status[topic] = { state: 'connected', detail: 'Live events' };
      entry.failures[topic] = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '',
        event = { data: [] };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        arm();
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.search(/\r?\n/)) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + (buffer[index] === '\r' ? 2 : 1));
          if (line === '') {
            if (event.data.length) {
              const delay = dispatch(channel, entry, topic, event);
              if (delay !== undefined) {
                nextDelay = delay;
                controller.abort();
                return;
              }
            }
            event = { data: [] };
            continue;
          }
          if (line.startsWith(':')) continue; // keepalive comment
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          const data = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (field === 'data') event.data.push(data);
          else if (field === 'id') event.id = data;
          else if (field === 'event') event.event = data;
        }
      }
      nextDelay = 1000; // server closed the stream normally
    } catch (err) {
      if (streams.get(channel) !== entry) return;
      if (nextDelay === null) {
        entry.status[topic] = { state: 'pending', detail: 'Reconnecting' };
        nextDelay = backoff(entry, topic);
      }
    } finally {
      clearTimeout(watchdog);
      if (nextDelay !== null) schedule(channel, entry, topic, nextDelay);
    }
  }
  // Handles one SSE event. Returns a reconnect delay when the connection should be reopened.
  function dispatch(channel, entry, topic, event) {
    let payload;
    try {
      payload = JSON.parse(event.data.join('\n'));
    } catch {
      return undefined;
    }
    if (event.event === 'beam.reconnect') return Math.max(0, Number(payload.after_ms) || 1000);
    if (event.event === 'beam.error') {
      const code = String(payload.code || '');
      entry.status[topic] = {
        state: 'failed',
        detail: topic + ': ' + clean(payload.message || code, 120)
      };
      log(channel, 'beam-sse-error', topic + ' ' + code);
      return code === 'credential_revoked' ? 300000 : backoff(entry, topic);
    }
    if (event.event === 'beam.gap' || event.event === 'beam.capped') {
      if (event.event === 'beam.gap') log(channel, 'beam-sse-gap', topic + ': events were skipped');
      return undefined;
    }
    if (event.id) entry.cursors[topic] = event.id;
    try {
      handleEvent(channel, payload);
    } catch (err) {
      log(channel, 'beam-event-error', err.message);
    }
    return undefined;
  }
  const chatStatus = channel => {
    const linked = linkedRow(channel);
    if (!linked) return { status: 'pending', detail: 'Connect BEAM' };
    const entry = streams.get(channel);
    if (!entry) return { status: 'failed', detail: 'Event listener stopped' };
    const states = Object.keys(TOPICS).map(
      t => entry.status[t] || { state: 'pending', detail: 'Connecting' }
    );
    const failed = states.find(s => s.state === 'failed');
    if (failed) return { status: 'failed', detail: failed.detail };
    if (states.every(s => s.state === 'connected'))
      return { status: 'connected', detail: 'Live events' };
    return { status: 'pending', detail: 'Connecting' };
  };

  // ---- OAuth (broadcaster and bot) ----
  function startAuthorize(req, res, kind, extra) {
    const cfg = config();
    if (!configured(cfg)) throw Error('BEAM OAuth is not configured on this server');
    const state = pkce(),
      verifier = pkce();
    req.session.beamOAuth = {
      kind,
      state,
      verifier,
      owner: req.session.uid,
      expires: Date.now() + 600000,
      ...extra
    };
    res.redirect(
      cfg.authorize +
        '?' +
        new URLSearchParams({
          response_type: 'code',
          client_id: cfg.clientId,
          redirect_uri: redirectUri(kind),
          scope: kind === 'bot' ? cfg.botScope : cfg.scope,
          state,
          code_challenge: hash(verifier),
          code_challenge_method: 'S256'
        })
    );
  }
  function finishAuthorize(req, kind) {
    const o = req.session.beamOAuth;
    delete req.session.beamOAuth;
    if (
      !o ||
      o.kind !== kind ||
      o.state !== req.query.state ||
      o.expires < Date.now() ||
      o.owner !== req.session.uid
    )
      throw Error('Invalid or expired BEAM authorisation session');
    if (req.query.error) return { denied: true, o };
    if (!req.query.code) throw Error('BEAM did not return an authorisation code');
    return { o };
  }
  async function exchange(kind, code, verifier) {
    return tokenRequest({
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: redirectUri(kind),
      code_verifier: verifier
    });
  }
  async function getWithToken(path, token) {
    const response = await fetch(config().api + path, {
      redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(
        'BEAM ' + path + ' returned ' + response.status + ': ' + problemText(body, response.status)
      );
    return body;
  }
  async function revoke(token) {
    const cfg = config();
    await fetch(cfg.api + '/oauth/revoke', {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret
      }),
      signal: AbortSignal.timeout(8000)
    }).catch(() => {});
  }

  app.get(
    '/auth/beam',
    withUser,
    safe(async (req, res) => {
      const channel = access.channelFor(req);
      if (!channel || !access.can(req.session.uid, channel, 'owner'))
        return res.status(403).json({ error: 'Channel owner required' });
      startAuthorize(req, res, 'channel', { channel });
    })
  );
  app.get(
    '/auth/beam/callback',
    withUser,
    safe(async (req, res) => {
      const { denied, o } = finishAuthorize(req, 'channel');
      if (!access.can(req.session.uid, o.channel, 'owner')) throw Error('Channel owner required');
      if (denied) return res.redirect('/dashboard?beam=denied');
      const token = await exchange('channel', req.query.code, o.verifier);
      const beamChannel = await getWithToken('/v1/channels/@me', token.access_token);
      if (
        !CHANNEL_ID.test(String(beamChannel.id)) ||
        !ROOM_ID.test(String(beamChannel.default_chat_room_id))
      )
        throw Error('BEAM did not return a channel for this account');
      const bot = botRow();
      if (bot && bot.external_id === beamChannel.id)
        throw Error('This BEAM account is the shared bot. Connect your own broadcaster account.');
      const slug = clean(beamChannel.slug, 255);
      db.transaction(() => {
        db.prepare(
          'INSERT INTO platform_oauth(channel,platform,external_id,display_name,access_token,refresh_token,expires_at,scopes) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(channel,platform) DO UPDATE SET external_id=excluded.external_id,display_name=excluded.display_name,access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,scopes=excluded.scopes'
        ).run(
          o.channel,
          'beam',
          beamChannel.id,
          slug,
          enc(token.access_token),
          enc(token.refresh_token),
          expiry(token),
          String(token.scope || '')
        );
        db.prepare(
          'INSERT INTO beam_channels(channel,beam_channel_id,room_id,name,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(channel) DO UPDATE SET beam_channel_id=excluded.beam_channel_id,room_id=excluded.room_id,name=excluded.name,updated_at=excluded.updated_at'
        ).run(
          o.channel,
          beamChannel.id,
          beamChannel.default_chat_room_id,
          clean(beamChannel.name, 255),
          Date.now()
        );
        db.prepare(
          'INSERT OR REPLACE INTO provider_accounts(id,channel,platform,external_id,display_name,status) VALUES(?,?,?,?,?,?)'
        ).run(o.channel + ':beam', o.channel, 'beam', beamChannel.id, slug, 'connected');
      })();
      log(o.channel, 'provider-linked', 'beam ' + slug);
      connect(o.channel);
      res.redirect('/dashboard?connected=beam');
    })
  );
  app.get('/api/beam', withUser, access.channelOnly('owner'), (req, res) => {
    const linked = linkedRow(req.channelId),
      bot = botRow();
    res.set('Cache-Control', 'no-store').json({
      configured: configured(config()),
      linked: linked
        ? {
            slug: linked.display_name,
            name: linked.name,
            channel_id: linked.external_id,
            scopes: linked.scopes
          }
        : null,
      bot: bot ? { display_name: bot.display_name } : null,
      chat: chatStatus(req.channelId)
    });
  });
  app.post(
    '/api/beam/disconnect',
    withUser,
    access.channelOnly('owner'),
    csrf,
    safe(async (req, res) => {
      stop(req.channelId);
      const row = stores.channel.read(req.channelId);
      if (row) await revoke(dec(row.refresh_token));
      db.prepare("DELETE FROM platform_oauth WHERE channel=? AND platform='beam'").run(
        req.channelId
      );
      db.prepare('DELETE FROM beam_channels WHERE channel=?').run(req.channelId);
      db.prepare("DELETE FROM provider_accounts WHERE channel=? AND platform='beam'").run(
        req.channelId
      );
      log(req.channelId, 'provider-disconnected', 'beam');
      res.json({ ok: true });
    })
  );
  app.post(
    '/api/beam/chat',
    withUser,
    access.channelOnly('owner'),
    csrf,
    safe(async (req, res) => {
      res.json(
        await say(
          req.channelId,
          req.body?.message || 'KitsuFlowBOT chat test: BEAM messaging is connected.'
        )
      );
    })
  );

  // Shared bot account, linked once by a platform administrator.
  app.get('/api/admin/beam/bot', withUser, requireAdmin, (req, res) => {
    const bot = botRow();
    res.set('Cache-Control', 'no-store').json({
      configured: configured(config()),
      bot: bot ? { display_name: bot.display_name } : null
    });
  });
  app.get(
    '/auth/beam-bot',
    withUser,
    requireAdmin,
    safe(async (req, res) => startAuthorize(req, res, 'bot', {}))
  );
  app.get(
    '/auth/beam-bot/callback',
    withUser,
    requireAdmin,
    safe(async (req, res) => {
      const { denied, o } = finishAuthorize(req, 'bot');
      if (denied) return res.redirect('/dashboard?bot=beam-denied');
      const token = await exchange('bot', req.query.code, o.verifier);
      const user = await getWithToken('/v1/users/@me', token.access_token);
      const id = String(user.channel_id || user.id || '');
      if (!id) throw Error('BEAM did not return the bot identity');
      if (
        db.prepare("SELECT 1 FROM platform_oauth WHERE platform='beam' AND external_id=?").get(id)
      )
        throw Error('The BEAM bot must be a separate account, not a linked broadcaster');
      db.prepare(
        'INSERT INTO platform_bot_accounts(platform,external_id,display_name,access_token,refresh_token,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(platform) DO UPDATE SET external_id=excluded.external_id,display_name=excluded.display_name,access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at'
      ).run(
        'beam',
        id,
        clean(user.name, 80) || 'BEAM bot',
        enc(token.access_token),
        enc(token.refresh_token),
        expiry(token)
      );
      log(req.session.uid, 'beam-bot-configured', clean(user.name, 80));
      res.redirect('/dashboard?bot=beam');
    })
  );
  app.post(
    '/api/admin/beam/bot/disconnect',
    withUser,
    requireAdmin,
    csrf,
    safe(async (req, res) => {
      const row = stores.bot.read();
      if (row) await revoke(dec(row.refresh_token));
      db.prepare("DELETE FROM platform_bot_accounts WHERE platform='beam'").run();
      res.json({ ok: true });
    })
  );

  relay.register('beam', say);
  streamActivity.setSender('beam', say);
  // Restore event listeners after restarts.
  for (const row of db.prepare("SELECT channel FROM platform_oauth WHERE platform='beam'").all())
    connect(row.channel);
  return { chatStatus, say };
}
