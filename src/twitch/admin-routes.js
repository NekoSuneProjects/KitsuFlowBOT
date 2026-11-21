import { BOT_SCOPES } from './scopes.js';

// Operator-only Admin Panel API for the shared Twitch bot: overview, logs, EventSub reconnect,
// device-code authorisation from another browser, and scope status.
export function registerTwitchAdminRoutes(
  app,
  { db, config, enc, dec, log, isOperator, twitch, eventsub, withUser, csrf, safe }
) {
  const { clientId: CID, clientSecret: SECRET } = config.twitch;
  const { adminIds } = config;
  const { getAccount, botId, token } = twitch;
  const { connectChat } = eventsub;
  app.get('/api/admin/logs', withUser, (req, res) => {
    if (!isOperator(req.session.uid))
      return res.status(403).json({ error: 'Operator access required' });
    res
      .set('Cache-Control', 'no-store')
      .json(
        db
          .prepare(
            'SELECT l.channel,c.login,l.event,l.detail,l.created FROM logs l LEFT JOIN channels c ON c.id=l.channel ORDER BY l.id DESC LIMIT 250'
          )
          .all()
      );
  });
  app.get('/api/admin/overview', withUser, (req, res) => {
    if (!isOperator(req.session.uid))
      return res.status(403).json({ error: 'Operator access required' });
    const b = getAccount(botId());
    const channels = db.prepare('SELECT id,login,enabled FROM channels ORDER BY login').all();
    res.set('Cache-Control', 'no-store').json({
      operator: true,
      bot: b
        ? {
            id: b.id,
            login: b.login,
            display: b.display,
            expires: b.expires,
            scopes: JSON.parse(b.scopes || '[]')
          }
        : null,
      channels,
      enabled_count: channels.filter(x => x.enabled).length,
      connection_status: b
        ? eventsub.botSocket()?.readyState === 1
          ? 'connected'
          : 'disconnected'
        : 'not_configured'
    });
  });
  app.post(
    '/api/admin/bot/reconnect',
    withUser,
    csrf,
    safe(async (req, res) => {
      if (!isOperator(req.session.uid))
        return res.status(403).json({ error: 'Operator access required' });
      if (!botId()) return res.status(409).json({ error: 'Authorise the public bot first' });
      await token(botId());
      await connectChat();
      log(req.session.uid, 'bot-reconnect', 'Operator requested EventSub reconnection');
      res.json({ ok: true });
    })
  );
  // The device grant is an alternative for administrators who have the dedicated bot signed in on another browser/device.
  db.exec(
    'CREATE TABLE IF NOT EXISTS bot_device_grants(admin_id TEXT PRIMARY KEY,device_secret TEXT NOT NULL,expires_at INTEGER NOT NULL,interval_seconds INTEGER NOT NULL,next_poll INTEGER NOT NULL,verification_uri TEXT NOT NULL,user_code TEXT NOT NULL)'
  );
  const requireAdmin = (req, res, next) =>
    isOperator(req.session.uid)
      ? next()
      : res.status(403).json({ error: 'Admin Twitch ID is not authorised' });
  async function storeBotToken(t, adminId) {
    const check = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: 'OAuth ' + t.access_token }
    });
    if (!check.ok) throw Error('Unable to validate Twitch bot token');
    const identity = await check.json();
    if (identity.client_id !== CID) throw Error('Token belongs to another Twitch application');
    if (identity.user_id === adminId)
      throw Error(
        'Streamer/admin account cannot be linked as shared bot. Authorise a dedicated bot account.'
      );
    const required = BOT_SCOPES.split(' ');
    if (required.some(v => !identity.scopes?.includes(v)))
      throw Error('Bot permission scopes were not granted.');
    const info = await fetch('https://api.twitch.tv/helix/users', {
      headers: { 'Client-Id': CID, Authorization: 'Bearer ' + t.access_token }
    });
    if (!info.ok) throw Error('Unable to retrieve bot identity');
    const bot = (await info.json()).data?.[0];
    if (!bot || bot.id !== identity.user_id) throw Error('Invalid Twitch bot identity');
    db.transaction(() => {
      db.prepare(
        'INSERT INTO accounts(id,login,display,access,refresh,expires,scopes) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,display=excluded.display,access=excluded.access,refresh=excluded.refresh,expires=excluded.expires,scopes=excluded.scopes'
      ).run(
        bot.id,
        bot.login,
        bot.display_name,
        enc(t.access_token),
        enc(t.refresh_token),
        Date.now() + t.expires_in * 1000,
        JSON.stringify(t.scope || identity.scopes)
      );
      db.prepare(
        "INSERT INTO config(key,value) VALUES('bot_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
      ).run(bot.id);
    })();
    connectChat();
    return { id: bot.id, login: bot.login };
  }
  app.post(
    '/api/admin/bot/device/start',
    withUser,
    requireAdmin,
    csrf,
    safe(async (req, res) => {
      const response = await fetch('https://id.twitch.tv/oauth2/device', {
        method: 'POST',
        body: new URLSearchParams({ client_id: CID, scopes: BOT_SCOPES })
      });
      const d = await response.json();
      if (!response.ok || !d.device_code || !d.user_code)
        throw Error('Twitch device authorization failed');
      const interval = Math.max(5, Number(d.interval) || 5),
        expiresAt = Date.now() + Number(d.expires_in || 600) * 1000;
      db.prepare(
        'INSERT INTO bot_device_grants(admin_id,device_secret,expires_at,interval_seconds,next_poll,verification_uri,user_code) VALUES(?,?,?,?,?,?,?) ON CONFLICT(admin_id) DO UPDATE SET device_secret=excluded.device_secret,expires_at=excluded.expires_at,interval_seconds=excluded.interval_seconds,next_poll=excluded.next_poll,verification_uri=excluded.verification_uri,user_code=excluded.user_code'
      ).run(
        req.session.uid,
        enc(d.device_code),
        expiresAt,
        interval,
        0,
        d.verification_uri,
        d.user_code
      );
      res.json({
        verification_uri: d.verification_uri,
        user_code: d.user_code,
        expires_at: expiresAt,
        interval_seconds: interval
      });
    })
  );
  app.post(
    '/api/admin/bot/device/check',
    withUser,
    requireAdmin,
    csrf,
    safe(async (req, res) => {
      const row = db
        .prepare('SELECT * FROM bot_device_grants WHERE admin_id=?')
        .get(req.session.uid);
      if (!row) return res.status(404).json({ error: 'No device authorization in progress' });
      if (row.expires_at < Date.now()) {
        db.prepare('DELETE FROM bot_device_grants WHERE admin_id=?').run(req.session.uid);
        return res.json({ status: 'expired' });
      }
      if (row.next_poll > Date.now())
        return res.json({
          status: 'pending',
          retry_after: Math.ceil((row.next_poll - Date.now()) / 1000)
        });
      db.prepare('UPDATE bot_device_grants SET next_poll=? WHERE admin_id=?').run(
        Date.now() + row.interval_seconds * 1000,
        req.session.uid
      );
      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: CID,
          client_secret: SECRET,
          device_code: dec(row.device_secret),
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      });
      const body = await response.json();
      if (!response.ok) {
        const status = body.message || body.error || '';
        if (/authorization_pending|slow_down/i.test(status))
          return res.json({ status: 'pending', retry_after: row.interval_seconds });
        if (/expired|invalid device code|access_denied/i.test(status)) {
          db.prepare('DELETE FROM bot_device_grants WHERE admin_id=?').run(req.session.uid);
          return res.json({ status: 'expired' });
        }
        throw Error('Twitch device authorization failed: ' + String(status).slice(0, 140));
      }
      db.prepare('DELETE FROM bot_device_grants WHERE admin_id=?').run(req.session.uid);
      const bot = await storeBotToken(body, req.session.uid);
      res.json({ status: 'connected', bot });
    })
  );
  app.get('/api/admin/bot/scopes', withUser, requireAdmin, (req, res) => {
    const bot = getAccount(botId());
    const granted = JSON.parse(bot?.scopes || '[]');
    res.json({
      connected: Boolean(bot),
      granted,
      missing: BOT_SCOPES.split(' ').filter(scope => !granted.includes(scope)),
      reauthorize_url: '/auth/connect/bot'
    });
  });
  app.get('/api/admin/bot/status', withUser, requireAdmin, (req, res) => {
    const id = botId(),
      b = getAccount(id);
    res.json({
      admins_configured: adminIds.size,
      bot: b ? { id: b.id, login: b.login, scopes: JSON.parse(b.scopes || '[]') } : null,
      connected: Boolean(b)
    });
  });
}
