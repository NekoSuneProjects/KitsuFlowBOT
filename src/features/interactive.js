// Twitch Interactive: viewer-triggered OBS overlay actions (!slap, !boop, !pat @streamer …) and
// "Chat Plays" (chat presses NES/GBA buttons in a browser emulator page the streamer captures).
// Both are read by public pages keyed by an unguessable per-channel key; nothing here touches
// the streamer's PC, and ROMs never leave the streamer's browser.
import crypto from 'node:crypto';

const COMMAND_NAME = /^[a-z0-9_]{2,24}$/;
const LEVELS = ['everyone', 'subscriber', 'vip', 'moderator'];
const SOUND_MODES = ['streamer', 'always', 'never'];
// GIF sources: fixed, known APIs only (the server fetches them, so no user-supplied hosts).
const PROVIDERS = {
  none: null,
  'nekos:pat': 'https://nekos.life/api/v2/img/pat',
  'nekos:hug': 'https://nekos.life/api/v2/img/hug',
  'nekos:cuddle': 'https://nekos.life/api/v2/img/cuddle',
  'nekos:slap': 'https://nekos.life/api/v2/img/slap',
  'nekos:feed': 'https://nekos.life/api/v2/img/feed',
  'nekos:kiss': 'https://nekos.life/api/v2/img/kiss',
  'nekos:poke': 'https://nekos.life/api/v2/img/poke',
  'nekos:tickle': 'https://nekos.life/api/v2/img/tickle',
  'nekosune:boop': 'https://api.nekosunevr.co.uk/v3/images/api/boop'
};
// Defaults seeded for a new channel, based on the streamer's original overlay script.
const DEFAULT_OVERLAYS = [
  ['pat', 'headpat', 'nekos:pat', '', '', '{target}, you just got pats from @{user}'],
  ['hug', '', 'nekos:cuddle', '', '', '{target}, you just got hugged by @{user}'],
  [
    'slap',
    'punch',
    'nekos:slap',
    '',
    'https://www.myinstants.com/media/sounds/slap-sound-effect-free.mp3',
    '{target}, you just got slapped by @{user}'
  ],
  [
    'boop',
    '',
    'nekosune:boop',
    '',
    'https://www.myinstants.com/media/sounds/partyfavorraspypart_ac01_3_5HTQ8CW.mp3',
    '{target}, you just got booped by @{user}'
  ],
  ['feed', '', 'nekos:feed', '', '', '{target}, you just got fed by @{user}'],
  [
    'kiss',
    '',
    'nekos:kiss',
    '',
    'https://www.myinstants.com/media/sounds/smoochykiss.mp3',
    '{target}, you just got a kiss from @{user}'
  ],
  ['poke', '', 'nekos:poke', '', '', '{target}, you just got poked by @{user}'],
  ['tickle', '', 'nekos:tickle', '', '', '{target}, you just got tickled by @{user}'],
  [
    'gun',
    '',
    'none',
    'https://media.tenor.com/ML22x1td-u0AAAAC/machine-gun-cat.gif',
    'https://www.myinstants.com/media/sounds/gunreload.mp3',
    '{target}, a gun has been pulled on you by @{user}'
  ],
  [
    'reverse',
    '',
    'none',
    'https://i.kym-cdn.com/photos/images/original/001/580/532/b35.gif',
    '',
    '{target}, you just got reversed by @{user}'
  ]
];
// Chat Plays buttons -> libretro joypad index used by EmulatorJS simulateInput().
export const BUTTONS = {
  b: 0,
  select: 2,
  start: 3,
  up: 4,
  down: 5,
  left: 6,
  right: 7,
  a: 8,
  l: 10,
  r: 11
};
const SYSTEM_BUTTONS = {
  nes: ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select'],
  gba: ['up', 'down', 'left', 'right', 'a', 'b', 'l', 'r', 'start', 'select']
};
const ALIASES = { u: 'up', d: 'down', sel: 'select' };
const RING = 60;

const clean = (value, max = 120) =>
  String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);
const httpsUrl = value => {
  const text = String(value || '').trim();
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    throw Error('"' + text.slice(0, 60) + '" is not a valid URL');
  }
  if (url.protocol !== 'https:' || text.length > 500)
    throw Error('GIF and sound links must be https:// URLs (500 characters max)');
  return url.href;
};
const safeTarget = value =>
  String(value || '')
    .replace(/[^A-Za-z0-9_@]/g, '')
    .slice(0, 26);

// Parses a chat message as a Chat Plays input: "up", "a", "left3", "b x2" → { button, repeat }.
export function parseInput(text, system, maxRepeat) {
  const m = String(text || '')
    .trim()
    .toLowerCase()
    .match(/^([a-z]+)(?:\s*x?\s*(\d))?$/);
  if (!m) return null;
  const button = ALIASES[m[1]] || m[1];
  if (!(SYSTEM_BUTTONS[system] || SYSTEM_BUTTONS.nes).includes(button)) return null;
  const repeat = Math.max(1, Math.min(maxRepeat, Number(m[2] || 1)));
  return { button, repeat };
}

export function installInteractive({ app, db, withUser, csrf, safe, access, say, log }) {
  db.exec(`CREATE TABLE IF NOT EXISTS interactive_settings(channel TEXT PRIMARY KEY,
    public_key TEXT NOT NULL UNIQUE,overlay_enabled INTEGER NOT NULL DEFAULT 1,volume REAL NOT NULL DEFAULT 0.3,
    duration_ms INTEGER NOT NULL DEFAULT 7500,chatplays_enabled INTEGER NOT NULL DEFAULT 0,
    system TEXT NOT NULL DEFAULT 'nes',mode TEXT NOT NULL DEFAULT 'anarchy',vote_seconds INTEGER NOT NULL DEFAULT 8,
    user_gap_ms INTEGER NOT NULL DEFAULT 1500,max_repeat INTEGER NOT NULL DEFAULT 5,
    allow_start INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS overlay_actions(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,
    command TEXT NOT NULL,aliases TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,
    provider TEXT NOT NULL DEFAULT 'none',gif_url TEXT NOT NULL DEFAULT '',sound_url TEXT NOT NULL DEFAULT '',
    sound_mode TEXT NOT NULL DEFAULT 'streamer',text TEXT NOT NULL,level TEXT NOT NULL DEFAULT 'everyone',
    cost INTEGER NOT NULL DEFAULT 0,cooldown INTEGER NOT NULL DEFAULT 10);
  CREATE INDEX IF NOT EXISTS overlay_actions_channel ON overlay_actions(channel,command);`);

  const ensure = channel => {
    const inserted = db
      .prepare('INSERT OR IGNORE INTO interactive_settings(channel,public_key) VALUES(?,?)')
      .run(channel, crypto.randomBytes(24).toString('hex')).changes;
    if (inserted && !db.prepare('SELECT 1 FROM overlay_actions WHERE channel=?').get(channel)) {
      const add = db.prepare(
        'INSERT INTO overlay_actions(channel,command,aliases,provider,gif_url,sound_url,text) VALUES(?,?,?,?,?,?,?)'
      );
      for (const row of DEFAULT_OVERLAYS) add.run(channel, ...row);
    }
    return db.prepare('SELECT * FROM interactive_settings WHERE channel=?').get(channel);
  };
  const byKey = key =>
    db.prepare('SELECT * FROM interactive_settings WHERE public_key=?').get(String(key || ''));
  const badge = (e, ...sets) => Boolean(e.badges?.some(b => sets.includes(b.set_id)));
  const permitted = (level, e) =>
    badge(e, 'broadcaster', 'moderator') ||
    level === 'everyone' ||
    (level === 'vip' && badge(e, 'vip')) ||
    (level === 'subscriber' && badge(e, 'subscriber', 'founder', 'vip'));
  const debit = (channel, user, cost) =>
    !cost ||
    db
      .prepare('UPDATE loyalty SET points=points-? WHERE channel=? AND user_id=? AND points>=?')
      .run(cost, channel, user, cost).changes > 0;

  // Per-channel in-memory event rings, read by the public pages with ?after=<id>.
  const rings = new Map();
  let nextId = Date.now();
  const push = (channel, type, data) => {
    const ring = rings.get(channel + ':' + type) || [];
    ring.push({ id: ++nextId, ...data });
    if (ring.length > RING) ring.splice(0, ring.length - RING);
    rings.set(channel + ':' + type, ring);
  };
  const since = (channel, type, after) =>
    (rings.get(channel + ':' + type) || []).filter(x => x.id > after);

  // ---- overlay actions ----
  // Overlay events are only made while an overlay page is polling, so viewers aren't charged
  // (and GIF APIs aren't called) for an overlay nobody has open.
  const overlayPolls = new Map();
  const overlayOpen = channel => Date.now() - (overlayPolls.get(channel) || 0) < 60000;
  async function resolveGif(action) {
    const endpoint = PROVIDERS[action.provider];
    if (endpoint) {
      try {
        const response = await fetch(endpoint, {
          headers: { Accept: 'application/json', 'User-Agent': 'KitsuFlowBOT' },
          redirect: 'error',
          signal: AbortSignal.timeout(5000)
        });
        if (response.ok) {
          const data = await response.json();
          const url = String(data?.url || '');
          if (/^https:\/\/[^\s"'<>]{1,490}$/.test(url))
            return { gif: url, duration: Number(data.duration) || 0 };
        }
      } catch (err) {
        log(action.channel, 'interactive-gif-error', action.provider + ': ' + err.message);
      }
    }
    return { gif: action.gif_url || '', duration: 0 };
  }
  async function fire(channel, action, user, target) {
    const s = ensure(channel);
    const streamer = db.prepare('SELECT login FROM channels WHERE id=?').get(channel)?.login || '';
    const isStreamer = target.replace(/^@/, '').toLowerCase() === streamer.toLowerCase();
    const { gif, duration } = await resolveGif(action);
    const sound =
      action.sound_url &&
      (action.sound_mode === 'always' || (action.sound_mode === 'streamer' && isStreamer))
        ? action.sound_url
        : '';
    push(channel, 'overlay', {
      command: action.command,
      gif,
      sound,
      volume: s.volume,
      duration: Math.max(2000, Math.min(30000, duration || s.duration_ms)),
      text: clean(action.text.replaceAll('{target}', target).replaceAll('{user}', user), 200)
    });
  }
  const overlayCooldowns = new Map();
  const findOverlay = (channel, name) =>
    db
      .prepare('SELECT * FROM overlay_actions WHERE channel=? AND enabled=1')
      .all(channel)
      .find(
        a =>
          a.command === name ||
          a.aliases
            .split(',')
            .map(x => x.trim())
            .includes(name)
      );
  // Never consumes the message unless it refuses it, so existing text commands such as !hug
  // still reply in chat alongside the overlay.
  async function overlayCommand(ch, e, name, parts) {
    const s = ensure(ch.id);
    if (!s.overlay_enabled) return false;
    const action = findOverlay(ch.id, name);
    if (!action || !overlayOpen(ch.id)) return false;
    const target = safeTarget(parts[1]);
    if (!target || !permitted(action.level, e)) return false;
    const user = safeTarget(e.chatter_user_name || e.chatter_user_login) || 'viewer';
    const key = ch.id + ':' + action.id + ':' + e.chatter_user_id,
      now = Date.now();
    if (now - (overlayCooldowns.get(key) || 0) < action.cooldown * 1000) return false;
    if (!debit(ch.id, e.chatter_user_id, action.cost)) {
      await say(ch.id, '@' + user + ' !' + action.command + ' costs ' + action.cost + ' points.');
      return true;
    }
    overlayCooldowns.set(key, now);
    if (overlayCooldowns.size > 5000)
      for (const [k, t] of overlayCooldowns) if (now - t > 3600000) overlayCooldowns.delete(k);
    await fire(ch.id, action, user, target.startsWith('@') ? target : '@' + target);
    return false;
  }

  // ---- Chat Plays ----
  const lastInput = new Map();
  const votes = new Map(); // channel -> { started, ballots: Map(user -> "button:repeat") }
  function chatPlays(ch, e, text) {
    const s = ensure(ch.id);
    if (!s.chatplays_enabled) return false;
    const input = parseInput(text, s.system, s.max_repeat);
    if (!input) return false;
    if ((input.button === 'start' || input.button === 'select') && !s.allow_start) {
      if (!badge(e, 'broadcaster', 'moderator')) return true;
    }
    const user = safeTarget(e.chatter_user_name || e.chatter_user_login) || 'viewer';
    if (s.mode === 'democracy') {
      const round = votes.get(ch.id) || { started: Date.now(), ballots: new Map() };
      round.ballots.set(e.chatter_user_id, input.button + ':' + input.repeat);
      votes.set(ch.id, round);
      return true;
    }
    const key = ch.id + ':' + e.chatter_user_id,
      now = Date.now();
    if (now - (lastInput.get(key) || 0) < s.user_gap_ms) return true;
    lastInput.set(key, now);
    if (lastInput.size > 10000)
      for (const [k, t] of lastInput) if (now - t > 600000) lastInput.delete(k);
    push(ch.id, 'input', { ...input, index: BUTTONS[input.button], user });
    return true;
  }
  const tally = round => {
    const counts = new Map();
    for (const v of round.ballots.values()) counts.set(v, (counts.get(v) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };
  // Closes democracy rounds: the most-voted input is pressed once the window ends.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [channel, round] of votes) {
      const s = db.prepare('SELECT * FROM interactive_settings WHERE channel=?').get(channel);
      if (!s || s.mode !== 'democracy' || !s.chatplays_enabled) {
        votes.delete(channel);
        continue;
      }
      if (now - round.started < s.vote_seconds * 1000) continue;
      votes.delete(channel);
      const [winner] = tally(round);
      if (!winner) continue;
      const [button, repeat] = winner[0].split(':');
      push(channel, 'input', {
        button,
        repeat: Number(repeat),
        index: BUTTONS[button],
        user: 'chat vote (' + winner[1] + '/' + round.ballots.size + ')'
      });
    }
  }, 500);
  timer.unref?.();

  // Chat entry point (Twitch). Returns true when the message was fully handled here.
  async function onMessage(ch, e, value, parts) {
    const cmd = parts[0]?.toLowerCase() || '';
    if (cmd.startsWith('!')) {
      const name = cmd.slice(1);
      return COMMAND_NAME.test(name) ? overlayCommand(ch, e, name, parts) : false;
    }
    return chatPlays(ch, e, value);
  }

  // ---- public pages (OBS browser sources) ----
  const page = file => (req, res) => {
    if (!byKey(req.params.key)) return res.sendStatus(404);
    res
      .set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
      .sendFile(file, { root: process.cwd() + '/public' });
  };
  app.get('/interactive/overlay/:key', page('interactive-overlay.html'));
  app.get('/interactive/chatplays/:key', page('chatplays.html'));
  const afterOf = req => Math.max(0, Number.parseInt(String(req.query.after || '0'), 10) || 0);
  app.get('/api/interactive/public/:key/overlay', (req, res) => {
    const s = byKey(req.params.key);
    if (!s) return res.sendStatus(404);
    overlayPolls.set(s.channel, Date.now());
    res
      .set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
      .json({ latest: nextId, events: since(s.channel, 'overlay', afterOf(req)) });
  });
  app.get('/api/interactive/public/:key/chatplays', (req, res) => {
    const s = byKey(req.params.key);
    if (!s) return res.sendStatus(404);
    const round = votes.get(s.channel);
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).json({
      latest: nextId,
      enabled: Boolean(s.chatplays_enabled),
      system: s.system,
      mode: s.mode,
      buttons: SYSTEM_BUTTONS[s.system],
      vote:
        s.mode === 'democracy'
          ? {
              seconds_left: round
                ? Math.max(
                    0,
                    Math.ceil((round.started + s.vote_seconds * 1000 - Date.now()) / 1000)
                  )
                : s.vote_seconds,
              tally: round ? tally(round).slice(0, 5) : []
            }
          : null,
      inputs: since(s.channel, 'input', afterOf(req))
    });
  });

  // ---- Studio API ----
  const owner = [withUser, access.channelOnly('owner')];
  app.get('/api/interactive', ...owner, (req, res) => {
    const s = ensure(req.channelId);
    res.set('Cache-Control', 'no-store').json({
      settings: {
        overlay_enabled: Boolean(s.overlay_enabled),
        volume: s.volume,
        duration_ms: s.duration_ms,
        chatplays_enabled: Boolean(s.chatplays_enabled),
        system: s.system,
        mode: s.mode,
        vote_seconds: s.vote_seconds,
        user_gap_ms: s.user_gap_ms,
        max_repeat: s.max_repeat,
        allow_start: Boolean(s.allow_start)
      },
      overlay_url: '/interactive/overlay/' + s.public_key,
      chatplays_url: '/interactive/chatplays/' + s.public_key,
      providers: Object.keys(PROVIDERS),
      levels: LEVELS,
      sound_modes: SOUND_MODES,
      systems: Object.keys(SYSTEM_BUTTONS),
      actions: db
        .prepare('SELECT * FROM overlay_actions WHERE channel=? ORDER BY command')
        .all(req.channelId)
        .map(a => ({ ...a, enabled: Boolean(a.enabled) }))
    });
  });
  app.post('/api/interactive/settings', ...owner, csrf, (req, res) => {
    const b = req.body || {};
    const n = (v, lo, hi) => {
      const x = Number(v);
      return Number.isFinite(x) && x >= lo && x <= hi ? x : null;
    };
    const values = {
      volume: n(b.volume, 0, 1),
      duration_ms: n(b.duration_ms, 2000, 30000),
      vote_seconds: n(b.vote_seconds, 3, 60),
      user_gap_ms: n(b.user_gap_ms, 0, 60000),
      max_repeat: n(b.max_repeat, 1, 9)
    };
    if (
      Object.values(values).some(v => v === null) ||
      !Object.keys(SYSTEM_BUTTONS).includes(b.system) ||
      !['anarchy', 'democracy'].includes(b.mode)
    )
      return res.status(400).json({ error: 'Invalid interactive settings' });
    ensure(req.channelId);
    db.prepare(
      'UPDATE interactive_settings SET overlay_enabled=?,volume=?,duration_ms=?,chatplays_enabled=?,system=?,mode=?,vote_seconds=?,user_gap_ms=?,max_repeat=?,allow_start=? WHERE channel=?'
    ).run(
      b.overlay_enabled ? 1 : 0,
      values.volume,
      Math.round(values.duration_ms),
      b.chatplays_enabled ? 1 : 0,
      b.system,
      b.mode,
      Math.round(values.vote_seconds),
      Math.round(values.user_gap_ms),
      Math.round(values.max_repeat),
      b.allow_start ? 1 : 0,
      req.channelId
    );
    res.json({ ok: true });
  });
  app.post('/api/interactive/regenerate', ...owner, csrf, (req, res) => {
    ensure(req.channelId);
    db.prepare('UPDATE interactive_settings SET public_key=? WHERE channel=?').run(
      crypto.randomBytes(24).toString('hex'),
      req.channelId
    );
    res.json({ ok: true });
  });
  app.post(
    '/api/interactive/actions',
    ...owner,
    csrf,
    safe(async (req, res) => {
      const b = req.body || {};
      const id = b.id ? Number(b.id) : null;
      const command = String(b.command || '')
        .toLowerCase()
        .replace(/^!/, '');
      if (!COMMAND_NAME.test(command)) throw Error('Command must be 2–24 letters, numbers or _');
      const aliases = String(b.aliases || '')
        .toLowerCase()
        .split(',')
        .map(x => x.trim().replace(/^!/, ''))
        .filter(Boolean);
      if (aliases.length > 5 || aliases.some(a => !COMMAND_NAME.test(a)))
        throw Error('Up to 5 aliases, each 2–24 letters, numbers or _');
      if (!(b.provider in PROVIDERS)) throw Error('Choose a GIF source');
      if (!SOUND_MODES.includes(b.sound_mode)) throw Error('Choose when the sound plays');
      if (!LEVELS.includes(b.level || 'everyone')) throw Error('Invalid permission level');
      const text = clean(b.text, 160);
      if (!text) throw Error('Add the overlay text');
      const cost = Number(b.cost) || 0,
        cooldown = Number(b.cooldown) || 0;
      if (!Number.isInteger(cost) || cost < 0 || cost > 1000000)
        throw Error('Point cost must be 0–1,000,000');
      if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 86400)
        throw Error('Cooldown must be 0–86400 seconds');
      const names = [command, ...aliases];
      const clash = db
        .prepare('SELECT id,command,aliases FROM overlay_actions WHERE channel=?')
        .all(req.channelId)
        .find(
          a =>
            a.id !== id &&
            [a.command, ...a.aliases.split(',').filter(Boolean)].some(x => names.includes(x))
        );
      if (clash) throw Error('!' + clash.command + ' already uses one of those names');
      const values = [
        command,
        aliases.join(','),
        b.enabled === false ? 0 : 1,
        b.provider,
        httpsUrl(b.gif_url),
        httpsUrl(b.sound_url),
        b.sound_mode,
        text,
        b.level || 'everyone',
        cost,
        cooldown
      ];
      if (id) {
        const changed = db
          .prepare(
            'UPDATE overlay_actions SET command=?,aliases=?,enabled=?,provider=?,gif_url=?,sound_url=?,sound_mode=?,text=?,level=?,cost=?,cooldown=? WHERE id=? AND channel=?'
          )
          .run(...values, id, req.channelId).changes;
        if (!changed) return res.status(404).json({ error: 'Overlay action not found' });
        return res.json({ ok: true, id });
      }
      ensure(req.channelId);
      const created = db
        .prepare(
          'INSERT INTO overlay_actions(command,aliases,enabled,provider,gif_url,sound_url,sound_mode,text,level,cost,cooldown,channel) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run(...values, req.channelId);
      res.json({ ok: true, id: Number(created.lastInsertRowid) });
    })
  );
  app.delete('/api/interactive/actions/:id', ...owner, csrf, (req, res) => {
    db.prepare('DELETE FROM overlay_actions WHERE id=? AND channel=?').run(
      Number(req.params.id),
      req.channelId
    );
    res.json({ ok: true });
  });
  app.post(
    '/api/interactive/actions/:id/test',
    ...owner,
    csrf,
    safe(async (req, res) => {
      const action = db
        .prepare('SELECT * FROM overlay_actions WHERE id=? AND channel=?')
        .get(Number(req.params.id), req.channelId);
      if (!action) return res.status(404).json({ error: 'Overlay action not found' });
      const login =
        db.prepare('SELECT login FROM channels WHERE id=?').get(req.channelId)?.login || 'streamer';
      await fire(req.channelId, action, 'KitsuFlowBOT', '@' + login);
      res.json({ ok: true });
    })
  );
  app.post('/api/interactive/chatplays/test', ...owner, csrf, (req, res) => {
    const s = ensure(req.channelId);
    const input = parseInput(String(req.body?.button || ''), s.system, s.max_repeat);
    if (!input) return res.status(400).json({ error: 'Unknown button for ' + s.system });
    push(req.channelId, 'input', { ...input, index: BUTTONS[input.button], user: 'Studio test' });
    res.json({ ok: true });
  });

  return { onMessage };
}
