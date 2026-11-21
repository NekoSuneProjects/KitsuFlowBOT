// NekoLive integration: broadcaster OAuth link, chat output through the KitsuFlowBOT app's
// chatbot, and NekoLive's public chat WebSocket for incoming chat and alerts.
//
// NekoLive specifics (verified against the WEBLIVE source):
// - OAuth2 at /oauth2/authorize + /oauth2/token (authorization_code + rotating refresh tokens,
//   1 h access tokens). The token response is standard; identity comes from GET /api/oauth/me.
// - Chat output (preferred): POST /api/oauth/chat with the broadcaster's token and the bot:send
//   scope posts as the chatbot linked to the KitsuFlowBOT app in NekoLive /developers.
//   Approving bot:send grants that bot permission in the broadcaster's channel.
// - Chat output (fallback): POST /api/chatbot with a static bot token set in Admin Panel.
// - Chat input: wss://<host>/chat/channel/<name>. Reading needs no login. Messages arrive as
//   chat_message / chat_emotes with HTML-escaped text; alerts as follow, subscribe,
//   resubscribe, nyatreats, donations and raid_trigger. Bots post under their own name with
//   roles.bot = true.
import crypto from 'node:crypto';
import { WebSocket } from 'ws';

const SLUG = /^[A-Za-z0-9_.-]{1,64}$/;
const BOT_TOKEN = /^[a-f0-9]{64}$/i;
const clean = (value, max = 250) =>
  String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);
// chat_emotes payloads mix raw viewer text with <img alt="code"> markup. Never forward
// markup: keep each emote as :code: text and drop every other tag.
// NekoLive HTML-escapes chat text on the server; undo it so relays show the real characters.
const decodeEntities = value =>
  String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
const plain = html =>
  decodeEntities(
    String(html || '')
      .replace(/<img\b[^>]*\balt\s*=\s*"([^"]*)"[^>]*>/gi, (_, code) => ' :' + code + ': ')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim();
const hasScope = (row, scope) =>
  String(row?.scopes || '')
    .split(/[\s,]+/)
    .includes(scope);
// NekoLive alert type -> KitsuFlowBOT activity type (stream-activity accepts these as-is).
const ALERTS = {
  follow: 'follow',
  subscribe: 'subscription',
  resubscribe: 'subscription_renewal',
  nyatreats: 'cheer',
  donations: 'donation',
  raid_trigger: 'raid'
};

function config() {
  const raw = String(process.env.NEKOLIVE_BASE_URL || '').trim();
  let base = null;
  if (raw) {
    try {
      const u = new URL(raw);
      const local = u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
      if (u.protocol === 'https:' || local) base = u.origin;
    } catch {}
  }
  return {
    base,
    clientId: String(process.env.NEKOLIVE_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.NEKOLIVE_CLIENT_SECRET || '').trim(),
    scope: String(process.env.NEKOLIVE_AUTH_SCOPES || 'user:read channel:read bot:send').trim()
  };
}

export function installNekoLive({
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
  // platform_oauth and platform_bot_accounts are created by platforms/index.js.
  const linkedRow = channel =>
    db
      .prepare(
        "SELECT external_id,display_name,scopes FROM platform_oauth WHERE channel=? AND platform='nekolive'"
      )
      .get(channel);
  const botRow = () =>
    db
      .prepare(
        "SELECT display_name,access_token FROM platform_bot_accounts WHERE platform='nekolive'"
      )
      .get();
  const safe = fn => (req, res) =>
    Promise.resolve(fn(req, res)).catch(e => {
      console.error('nekolive:', e.message);
      res.status(400).json({ error: e.message });
    });
  const requireAdmin = (req, res, next) =>
    isOperator(req.session.uid) ? next() : res.status(403).json({ error: 'Admin access required' });
  const redirectUri = () => base + '/auth/nekolive/callback';

  // ---- OAuth tokens ----
  async function tokenRequest(params) {
    const cfg = config();
    const response = await fetch(cfg.base + '/oauth2/token', {
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
        'NekoLive token endpoint returned ' +
          response.status +
          (body.error ? ' (' + clean(body.error_description || body.error, 160) + ')' : '')
      );
    if (!body.access_token) throw Error('NekoLive did not return an access token');
    return body;
  }
  const expiry = token => Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000;

  // Refresh tokens rotate, so parallel refreshes for one channel share a single request.
  const refreshing = new Map();
  async function accessToken(channel, force = false) {
    const row = db
      .prepare(
        "SELECT access_token,refresh_token,expires_at FROM platform_oauth WHERE channel=? AND platform='nekolive'"
      )
      .get(channel);
    if (!row) throw Error('Link your NekoLive channel first');
    if (!force && row.expires_at > Date.now() + 120000) return dec(row.access_token);
    if (refreshing.has(channel)) return refreshing.get(channel);
    const job = (async () => {
      const refreshToken = dec(row.refresh_token);
      if (!refreshToken) throw Error('NekoLive grant expired. Reconnect NekoLive in Connections.');
      let token;
      try {
        token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
      } catch (err) {
        throw Error(err.message + '. Reconnect NekoLive in Connections.');
      }
      db.prepare(
        "UPDATE platform_oauth SET access_token=?,refresh_token=?,expires_at=?,scopes=COALESCE(?,scopes) WHERE channel=? AND platform='nekolive'"
      ).run(
        enc(token.access_token),
        enc(String(token.refresh_token || refreshToken)),
        expiry(token),
        token.scope ? String(token.scope) : null,
        channel
      );
      return token.access_token;
    })().finally(() => refreshing.delete(channel));
    refreshing.set(channel, job);
    return job;
  }

  // Calls /api/oauth/* as the linked broadcaster, refreshing once on 401.
  async function oauthApi(channel, path, { method = 'GET', body } = {}) {
    const cfg = config();
    const send = token =>
      fetch(cfg.base + path, {
        method,
        redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(12000)
      });
    let response = await send(await accessToken(channel));
    if (response.status === 401) response = await send(await accessToken(channel, true));
    const data = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, data };
  }

  // ---- chat output ----
  const canSend = channel => hasScope(linkedRow(channel), 'bot:send') || Boolean(botRow());

  async function say(channel, text) {
    const cfg = config();
    if (!cfg.base) throw Error('NEKOLIVE_BASE_URL is not configured');
    const linked = linkedRow(channel);
    if (!linked || !SLUG.test(linked.display_name)) throw Error('Link your NekoLive channel first');
    const message = String(text || '')
      .trim()
      .slice(0, 400);
    if (!message) throw Error('Message is empty');
    if (hasScope(linked, 'bot:send')) return sayAsApp(channel, linked, message);
    if (botRow()) return sayWithBotToken(channel, linked, message);
    throw Error(
      'NekoLive chat is not enabled for this channel. Reconnect NekoLive in Connections and approve "Add this app\'s chatbot to your channel".'
    );
  }

  // Posts as the chatbot linked to the KitsuFlowBOT app; NekoLive targets the broadcaster's channel.
  async function sayAsApp(channel, linked, message) {
    const { status, ok, data } = await oauthApi(channel, '/api/oauth/chat', {
      method: 'POST',
      body: { message }
    });
    if (ok && data.ok) {
      log(channel, 'nekolive-bot-message', data.channel || linked.display_name);
      return { ok: true, mode: 'app' };
    }
    const reason = clean(data.error_description || data.error || 'unknown error', 200);
    if (status === 400 && /chatbot/i.test(reason))
      throw Error(
        'The KitsuFlowBOT app on NekoLive has no chatbot linked. Link one to the app in NekoLive /developers. (' +
          reason +
          ')'
      );
    if (status === 403 && data.error === 'insufficient_scope')
      throw Error('NekoLive grant lacks bot:send. Reconnect NekoLive in Connections.');
    throw Error('NekoLive chat failed (' + status + '): ' + reason);
  }

  // Legacy path: static bot token from Admin Panel; the bot needs permission in the channel.
  async function sayWithBotToken(channel, linked, message) {
    const cfg = config();
    const target = linked.display_name.toLowerCase();
    const response = await fetch(cfg.base + '/api/chatbot', {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + dec(botRow().access_token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ channel: target, message }),
      signal: AbortSignal.timeout(12000)
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401)
      throw Error('NekoLive rejected the bot token. Replace it in Admin Panel.');
    if (response.status === 403)
      throw Error(
        'The NekoLive bot is not allowed in channel "' +
          target +
          '". Reconnect NekoLive in Connections to grant the app chatbot, or add the bot to the channel in NekoLive /developers.'
      );
    if (!response.ok || body.success !== 1)
      throw Error(
        'NekoLive bot message failed (' +
          response.status +
          '): ' +
          clean(body.error || 'unknown error', 200)
      );
    log(channel, 'nekolive-bot-message', target);
    return { ok: true, mode: 'token' };
  }

  // ---- custom commands from NekoLive chat ----
  // Only 'everyone' commands run, as for VPZone/Kick: KitsuFlowBOT has no verified mapping
  // from NekoLive chat roles to its moderator/subscriber levels yet.
  const cooldowns = new Map();
  async function command(channel, username, body) {
    const parts = body.split(/\s+/),
      name = parts[0]?.toLowerCase();
    if (!name?.startsWith('!')) return;
    const key = name.slice(1);
    if (!/^[a-z0-9_]{1,32}$/.test(key)) return;
    const cmd = db
      .prepare('SELECT response,cooldown,level FROM commands WHERE channel=? AND name=?')
      .get(channel, key);
    if (!cmd || cmd.level !== 'everyone' || !canSend(channel)) return;
    const throttle = channel + ':nekolive:' + key,
      now = Date.now();
    if ((cooldowns.get(throttle) || 0) > now) return;
    cooldowns.set(throttle, now + Math.max(0, Number(cmd.cooldown) || 0) * 1000);
    if (cooldowns.size > 2000) for (const [k, t] of cooldowns) if (t < now) cooldowns.delete(k);
    const owner = db.prepare('SELECT login FROM channels WHERE id=?').get(channel)?.login || '';
    await say(
      channel,
      String(cmd.response)
        .replaceAll('{user}', username)
        .replaceAll('{channel}', owner)
        .replaceAll('{args}', parts.slice(1).join(' '))
    );
    log(channel, 'nekolive-command', key);
  }

  // ---- incoming chat and alerts ----
  function handle(channel, msg) {
    const type = String(msg?.type || '');
    if (ALERTS[type]) {
      const actor = clean(type === 'raid_trigger' ? msg.from : msg.username, 100);
      const detail =
        type === 'raid_trigger'
          ? String(msg.viewers ?? '')
          : type === 'subscribe' || type === 'resubscribe'
            ? clean(msg.tier, 90)
            : String(msg.amount ?? msg.value ?? '');
      streamActivity.emit(channel, 'nekolive', ALERTS[type], actor, detail, null);
      const text = clean(
        String(msg.message || '')
          .replaceAll('{name}', actor)
          .replaceAll('{amount}', detail)
          .replaceAll('{tier}', clean(msg.tier, 60)),
        300
      );
      if (text)
        void relay
          .relay(channel, 'nekolive', actor || 'nekolive', text, { kind: 'alerts' })
          .catch(err => log(channel, 'nekolive-relay-error', err.message));
      return;
    }
    if (type !== 'chat_message' && type !== 'chat_emotes') return;
    const username = clean(msg.username, 40);
    const body = (
      type === 'chat_emotes' ? plain(msg.message) : decodeEntities(msg.message).trim()
    ).slice(0, 350);
    if (!username || !body) return;
    // Skip bot posts (including ours) and NekoAI system messages so relays can't loop.
    const roles = msg.roles || {};
    if (username.toLowerCase() === 'nekoai' || roles.bot === true || roles.verifiedBot === true)
      return;
    void relay
      .relay(channel, 'nekolive', username, body, { isBot: false })
      .catch(err => log(channel, 'nekolive-relay-error', err.message));
    void command(channel, username, body).catch(err =>
      log(channel, 'nekolive-command-error', err.message)
    );
  }

  const sockets = new Map(); // KitsuFlowBOT channel -> {slug,ws,timer,heartbeat,failures,status,detail}
  function stop(channel) {
    const entry = sockets.get(channel);
    if (!entry) return;
    sockets.delete(channel);
    clearTimeout(entry.timer);
    clearInterval(entry.heartbeat);
    try {
      entry.ws?.close();
    } catch {}
  }
  function connect(channel, slug) {
    const cfg = config();
    if (!cfg.base || !SLUG.test(slug)) return;
    const existing = sockets.get(channel);
    if (
      existing?.slug === slug &&
      existing.ws &&
      [WebSocket.OPEN, WebSocket.CONNECTING].includes(existing.ws.readyState)
    )
      return;
    stop(channel);
    const entry = {
      slug,
      ws: null,
      timer: null,
      heartbeat: null,
      failures: 0,
      status: 'pending',
      detail: 'Connecting'
    };
    sockets.set(channel, entry);
    const open = () => {
      if (sockets.get(channel) !== entry) return;
      if (
        !db
          .prepare(
            "SELECT 1 FROM platform_oauth WHERE channel=? AND platform='nekolive' AND display_name=?"
          )
          .get(channel, slug)
      ) {
        sockets.delete(channel);
        return;
      }
      const url =
        cfg.base.replace(/^http/, 'ws') + '/chat/channel/' + encodeURIComponent(slug.toLowerCase());
      const ws = new WebSocket(url, {
        handshakeTimeout: 15000,
        headers: { 'User-Agent': 'KitsuFlowBOT' }
      });
      entry.ws = ws;
      let alive = true;
      ws.on('open', () => {
        entry.failures = 0;
        entry.status = 'connected';
        entry.detail = 'Live chat WebSocket';
        log(channel, 'nekolive-chat-connected', slug);
        // NekoLive sends no keepalive; use protocol pings so half-open sockets get replaced.
        entry.heartbeat = setInterval(() => {
          if (!alive) {
            ws.terminate();
            return;
          }
          alive = false;
          try {
            ws.ping();
          } catch {}
        }, 30000);
        entry.heartbeat.unref?.();
      });
      ws.on('pong', () => {
        alive = true;
      });
      ws.on('message', raw => {
        let msg;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        } // NekoLive also sends bare text replies.
        try {
          handle(channel, msg);
        } catch (err) {
          log(channel, 'nekolive-event-error', err.message);
        }
      });
      ws.on('error', err => {
        entry.detail = clean(err.message, 120);
        if (entry.failures < 3) log(channel, 'nekolive-ws-error', err.message);
      });
      ws.on('close', code => {
        clearInterval(entry.heartbeat);
        if (sockets.get(channel) !== entry) return;
        entry.status = code === 4001 ? 'failed' : 'pending';
        entry.detail = code === 4001 ? 'NekoLive channel "' + slug + '" not found' : 'Reconnecting';
        const delay = Math.min(120000, 10000 * 2 ** Math.min(entry.failures++, 4));
        entry.timer = setTimeout(open, delay);
        entry.timer.unref?.();
      });
    };
    open();
  }
  const chatStatus = channel => {
    const linked = linkedRow(channel);
    if (!linked) return { status: 'pending', detail: 'Connect NekoLive' };
    const entry = sockets.get(channel);
    if (!entry)
      return {
        status: 'failed',
        detail: config().base ? 'Chat listener stopped' : 'NEKOLIVE_BASE_URL not configured'
      };
    return { status: entry.status, detail: entry.detail };
  };

  // ---- broadcaster OAuth link ----
  app.get(
    '/auth/nekolive',
    withUser,
    safe(async (req, res) => {
      const channel = access.channelFor(req);
      if (!channel || !access.can(req.session.uid, channel, 'owner'))
        return res.status(403).json({ error: 'Channel owner required' });
      const cfg = config();
      if (!cfg.base || !cfg.clientId || !cfg.clientSecret)
        throw Error('NekoLive OAuth is not configured on this server');
      const state = crypto.randomBytes(32).toString('base64url');
      req.session.nekoliveOAuth = {
        state,
        channel,
        owner: req.session.uid,
        expires: Date.now() + 600000
      };
      res.redirect(
        cfg.base +
          '/oauth2/authorize?' +
          new URLSearchParams({
            response_type: 'code',
            client_id: cfg.clientId,
            redirect_uri: redirectUri(),
            scope: cfg.scope,
            state
          })
      );
    })
  );
  app.get(
    '/auth/nekolive/callback',
    withUser,
    safe(async (req, res) => {
      const o = req.session.nekoliveOAuth;
      delete req.session.nekoliveOAuth;
      if (
        !o ||
        o.state !== req.query.state ||
        o.expires < Date.now() ||
        o.owner !== req.session.uid ||
        !access.can(req.session.uid, o.channel, 'owner')
      )
        throw Error('Invalid or expired NekoLive authorisation session');
      if (req.query.error) return res.redirect('/dashboard?nekolive=denied');
      if (!req.query.code) throw Error('NekoLive did not return an authorisation code');
      const cfg = config();
      const token = await tokenRequest({
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: redirectUri()
      });
      // Older NekoLive builds put the user in the token response; current ones use /api/oauth/me.
      let user = token.user;
      if (!user?.id) {
        const me = await fetch(cfg.base + '/api/oauth/me', {
          redirect: 'error',
          headers: { Authorization: 'Bearer ' + token.access_token, Accept: 'application/json' },
          signal: AbortSignal.timeout(12000)
        });
        const body = await me.json().catch(() => ({}));
        if (me.status === 403)
          throw Error(
            'NekoLive did not grant user:read. Enable the user:read scope on the KitsuFlowBOT app in NekoLive /developers, then reconnect.'
          );
        if (!me.ok)
          throw Error(
            'NekoLive profile lookup failed (' +
              me.status +
              '): ' +
              clean(body.error_description || body.error, 160)
          );
        user = body;
      }
      const id = String(user?.id ?? ''),
        name = String(user?.username || '');
      if (!id || !SLUG.test(name)) throw Error('NekoLive did not return a usable account identity');
      const expires = expiry(token);
      db.prepare(
        'INSERT INTO platform_oauth(channel,platform,external_id,display_name,access_token,refresh_token,expires_at,scopes) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(channel,platform) DO UPDATE SET external_id=excluded.external_id,display_name=excluded.display_name,access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,scopes=excluded.scopes'
      ).run(
        o.channel,
        'nekolive',
        id,
        name,
        enc(token.access_token),
        enc(String(token.refresh_token || '')),
        expires,
        String(token.scope || cfg.scope)
      );
      db.prepare(
        'INSERT OR REPLACE INTO provider_accounts(id,channel,platform,external_id,display_name,status) VALUES(?,?,?,?,?,?)'
      ).run(o.channel + ':nekolive', o.channel, 'nekolive', id, name, 'connected');
      log(o.channel, 'provider-linked', 'nekolive ' + name);
      connect(o.channel, name);
      res.redirect('/dashboard?connected=nekolive');
    })
  );
  app.get('/api/nekolive', withUser, access.channelOnly('owner'), (req, res) => {
    const cfg = config(),
      linked = linkedRow(req.channelId),
      bot = botRow();
    res.set('Cache-Control', 'no-store').json({
      configured: {
        base: Boolean(cfg.base),
        oauth: Boolean(cfg.base && cfg.clientId && cfg.clientSecret),
        bot: Boolean(bot)
      },
      // 'app' = chatbot linked to the KitsuFlowBOT app (bot:send), 'token' = admin bot token.
      send_mode: hasScope(linked, 'bot:send') ? 'app' : bot ? 'token' : 'none',
      base: cfg.base,
      linked: linked
        ? { display_name: linked.display_name, external_id: linked.external_id }
        : null,
      bot: bot ? { display_name: bot.display_name } : null,
      chat: chatStatus(req.channelId)
    });
  });
  app.post('/api/nekolive/disconnect', withUser, access.channelOnly('owner'), csrf, (req, res) => {
    stop(req.channelId);
    db.prepare("DELETE FROM platform_oauth WHERE channel=? AND platform='nekolive'").run(
      req.channelId
    );
    db.prepare("DELETE FROM provider_accounts WHERE channel=? AND platform='nekolive'").run(
      req.channelId
    );
    log(req.channelId, 'provider-disconnected', 'nekolive');
    res.json({ ok: true });
  });
  app.post(
    '/api/nekolive/chat',
    withUser,
    access.channelOnly('owner'),
    csrf,
    safe(async (req, res) => {
      res.json(
        await say(
          req.channelId,
          req.body?.message || 'KitsuFlowBOT chat test: NekoLive messaging is connected.'
        )
      );
    })
  );

  // ---- shared bot token (platform administrators) ----
  app.get('/api/admin/nekolive/bot', withUser, requireAdmin, (req, res) => {
    const bot = botRow();
    res
      .set('Cache-Control', 'no-store')
      .json({ base: config().base, bot: bot ? { display_name: bot.display_name } : null });
  });
  app.post('/api/admin/nekolive/bot', withUser, requireAdmin, csrf, (req, res) => {
    const token = String(req.body?.token || '').trim(),
      name = clean(req.body?.name, 60);
    if (!BOT_TOKEN.test(token))
      return res.status(400).json({
        error: 'Paste the 64-character bot token from NekoLive (Admin → Partnership → bot tokens)'
      });
    if (name.length < 2)
      return res.status(400).json({ error: 'Enter the bot account name shown on NekoLive' });
    db.prepare(
      'INSERT INTO platform_bot_accounts(platform,external_id,display_name,access_token,refresh_token,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(platform) DO UPDATE SET external_id=excluded.external_id,display_name=excluded.display_name,access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at'
    ).run('nekolive', name, name, enc(token), enc(''), Number.MAX_SAFE_INTEGER);
    log(req.session.uid, 'nekolive-bot-configured', name);
    res.json({ ok: true });
  });
  app.post('/api/admin/nekolive/bot/disconnect', withUser, requireAdmin, csrf, (req, res) => {
    db.prepare("DELETE FROM platform_bot_accounts WHERE platform='nekolive'").run();
    res.json({ ok: true });
  });

  relay.register('nekolive', say);
  streamActivity.setSender('nekolive', say);
  // Restore chat listeners after restarts.
  for (const row of db
    .prepare("SELECT channel,display_name FROM platform_oauth WHERE platform='nekolive'")
    .all())
    connect(row.channel, row.display_name);
  return { chatStatus, say };
}
