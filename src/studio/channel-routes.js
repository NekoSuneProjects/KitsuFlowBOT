import { WebSocket } from 'ws';
import { GLOBAL_COMMANDS } from '../commands/global-commands.js';

// Core Studio API for the selected channel: state, bot toggle, custom commands, clips,
// manual moderation, Twitch scope checks and chat diagnostics.
export function registerChannelRoutes(
  app,
  { db, log, isOperator, twitch, eventsub, access, withUser, csrf, safe, features }
) {
  const { getAccount, botId, say, clip, lookup, moderate } = twitch;
  const { connectChat, chatHealth } = eventsub;
  app.get('/api/twitch/engagement-scopes', withUser, access.channelOnly('owner'), (req, res) => {
    const needed = [
      'bits:read',
      'channel:read:subscriptions',
      'moderator:read:followers',
      'moderator:read:chatters'
    ];
    let granted = [];
    try {
      granted = JSON.parse(getAccount(req.channelId)?.scopes || '[]');
    } catch {}
    res.set('Cache-Control', 'no-store').json({
      granted: needed.filter(scope => granted.includes(scope)),
      missing: needed.filter(scope => !granted.includes(scope)),
      reauthorize_url: '/auth/connect/streamer'
    });
  });
  app.post(
    '/api/chat-diagnostics/test-send',
    withUser,
    access.channelOnly('owner'),
    csrf,
    safe(async (req, res) => {
      const target = req.channelId;
      await say(target, 'KitsuFlowBOT chat test: messaging is connected.');
      log(target, 'chat-send-test', 'Twitch confirmed test message sent');
      res
        .set('Cache-Control', 'no-store')
        .json({ ok: true, message: 'Twitch confirmed the test message was sent' });
    })
  );
  app.get('/api/chat-diagnostics', withUser, access.channelOnly('owner'), (req, res) => {
    const row = chatHealth.get(req.channelId) || { status: 'unknown' };
    res.set('Cache-Control', 'no-store').json({
      channel: req.channelId,
      botConnected: Boolean(botId()),
      socketConnected: eventsub.botSocket()?.readyState === WebSocket.OPEN,
      channelEnabled: Boolean(
        db.prepare('SELECT enabled FROM channels WHERE id=?').get(req.channelId)?.enabled
      ),
      subscription: row,
      recentLogs: db
        .prepare(
          "SELECT event,detail,created FROM logs WHERE channel=? AND (event LIKE 'chat-eventsub%' OR event='shared-chat-command' OR event='standalone-chat-command' OR event='chat-send-failed' OR event='chat-send-test' OR event='error') ORDER BY id DESC LIMIT 15"
        )
        .all(req.channelId)
    });
  });
  app.get('/api/state', withUser, (req, res) => {
    const ch = db.prepare('SELECT * FROM channels WHERE id=?').get(req.channelId);
    res.json({
      channel: ch,
      role: access.role(req.session.uid, req.channelId),
      isOperator: isOperator(req.session.uid),
      bot: (() => {
        const b = getAccount(botId());
        return b ? { id: b.id, login: b.login } : null;
      })(),
      commands: db
        .prepare('SELECT * FROM commands WHERE channel=? ORDER BY name')
        .all(req.channelId),
      logs: db
        .prepare('SELECT * FROM logs WHERE channel=? ORDER BY id DESC LIMIT 30')
        .all(req.channelId)
    });
  });
  app.post('/api/settings', withUser, access.channelOnly('owner'), csrf, (req, res) => {
    if (req.body.enabled === true && !botId())
      return res.status(409).json({ error: 'Shared bot is not connected yet' });
    db.prepare('UPDATE channels SET enabled=?,links=? WHERE id=?').run(
      req.body.enabled === true ? 1 : 0,
      req.body.links === true ? 1 : 0,
      req.channelId
    );
    connectChat();
    res.json({ ok: true });
  });
  app.post('/api/channel/disconnect', withUser, access.channelOnly('owner'), csrf, (req, res) => {
    const id = req.channelId;
    db.prepare('UPDATE channels SET enabled=0 WHERE id=?').run(id);
    db.prepare('DELETE FROM accounts WHERE id=? AND id != ?').run(id, botId() || '');
    connectChat();
    req.session.destroy(() => res.json({ ok: true }));
  });
  app.post('/api/commands', withUser, access.channelOnly('editor'), csrf, (req, res) => {
    const name = String(req.body.name || '')
      .toLowerCase()
      .replace(/^!/, '');
    const response = String(req.body.response || '');
    if (
      !/^[a-z0-9_]{1,32}$/.test(name) ||
      [
        'clip',
        'ban',
        'timeout',
        'uptime',
        'points',
        'top',
        'addquote',
        'quote',
        'counter',
        'bsr',
        ...Object.keys(GLOBAL_COMMANDS),
        ...features.pokemon.reserved
      ].includes(name) ||
      db
        .prepare(
          "SELECT 1 FROM minecraft_actions WHERE channel=? AND trigger_type='command' AND command=?"
        )
        .get(req.channelId, name) ||
      !response ||
      response.length > 450 ||
      !['everyone', 'subscriber', 'moderator'].includes(req.body.level)
    )
      return res.status(400).json({ error: 'Invalid command' });
    db.prepare(
      'INSERT INTO commands(channel,name,response,cooldown,level) VALUES(?,?,?,?,?) ON CONFLICT(channel,name) DO UPDATE SET response=excluded.response,cooldown=excluded.cooldown,level=excluded.level'
    ).run(
      req.channelId,
      name,
      response,
      Math.max(0, Math.min(3600, Number(req.body.cooldown) || 0)),
      req.body.level
    );
    res.json({ ok: true });
  });
  app.delete('/api/commands/:name', withUser, access.channelOnly('editor'), csrf, (req, res) => {
    db.prepare('DELETE FROM commands WHERE channel=? AND name=?').run(
      req.channelId,
      req.params.name
    );
    res.json({ ok: true });
  });
  app.post(
    '/api/clip',
    withUser,
    access.channelOnly('bot_supervisor'),
    csrf,
    safe(async (req, res) => {
      const c = await clip(req.channelId);
      res.json(c);
    })
  );
  app.post(
    '/api/moderate',
    withUser,
    access.channelOnly('bot_supervisor'),
    csrf,
    safe(async (req, res) => {
      if (!['ban', 'timeout'].includes(req.body.action)) throw Error('Invalid action');
      const uid = await lookup(String(req.body.user || ''));
      const seconds =
        req.body.action === 'timeout'
          ? Math.max(1, Math.min(1209600, Number(req.body.seconds) || 600))
          : null;
      await moderate(req.channelId, uid, seconds, 'Dashboard moderation');
      log(req.channelId, req.body.action, req.body.user);
      res.json({ ok: true });
    })
  );
}
