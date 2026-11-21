import crypto from 'node:crypto';
import { BOT_SCOPES, STREAMER_SCOPES } from './scopes.js';

// Twitch sign-in for broadcasters, operator-only shared bot authorisation, and logout.
export function registerTwitchAuthRoutes(
  app,
  { db, config, enc, isOperator, eventsub, safe, csrf }
) {
  const { clientId: CID, clientSecret: SECRET } = config.twitch;
  const BASE = config.baseUrl;
  const { connectChat, connectEngagement } = eventsub;
  app.get(
    '/auth/connect/:role',
    safe(async (req, res) => {
      const role = req.params.role;
      if (!['streamer', 'bot'].includes(role)) throw Error('Invalid role');
      if (role === 'bot' && !isOperator(req.session.uid))
        return res
          .status(403)
          .send(
            'Only the KitsuFlowBOT operator can link the global bot account. Set BOT_ADMIN_TWITCH_ID.'
          );
      const state = crypto.randomBytes(24).toString('hex');
      req.session.oauth = { state, role, owner: req.session.uid };
      const scope = role === 'bot' ? BOT_SCOPES : STREAMER_SCOPES;
      const p = new URLSearchParams({
        client_id: CID,
        redirect_uri: BASE + '/auth/callback',
        response_type: 'code',
        scope,
        state
      });
      res.redirect('https://id.twitch.tv/oauth2/authorize?' + p);
    })
  );
  app.get(
    '/auth/callback',
    safe(async (req, res) => {
      const s = req.session.oauth;
      if (!s || req.query.state !== s.state || !req.query.code) throw Error('Invalid OAuth state');
      delete req.session.oauth;
      const r = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: CID,
          client_secret: SECRET,
          code: String(req.query.code),
          grant_type: 'authorization_code',
          redirect_uri: BASE + '/auth/callback'
        })
      });
      if (!r.ok) throw Error('OAuth exchange failed');
      const t = await r.json();
      const who = await fetch('https://api.twitch.tv/helix/users', {
        headers: { 'Client-Id': CID, Authorization: 'Bearer ' + t.access_token }
      });
      if (!who.ok) throw Error('User lookup failed');
      const u = (await who.json()).data[0];
      db.prepare(
        'INSERT INTO accounts(id,login,display,access,refresh,expires,scopes) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,display=excluded.display,access=excluded.access,refresh=excluded.refresh,expires=excluded.expires,scopes=excluded.scopes'
      ).run(
        u.id,
        u.login,
        u.display_name,
        enc(t.access_token),
        enc(t.refresh_token),
        Date.now() + t.expires_in * 1000,
        JSON.stringify(t.scope || [])
      );
      if (s.role === 'bot' && u.id === s.owner)
        throw Error(
          'A separate bot Twitch account is required; do not authorise your admin streamer account as the bot.'
        );
      if (s.role === 'streamer') {
        req.session.uid = u.id;
        db.prepare(
          'INSERT INTO channels(id,login) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login'
        ).run(u.id, u.login);
        connectEngagement(u.id);
      } else {
        if (!s.owner || s.owner !== req.session.uid || !isOperator(s.owner))
          throw Error('Only the KitsuFlowBOT operator may configure the shared bot');
        db.prepare(
          "INSERT INTO config(key,value) VALUES('bot_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
        ).run(u.id);
        connectChat();
      }
      res.redirect('/dashboard');
    })
  );
  app.post('/logout', csrf, (req, res) => req.session.destroy(() => res.json({ ok: true })));
}
