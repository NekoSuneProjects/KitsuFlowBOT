import crypto from 'node:crypto';

// Shared OAuth 2.1 + PKCE plumbing for linked Kick/VPZone broadcaster accounts and their
// operator-linked bot identities, plus refresh of broadcaster tokens.
export const providers = {
  kick: {
    auth: 'https://id.kick.com/oauth/authorize',
    token: 'https://id.kick.com/oauth/token',
    client: 'KICK_CLIENT_ID',
    secret: 'KICK_CLIENT_SECRET',
    scope:
      process.env.KICK_AUTH_SCOPES ||
      'user:read channel:read channel:write chat:write events:subscribe moderation:ban'
  },
  vpzone: {
    auth: 'https://vpzone.tv/oauth/authorize',
    token: 'https://vpzone.tv/api/oauth/token',
    client: 'VPZONE_CLIENT_ID',
    secret: 'VPZONE_CLIENT_SECRET',
    scope: 'profile:read dashboard:read channel:read channel:write chat:read chat:write'
  }
};
export const clean = s => String(s ?? '').slice(0, 250);
const pkce = () => crypto.randomBytes(48).toString('base64url');
const hash = s => crypto.createHash('sha256').update(s).digest('base64url');
export const conf = type => {
  const p = providers[type];
  if (!p) return null;
  return { ...p, clientId: process.env[p.client], clientSecret: process.env[p.secret] };
};
export const platformSafe = fn => (req, res) =>
  Promise.resolve(fn(req, res)).catch(e => {
    console.error('platform:', e.message);
    res.status(400).json({ error: e.message });
  });

// hooks.onLinked / hooks.onUnlinked let the provider modules react to (un)linking.
export function createPlatformOAuth({
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
  hooks
}) {
  const safe = platformSafe;
  const authUser = (req, res, next) =>
    req.session.uid ? next() : res.status(401).json({ error: 'Sign in with Twitch first' });
  const verifyChannel = (req, res, next) => {
    const channel = access.channelFor(req);
    if (!channel || !access.can(req.session.uid, channel, 'owner'))
      return res.status(403).json({ error: 'Channel owner required' });
    req.channelId = channel;
    next();
  };
  app.get('/api/platforms', withUser, access.channelOnly('owner'), (req, res) => {
    const rows = db
      .prepare(
        'SELECT platform,external_id,display_name,expires_at,scopes FROM platform_oauth WHERE channel=?'
      )
      .all(req.channelId);
    res.json({
      platforms: ['twitch', 'kick', 'vpzone'].map(platform => ({
        platform,
        configured:
          platform === 'twitch' ||
          Boolean(conf(platform)?.clientId && conf(platform)?.clientSecret),
        connection: rows.find(r => r.platform === platform) || null
      }))
    });
  });
  // Platform administrators authorise a separate shared bot identity, not the broadcaster identity.
  const requireAdmin = (req, res, next) =>
    isOperator(req.session.uid) ? next() : res.status(403).json({ error: 'Admin access required' });
  app.get('/api/admin/platform-bots', withUser, requireAdmin, (req, res) => {
    res.json({
      bots: db
        .prepare(
          'SELECT platform,external_id,display_name,expires_at FROM platform_bot_accounts ORDER BY platform'
        )
        .all(),
      configured: ['kick', 'vpzone'].map(platform => ({
        platform,
        ready: Boolean(conf(platform)?.clientId && conf(platform)?.clientSecret)
      }))
    });
  });
  app.get(
    '/auth/platform-bot/:platform',
    authUser,
    requireAdmin,
    safe(async (req, res) => {
      const type = req.params.platform,
        p = conf(type);
      if (!p?.clientId || !p.clientSecret) throw Error('Platform application not configured');
      const state = pkce(),
        verifier = pkce(),
        redirect = base + '/auth/platform-bot/callback/' + type;
      req.session.botPlatformOAuth = {
        type,
        state,
        verifier,
        admin: req.session.uid,
        expires: Date.now() + 600000
      };
      const scope = type === 'kick' ? 'user:read chat:write' : p.scope;
      res.redirect(
        p.auth +
          '?' +
          new URLSearchParams({
            response_type: 'code',
            client_id: p.clientId,
            redirect_uri: redirect,
            scope,
            state,
            code_challenge: hash(verifier),
            code_challenge_method: 'S256'
          })
      );
    })
  );
  app.get(
    '/auth/platform-bot/callback/:platform',
    authUser,
    requireAdmin,
    safe(async (req, res) => {
      const o = req.session.botPlatformOAuth;
      delete req.session.botPlatformOAuth;
      const type = req.params.platform,
        p = conf(type);
      if (
        !o ||
        o.type !== type ||
        o.admin !== req.session.uid ||
        o.state !== req.query.state ||
        o.expires < Date.now() ||
        !req.query.code
      )
        throw Error('Invalid bot authorization state');
      const redirect = base + '/auth/platform-bot/callback/' + type;
      const tokenResp = await fetch(p.token, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: p.clientId,
          client_secret: p.clientSecret,
          redirect_uri: redirect,
          code: String(req.query.code),
          code_verifier: o.verifier
        }),
        signal: AbortSignal.timeout(12000)
      });
      if (!tokenResp.ok) throw Error('Platform bot OAuth failed: ' + tokenResp.status);
      const token = await tokenResp.json();
      if (!token.access_token || !token.refresh_token)
        throw Error('Bot must provide renewable OAuth token');
      let identity;
      if (type === 'kick') {
        const r = await fetch('https://api.kick.com/public/v1/users', {
          headers: { Authorization: 'Bearer ' + token.access_token },
          signal: AbortSignal.timeout(12000)
        });
        if (!r.ok) throw Error('Kick bot user lookup failed');
        const users = (await r.json()).data,
          user = Array.isArray(users) ? users[0] : users;
        identity = {
          id: String(user?.user_id || user?.id || ''),
          name: clean(user?.name || user?.username || '')
        };
      } else {
        const r = await fetch('https://vpzone.tv/api/v1/me', {
          headers: { Authorization: 'Bearer ' + token.access_token },
          signal: AbortSignal.timeout(12000)
        });
        if (!r.ok) throw Error('VPZone bot user lookup failed');
        const me = (await r.json()).data;
        identity = {
          id: String(me?.profile?.id || ''),
          name: clean(me?.profile?.username || me?.channel?.slug || '')
        };
      }
      if (!identity.id || !identity.name) throw Error('Missing linked bot identity');
      const broadcaster = db
        .prepare('SELECT 1 FROM platform_oauth WHERE platform=? AND external_id=? LIMIT 1')
        .get(type, identity.id);
      if (broadcaster)
        throw Error('Dedicated bot account must not be a linked broadcaster account');
      db.prepare(
        'INSERT INTO platform_bot_accounts(platform,external_id,display_name,access_token,refresh_token,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(platform) DO UPDATE SET external_id=excluded.external_id,display_name=excluded.display_name,access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at'
      ).run(
        type,
        identity.id,
        identity.name,
        enc(token.access_token),
        enc(token.refresh_token),
        Date.now() + Number(token.expires_in || 3600) * 1000
      );
      res.redirect('/dashboard?bot=' + type);
    })
  );
  app.post(
    '/api/admin/platform-bots/:platform/disconnect',
    withUser,
    requireAdmin,
    csrf,
    (req, res) => {
      if (!providers[req.params.platform]) return res.sendStatus(404);
      db.prepare('DELETE FROM platform_bot_accounts WHERE platform=?').run(req.params.platform);
      res.json({ ok: true });
    }
  );
  app.get(
    '/auth/platform/:platform',
    authUser,
    verifyChannel,
    safe(async (req, res) => {
      const type = req.params.platform,
        p = conf(type);
      if (!p?.clientId || !p.clientSecret) throw Error('Platform OAuth app not configured');
      const state = pkce(),
        verifier = pkce(),
        redirect = base + '/auth/platform/callback/' + type;
      req.session.platformOAuth = {
        type,
        state,
        verifier,
        channel: req.channelId,
        owner: req.session.uid,
        expires: Date.now() + 600000
      };
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: p.clientId,
        redirect_uri: redirect,
        scope: p.scope,
        state,
        code_challenge: hash(verifier),
        code_challenge_method: 'S256'
      });
      res.redirect(p.auth + '?' + query);
    })
  );
  app.get(
    '/auth/platform/callback/:platform',
    authUser,
    safe(async (req, res) => {
      const o = req.session.platformOAuth;
      delete req.session.platformOAuth;
      const type = req.params.platform,
        p = conf(type);
      if (
        !o ||
        o.type !== type ||
        o.state !== req.query.state ||
        !req.query.code ||
        o.expires < Date.now() ||
        o.owner !== req.session.uid ||
        !access.can(req.session.uid, o.channel, 'owner')
      )
        throw Error('Invalid or expired OAuth session');
      const redirect = base + '/auth/platform/callback/' + type;
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: p.clientId,
        client_secret: p.clientSecret,
        redirect_uri: redirect,
        code: String(req.query.code),
        code_verifier: o.verifier
      });
      const response = await fetch(p.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw Error(type + ' token exchange returned ' + response.status);
      const token = await response.json();
      if (!token.access_token || !token.refresh_token)
        throw Error('Provider did not return renewable token');
      let identity;
      if (type === 'vpzone') {
        const r = await fetch('https://vpzone.tv/api/v1/me', {
          headers: { Authorization: 'Bearer ' + token.access_token },
          signal: AbortSignal.timeout(12000)
        });
        if (!r.ok) throw Error('VPZone identity failed ' + r.status);
        const payload = (await r.json()).data;
        if (!payload?.profile?.id || !payload.channel?.slug)
          throw Error('VPZone account has no channel slug');
        identity = { id: payload.profile.id, display: payload.channel.slug };
      } else {
        const r = await fetch('https://api.kick.com/public/v1/users', {
          headers: { Authorization: 'Bearer ' + token.access_token },
          signal: AbortSignal.timeout(12000)
        });
        if (!r.ok) throw Error('Kick identity failed ' + r.status);
        const payload = (await r.json()).data;
        const user = Array.isArray(payload) ? payload[0] : payload;
        if (!user?.user_id && !user?.id) throw Error('Kick identity unavailable');
        identity = {
          id: String(user.user_id || user.id),
          display: clean(user.name || user.username || user.slug || user.user_id)
        };
      }
      db.prepare(
        'INSERT INTO platform_oauth(channel,platform,external_id,display_name,access_token,refresh_token,expires_at,scopes) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(channel,platform) DO UPDATE SET external_id=excluded.external_id,display_name=excluded.display_name,access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,scopes=excluded.scopes'
      ).run(
        o.channel,
        type,
        identity.id,
        identity.display,
        enc(token.access_token),
        enc(token.refresh_token),
        Date.now() + Number(token.expires_in || 3600) * 1000,
        String(token.scope || p.scope)
      );
      db.prepare(
        'INSERT OR REPLACE INTO provider_accounts(id,channel,platform,external_id,display_name,status) VALUES(?,?,?,?,?,?)'
      ).run(o.channel + ':' + type, o.channel, type, identity.id, identity.display, 'connected');
      log(o.channel, 'provider-linked', type + ' ' + identity.display);
      hooks.onLinked(o.channel, type, identity);
      res.redirect('/dashboard?connected=' + encodeURIComponent(type));
    })
  );
  app.post('/api/platforms/:platform/disconnect', withUser, verifyChannel, csrf, (req, res) => {
    const type = req.params.platform;
    if (!providers[type]) return res.sendStatus(404);
    db.prepare('DELETE FROM platform_oauth WHERE channel=? AND platform=?').run(
      req.channelId,
      type
    );
    hooks.onUnlinked(req.channelId, type);
    db.prepare('DELETE FROM provider_accounts WHERE channel=? AND platform=?').run(
      req.channelId,
      type
    );
    log(req.channelId, 'provider-disconnected', type);
    res.json({ ok: true });
  });
  app.get('/api/platforms/linked', withUser, access.channelOnly('owner'), (req, res) => {
    res.json({
      linked: db
        .prepare('SELECT platform,external_id,display_name FROM platform_oauth WHERE channel=?')
        .all(req.channelId)
    });
  });
  async function refresh(channel, type) {
    const row = db
        .prepare('SELECT * FROM platform_oauth WHERE channel=? AND platform=?')
        .get(channel, type),
      p = conf(type);
    if (!row || !p?.clientId) return null;
    if (row.expires_at > Date.now() + 120000) return dec(row.access_token);
    const b = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: dec(row.refresh_token),
      client_id: p.clientId,
      client_secret: p.clientSecret
    });
    const r = await fetch(p.token, { method: 'POST', body: b, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw Error(type + ' refresh failed ' + r.status);
    const t = await r.json();
    if (!t.access_token || !t.refresh_token) throw Error('Missing rotated token');
    db.prepare(
      'UPDATE platform_oauth SET access_token=?,refresh_token=?,expires_at=? WHERE channel=? AND platform=?'
    ).run(
      enc(t.access_token),
      enc(t.refresh_token),
      Date.now() + Number(t.expires_in || 3600) * 1000,
      channel,
      type
    );
    return t.access_token;
  }
  return { refresh };
}
