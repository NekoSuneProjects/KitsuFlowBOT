// KitsuFlowBOT Assistant (desktop app) server side: a job queue the streamer's PC polls with its
// paired device key, plus the features that feed it:
//   - Beat Saber song requests: !bsr <BeatSaver key> -> the app installs the map on the PC.
//   - Minecraft Interactive: chat commands, stream events or a Studio test fire RCON commands
//     the app runs against the streamer's Minecraft server.
// Jobs: pending -> delivered (app fetched it) -> done | failed. Points spent on a job are refunded
// when it fails or nobody picks it up in time.
import { createDeviceAuth, deviceOnline } from './companion-devices.js';

const BSR_KEY = /^[0-9a-f]{1,8}$/i;
const COMMAND_NAME = /^[a-z0-9_]{2,24}$/;
const LEVELS = ['everyone', 'subscriber', 'vip', 'moderator'];
const EVENT_TYPES = [
  'follow',
  'subscription',
  'subscription_renewal',
  'subscription_gift',
  'cheer',
  'kicks',
  'donation',
  'raid'
];
const PLATFORMS = [
  'any',
  'twitch',
  'kick',
  'vpzone',
  'nekolive',
  'beam',
  'streamelements',
  'streamlabs',
  'tipeeestream',
  'kofi'
];
// Server-admin commands viewers must never be able to trigger, even if a template lists them.
const BLOCKED_RCON = new Set([
  'op',
  'deop',
  'stop',
  'ban',
  'ban-ip',
  'pardon',
  'pardon-ip',
  'whitelist',
  'kick',
  'save-off',
  'save-all',
  'reload',
  'restart',
  'debug',
  'perf',
  'jfr',
  'transfer'
]);
const PENDING_TTL_MS = 10 * 60000;
const DELIVERED_TTL_MS = 5 * 60000;
const clean = (value, max = 120) =>
  String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);
const safeName = value =>
  String(value || '')
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, 25) || 'viewer';

// Validates an action's RCON template: one command per line, no leading slash, no admin commands.
export function parseRconTemplate(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim().replace(/^\/+/, ''))
    .filter(Boolean);
  if (!lines.length) throw Error('Add at least one Minecraft command');
  if (lines.length > 10) throw Error('At most 10 commands per action');
  for (const line of lines) {
    if (line.length > 240) throw Error('Each command must be 240 characters or fewer');
    const word = line
      .split(/\s+/)[0]
      .toLowerCase()
      .replace(/^minecraft:/, '');
    if (BLOCKED_RCON.has(word))
      throw Error('"' + word + '" is a server-admin command and is not allowed');
  }
  return lines;
}

export function installAssistant({
  app,
  db,
  withUser,
  csrf,
  safe,
  access,
  say,
  log,
  reservedCommands = () => []
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS assistant_jobs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',result TEXT NOT NULL DEFAULT '',requester_id TEXT,requester TEXT,
    cost INTEGER NOT NULL DEFAULT 0,device TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS assistant_jobs_channel ON assistant_jobs(channel,status,id);
  CREATE TABLE IF NOT EXISTS bsr_settings(channel TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,
    level TEXT NOT NULL DEFAULT 'everyone',user_cooldown INTEGER NOT NULL DEFAULT 60,max_queue INTEGER NOT NULL DEFAULT 20);
  CREATE TABLE IF NOT EXISTS minecraft_actions(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,
    name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,trigger_type TEXT NOT NULL,command TEXT,
    event_platform TEXT,event_type TEXT,min_amount REAL NOT NULL DEFAULT 0,level TEXT NOT NULL DEFAULT 'everyone',
    cost INTEGER NOT NULL DEFAULT 0,cooldown INTEGER NOT NULL DEFAULT 30,commands TEXT NOT NULL,reply TEXT NOT NULL DEFAULT '');`);

  const deviceAuth = createDeviceAuth(db);
  const online = channel => deviceOnline(db, channel, 30);
  const reply = (channel, text) =>
    text
      ? say(channel, clean(text, 450)).catch(err =>
          log(channel, 'assistant-chat-error', err.message)
        )
      : undefined;
  const badge = (e, ...sets) => Boolean(e.badges?.some(b => sets.includes(b.set_id)));
  const permitted = (level, e) => {
    if (badge(e, 'broadcaster', 'moderator')) return true;
    if (level === 'everyone') return true;
    if (level === 'vip') return badge(e, 'vip');
    if (level === 'subscriber') return badge(e, 'subscriber', 'founder', 'vip');
    return false;
  };
  const debit = (channel, user, cost) =>
    !cost ||
    db
      .prepare('UPDATE loyalty SET points=points-? WHERE channel=? AND user_id=? AND points>=?')
      .run(cost, channel, user, cost).changes > 0;
  const refund = job => {
    if (job.cost > 0 && job.requester_id)
      db.prepare('UPDATE loyalty SET points=points+? WHERE channel=? AND user_id=?').run(
        job.cost,
        job.channel,
        job.requester_id
      );
  };

  function enqueue(
    channel,
    kind,
    payload,
    { requesterId = null, requester = null, cost = 0 } = {}
  ) {
    const now = Date.now();
    return Number(
      db
        .prepare(
          'INSERT INTO assistant_jobs(channel,kind,payload,requester_id,requester,cost,created,updated) VALUES(?,?,?,?,?,?,?,?)'
        )
        .run(channel, kind, JSON.stringify(payload), requesterId, requester, cost, now, now)
        .lastInsertRowid
    );
  }
  // Fails jobs nobody picked up (or finished) in time, refunding any points.
  function expire(channel) {
    const now = Date.now();
    const stale = db
      .prepare(
        "SELECT * FROM assistant_jobs WHERE channel=? AND ((status='pending' AND created<?) OR (status='delivered' AND updated<?))"
      )
      .all(channel, now - PENDING_TTL_MS, now - DELIVERED_TTL_MS);
    for (const job of stale)
      finish(job, false, 'Timed out: the Assistant app did not finish this job');
  }
  function finish(job, ok, message) {
    const changed = db
      .prepare(
        "UPDATE assistant_jobs SET status=?,result=?,updated=? WHERE id=? AND status IN ('pending','delivered')"
      )
      .run(ok ? 'done' : 'failed', clean(message, 300), Date.now(), job.id).changes;
    if (!changed) return false;
    const payload = JSON.parse(job.payload);
    if (!ok) refund(job);
    if (job.kind === 'bsr') {
      reply(
        job.channel,
        ok
          ? '@' +
              job.requester +
              ' requested ' +
              payload.songAuthor +
              ' - ' +
              payload.songName +
              ' (mapped by ' +
              payload.mapper +
              ') [' +
              payload.key +
              ']. Added!'
          : '@' + job.requester + " couldn't add [" + payload.key + ']: ' + clean(message, 150)
      );
    } else if (job.kind === 'minecraft') {
      if (ok && payload.reply) reply(job.channel, payload.reply);
      if (!ok && job.requester)
        reply(
          job.channel,
          '@' +
            job.requester +
            ' ' +
            payload.action +
            ' failed' +
            (job.cost ? ' (points refunded)' : '') +
            ': ' +
            clean(message, 150)
        );
    }
    log(
      job.channel,
      'assistant-job-' + (ok ? 'done' : 'failed'),
      job.kind + ' #' + job.id + ' ' + clean(message, 120)
    );
    return true;
  }

  // ---- Beat Saber song requests ----
  const bsrSettings = channel =>
    db.prepare('SELECT * FROM bsr_settings WHERE channel=?').get(channel) || {
      enabled: 0,
      level: 'everyone',
      user_cooldown: 60,
      max_queue: 20
    };
  const bsrCooldowns = new Map();
  async function beatSaverMap(key) {
    const response = await fetch('https://api.beatsaver.com/maps/id/' + encodeURIComponent(key), {
      headers: {
        'User-Agent': 'KitsuFlowBOT (+https://github.com/NekoSuneProjects/KitsuFlowBOT)',
        Accept: 'application/json'
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    });
    if (response.status === 404) return null;
    if (!response.ok) throw Error('BeatSaver returned ' + response.status);
    const map = await response.json();
    const version = (map.versions || []).find(v => v.state === 'Published') || map.versions?.[0];
    if (!version?.downloadURL || !version?.hash) return null;
    return {
      key: String(map.id).toLowerCase(),
      hash: String(version.hash).toLowerCase(),
      downloadURL: String(version.downloadURL),
      songName: clean(map.metadata?.songName || map.name, 80),
      songAuthor: clean(map.metadata?.songAuthorName, 60),
      mapper: clean(map.metadata?.levelAuthorName || map.uploader?.name, 60),
      duration: Number(map.metadata?.duration) || 0
    };
  }
  async function bsrCommand(ch, e, parts) {
    const s = bsrSettings(ch.id);
    const who = safeName(e.chatter_user_name || e.chatter_user_login);
    if (!s.enabled) return true;
    if (!permitted(s.level, e)) return true;
    const key = String(parts[1] || '')
      .replace(/^!bsr/i, '')
      .trim()
      .toLowerCase();
    if (!BSR_KEY.test(key)) {
      await reply(ch.id, '@' + who + ' usage: !bsr <BeatSaver key>, e.g. !bsr 25f');
      return true;
    }
    const userKey = ch.id + ':' + e.chatter_user_id,
      now = Date.now();
    if (
      now - (bsrCooldowns.get(userKey) || 0) < s.user_cooldown * 1000 &&
      !badge(e, 'broadcaster', 'moderator')
    )
      return true;
    expire(ch.id);
    if (!online(ch.id)) {
      await reply(
        ch.id,
        '@' +
          who +
          ' song requests are offline right now (the KitsuFlowBOT Assistant app is not running).'
      );
      return true;
    }
    const queued = db
      .prepare(
        "SELECT payload FROM assistant_jobs WHERE channel=? AND kind='bsr' AND status IN ('pending','delivered')"
      )
      .all(ch.id)
      .map(r => JSON.parse(r.payload).key);
    if (queued.length >= s.max_queue) {
      await reply(ch.id, '@' + who + ' the song request queue is full, try again later.');
      return true;
    }
    if (queued.includes(key)) {
      await reply(ch.id, '@' + who + ' [' + key + '] is already being added.');
      return true;
    }
    let map;
    try {
      map = await beatSaverMap(key);
    } catch (err) {
      log(ch.id, 'bsr-lookup-error', err.message);
      await reply(ch.id, '@' + who + ' BeatSaver is not responding, try again soon.');
      return true;
    }
    if (!map) {
      await reply(ch.id, '@' + who + ' no BeatSaver map found for [' + key + '].');
      return true;
    }
    bsrCooldowns.set(userKey, now);
    if (bsrCooldowns.size > 5000)
      for (const [k, t] of bsrCooldowns) if (now - t > 3600000) bsrCooldowns.delete(k);
    enqueue(ch.id, 'bsr', map, { requesterId: e.chatter_user_id, requester: who });
    return true;
  }

  // ---- Minecraft Interactive ----
  const actionCooldowns = new Map();
  const actionPayload = (action, user, amount) => ({
    action: action.name,
    commands: JSON.parse(action.commands).map(line =>
      line
        .replaceAll('{user}', safeName(user))
        .replaceAll('{amount}', String(Math.floor(Number(amount) || 0)))
    ),
    reply: action.reply
      ? action.reply
          .replaceAll('{user}', safeName(user))
          .replaceAll('{amount}', String(Math.floor(Number(amount) || 0)))
      : ''
  });
  async function minecraftCommand(ch, e, cmd) {
    const action = db
      .prepare(
        "SELECT * FROM minecraft_actions WHERE channel=? AND trigger_type='command' AND command=? AND enabled=1"
      )
      .get(ch.id, cmd);
    if (!action) return false;
    const who = safeName(e.chatter_user_name || e.chatter_user_login);
    if (!permitted(action.level, e)) return true;
    const now = Date.now(),
      key = ch.id + ':' + action.id;
    if (now - (actionCooldowns.get(key) || 0) < action.cooldown * 1000) return true;
    if (!online(ch.id)) {
      await reply(ch.id, '@' + who + ' Minecraft actions are offline right now.');
      return true;
    }
    if (!debit(ch.id, e.chatter_user_id, action.cost)) {
      await reply(ch.id, '@' + who + ' ' + action.name + ' costs ' + action.cost + ' points.');
      return true;
    }
    actionCooldowns.set(key, now);
    enqueue(ch.id, 'minecraft', actionPayload(action, who, 0), {
      requesterId: action.cost ? e.chatter_user_id : null,
      requester: who,
      cost: action.cost
    });
    return true;
  }
  function onActivity(channel, platform, kind, actor, detail) {
    const actions = db
      .prepare(
        "SELECT * FROM minecraft_actions WHERE channel=? AND trigger_type='event' AND enabled=1 AND event_type=?"
      )
      .all(channel, kind)
      .filter(a => a.event_platform === 'any' || a.event_platform === platform);
    if (!actions.length || !online(channel)) return;
    const amount = Number(
      String(detail || '')
        .replace(/,/g, '')
        .match(/\d+(?:\.\d+)?/)?.[0] || 1
    );
    for (const action of actions) {
      if (amount < action.min_amount) continue;
      const now = Date.now(),
        key = channel + ':' + action.id;
      if (now - (actionCooldowns.get(key) || 0) < action.cooldown * 1000) continue;
      actionCooldowns.set(key, now);
      enqueue(channel, 'minecraft', actionPayload(action, actor, amount), { requester: null });
    }
  }

  // Chat entry point (Twitch). Returns true when the message was handled here.
  async function onMessage(ch, e, parts) {
    const cmd = parts[0]?.toLowerCase();
    if (!cmd?.startsWith('!')) return false;
    if (cmd === '!bsr') return bsrCommand(ch, e, parts);
    const name = cmd.slice(1);
    if (!COMMAND_NAME.test(name)) return false;
    return minecraftCommand(ch, e, name);
  }

  // ---- device API (KitsuFlowBOT Assistant app) ----
  app.get('/api/assistant/device/config', deviceAuth, (req, res) => {
    const channel = req.companion.channel;
    res.set('Cache-Control', 'no-store').json({
      channel: db.prepare('SELECT login FROM channels WHERE id=?').get(channel)?.login || '',
      bsr: { enabled: Boolean(bsrSettings(channel).enabled) },
      minecraft: {
        actions: db
          .prepare(
            'SELECT id,name,trigger_type,command,event_type,enabled FROM minecraft_actions WHERE channel=? ORDER BY name'
          )
          .all(channel)
      }
    });
  });
  app.get('/api/assistant/device/jobs', deviceAuth, (req, res) => {
    const { channel, id: deviceId } = req.companion;
    expire(channel);
    const jobs = db
      .prepare(
        "SELECT id,kind,payload FROM assistant_jobs WHERE channel=? AND status='pending' ORDER BY id LIMIT 5"
      )
      .all(channel);
    const claim = db.prepare(
      "UPDATE assistant_jobs SET status='delivered',device=?,updated=? WHERE id=? AND status='pending'"
    );
    const claimed = jobs.filter(j => claim.run(deviceId, Date.now(), j.id).changes);
    res.set('Cache-Control', 'no-store').json({
      jobs: claimed.map(j => ({ id: j.id, kind: j.kind, payload: JSON.parse(j.payload) }))
    });
  });
  app.post('/api/assistant/device/jobs/:id', deviceAuth, (req, res) => {
    const job = db
      .prepare('SELECT * FROM assistant_jobs WHERE id=? AND channel=?')
      .get(Number(req.params.id), req.companion.channel);
    if (!job) return res.status(404).json({ error: 'Unknown job' });
    if (typeof req.body?.ok !== 'boolean')
      return res.status(400).json({ error: 'Send { ok: true|false, message }' });
    const changed = finish(
      job,
      req.body.ok,
      String(req.body.message || (req.body.ok ? 'Done' : 'Failed'))
    );
    res.json({ ok: true, updated: changed });
  });

  // ---- Studio API (channel owner) ----
  const owner = [withUser, access.channelOnly('owner')];
  app.get('/api/assistant', ...owner, (req, res) => {
    const channel = req.channelId;
    expire(channel);
    const s = bsrSettings(channel);
    res.set('Cache-Control', 'no-store').json({
      online: online(channel),
      bsr: {
        enabled: Boolean(s.enabled),
        level: s.level,
        user_cooldown: s.user_cooldown,
        max_queue: s.max_queue
      },
      levels: LEVELS,
      event_types: EVENT_TYPES,
      platforms: PLATFORMS,
      actions: db
        .prepare('SELECT * FROM minecraft_actions WHERE channel=? ORDER BY name')
        .all(channel)
        .map(a => ({
          ...a,
          enabled: Boolean(a.enabled),
          commands: JSON.parse(a.commands).join('\n')
        })),
      jobs: db
        .prepare(
          'SELECT id,kind,payload,status,result,requester,created FROM assistant_jobs WHERE channel=? ORDER BY id DESC LIMIT 40'
        )
        .all(channel)
        .map(j => {
          const p = JSON.parse(j.payload);
          return {
            id: j.id,
            kind: j.kind,
            status: j.status,
            result: j.result,
            requester: j.requester,
            created: j.created,
            title:
              j.kind === 'bsr' ? p.songAuthor + ' - ' + p.songName + ' [' + p.key + ']' : p.action
          };
        })
    });
  });
  app.post('/api/assistant/bsr', ...owner, csrf, (req, res) => {
    const b = req.body || {},
      cooldown = Number(b.user_cooldown),
      maxQueue = Number(b.max_queue);
    if (
      typeof b.enabled !== 'boolean' ||
      !LEVELS.includes(b.level) ||
      !Number.isInteger(cooldown) ||
      cooldown < 0 ||
      cooldown > 3600 ||
      !Number.isInteger(maxQueue) ||
      maxQueue < 1 ||
      maxQueue > 100
    )
      return res.status(400).json({ error: 'Invalid song request settings' });
    db.prepare(
      'INSERT INTO bsr_settings(channel,enabled,level,user_cooldown,max_queue) VALUES(?,?,?,?,?) ON CONFLICT(channel) DO UPDATE SET enabled=excluded.enabled,level=excluded.level,user_cooldown=excluded.user_cooldown,max_queue=excluded.max_queue'
    ).run(req.channelId, b.enabled ? 1 : 0, b.level, cooldown, maxQueue);
    res.json({ ok: true });
  });
  app.post(
    '/api/assistant/minecraft',
    ...owner,
    csrf,
    safe(async (req, res) => {
      const b = req.body || {};
      const id = b.id ? Number(b.id) : null;
      const name = clean(b.name, 40);
      if (!name) throw Error('Give the action a name');
      if (!['command', 'event'].includes(b.trigger_type))
        throw Error('Choose a chat command or a stream event trigger');
      const commands = parseRconTemplate(b.commands);
      const cost = Number(b.cost) || 0,
        cooldown = Number(b.cooldown) || 0,
        minAmount = Number(b.min_amount) || 0;
      if (!Number.isInteger(cost) || cost < 0 || cost > 1000000)
        throw Error('Point cost must be 0–1,000,000');
      if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 86400)
        throw Error('Cooldown must be 0–86400 seconds');
      if (!LEVELS.includes(b.level || 'everyone')) throw Error('Invalid permission level');
      let command = null,
        eventPlatform = null,
        eventType = null;
      if (b.trigger_type === 'command') {
        command = String(b.command || '')
          .toLowerCase()
          .replace(/^!/, '');
        if (!COMMAND_NAME.test(command)) throw Error('Command must be 2–24 letters, numbers or _');
        if (command === 'bsr' || reservedCommands().includes(command))
          throw Error('!' + command + ' is already a built-in command');
        if (
          db
            .prepare('SELECT 1 FROM commands WHERE channel=? AND name=?')
            .get(req.channelId, command)
        )
          throw Error('!' + command + ' is already a custom command');
        const clash = db
          .prepare(
            "SELECT id FROM minecraft_actions WHERE channel=? AND trigger_type='command' AND command=?"
          )
          .get(req.channelId, command);
        if (clash && clash.id !== id) throw Error('Another action already uses !' + command);
      } else {
        eventPlatform = String(b.event_platform || 'any');
        eventType = String(b.event_type || '');
        if (!PLATFORMS.includes(eventPlatform) || !EVENT_TYPES.includes(eventType))
          throw Error('Choose a valid platform and event');
        if (!Number.isFinite(minAmount) || minAmount < 0)
          throw Error('Minimum amount must be 0 or more');
      }
      const values = [
        name,
        b.enabled === false ? 0 : 1,
        b.trigger_type,
        command,
        eventPlatform,
        eventType,
        minAmount,
        b.level || 'everyone',
        cost,
        cooldown,
        JSON.stringify(commands),
        clean(b.reply, 300)
      ];
      if (id) {
        const changed = db
          .prepare(
            'UPDATE minecraft_actions SET name=?,enabled=?,trigger_type=?,command=?,event_platform=?,event_type=?,min_amount=?,level=?,cost=?,cooldown=?,commands=?,reply=? WHERE id=? AND channel=?'
          )
          .run(...values, id, req.channelId).changes;
        if (!changed) return res.status(404).json({ error: 'Action not found' });
        return res.json({ ok: true, id });
      }
      const created = db
        .prepare(
          'INSERT INTO minecraft_actions(name,enabled,trigger_type,command,event_platform,event_type,min_amount,level,cost,cooldown,commands,reply,channel) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run(...values, req.channelId);
      res.json({ ok: true, id: Number(created.lastInsertRowid) });
    })
  );
  app.delete('/api/assistant/minecraft/:id', ...owner, csrf, (req, res) => {
    db.prepare('DELETE FROM minecraft_actions WHERE id=? AND channel=?').run(
      Number(req.params.id),
      req.channelId
    );
    res.json({ ok: true });
  });
  app.post('/api/assistant/minecraft/:id/test', ...owner, csrf, (req, res) => {
    const action = db
      .prepare('SELECT * FROM minecraft_actions WHERE id=? AND channel=?')
      .get(Number(req.params.id), req.channelId);
    if (!action) return res.status(404).json({ error: 'Action not found' });
    if (!online(req.channelId))
      return res
        .status(409)
        .json({ error: 'The KitsuFlowBOT Assistant app is not running on your PC' });
    const login =
      db.prepare('SELECT login FROM channels WHERE id=?').get(req.channelId)?.login || 'streamer';
    const id = enqueue(
      req.channelId,
      'minecraft',
      actionPayload(action, login, action.min_amount || 1)
    );
    res.json({ ok: true, job: id });
  });
  app.post('/api/assistant/jobs/:id/cancel', ...owner, csrf, (req, res) => {
    const job = db
      .prepare(
        "SELECT * FROM assistant_jobs WHERE id=? AND channel=? AND status IN ('pending','delivered')"
      )
      .get(Number(req.params.id), req.channelId);
    if (!job) return res.status(404).json({ error: 'Nothing to cancel' });
    db.prepare(
      "UPDATE assistant_jobs SET status='failed',result='Cancelled in Studio',updated=? WHERE id=?"
    ).run(Date.now(), job.id);
    refund(job);
    res.json({ ok: true });
  });

  return { onMessage, onActivity, enqueue };
}
