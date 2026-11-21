import { createScamFilter } from './scam-filter.js';

// Opt-in Twitch scam-link moderation backed by community phishing domain feeds.
export function createScamProtection({ db, twitch, log }) {
  const { api, botId, moderate } = twitch;
  db.exec(
    "CREATE TABLE IF NOT EXISTS scam_protection(channel TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,action TEXT NOT NULL DEFAULT 'ban')"
  );
  const scamSettings = channel =>
    db.prepare('SELECT enabled,action FROM scam_protection WHERE channel=?').get(channel) || {
      enabled: 0,
      action: 'ban'
    };
  const scamFilter = createScamFilter({ log });

  // Deletes the message and bans/times out the sender. Returns true when it acted.
  async function check(ch, e, rawText) {
    const bad = scamFilter.match(rawText);
    if (
      !bad ||
      scamSettings(ch.id).enabled !== 1 ||
      e.badges?.some(b => b.set_id === 'broadcaster' || b.set_id === 'moderator')
    )
      return false;
    log(ch.id, 'scam-domain', e.chatter_user_login + ' ' + bad.blocked);
    const id = botId(),
      messageId = String(e.message_id || e.message?.id || '');
    if (id && messageId) {
      try {
        await api(
          id,
          'moderation/chat?broadcaster_id=' +
            encodeURIComponent(ch.id) +
            '&moderator_id=' +
            encodeURIComponent(id) +
            '&message_id=' +
            encodeURIComponent(messageId),
          'DELETE'
        );
      } catch (err) {
        log(ch.id, 'scam-delete-error', err.message);
      }
    }
    const action = scamSettings(ch.id).action;
    const reason = 'Known scam/phishing domain: ' + bad.blocked;
    try {
      await moderate(ch.id, e.chatter_user_id, action === 'timeout' ? 1 : null, reason);
      log(ch.id, 'scam-' + action, e.chatter_user_login + ': ' + reason);
    } catch (err) {
      log(ch.id, 'scam-ban-error', err.message);
    }
    return true;
  }

  function registerRoutes(app, { withUser, csrf, access, isOperator }) {
    const requireAdmin = (req, res, next) =>
      isOperator(req.session.uid)
        ? next()
        : res.status(403).json({ error: 'Admin Twitch ID is not authorised' });
    app.get('/api/scam-protection', withUser, access.channelOnly('editor'), (req, res) =>
      res.json({
        ...scamSettings(req.channelId),
        feed: scamFilter.status(),
        platforms: { twitch: 'supported', kick: 'not_yet_supported', vpzone: 'not_yet_supported' }
      })
    );
    app.post('/api/scam-protection', withUser, access.channelOnly('owner'), csrf, (req, res) => {
      const { enabled, action } = req.body || {};
      if (typeof enabled !== 'boolean' || !['ban', 'timeout'].includes(action))
        return res.status(400).json({ error: 'Invalid scam settings' });
      db.prepare(
        'INSERT INTO scam_protection(channel,enabled,action) VALUES(?,?,?) ON CONFLICT(channel) DO UPDATE SET enabled=excluded.enabled,action=excluded.action'
      ).run(req.channelId, enabled ? 1 : 0, action);
      log(req.channelId, 'scam-protection', (enabled ? 'enabled ' : 'disabled ') + action);
      res.json({ ok: true });
    });
    app.get('/api/admin/scam-feeds', withUser, requireAdmin, (req, res) =>
      res.json(scamFilter.status())
    );
  }

  return { check, registerRoutes };
}
