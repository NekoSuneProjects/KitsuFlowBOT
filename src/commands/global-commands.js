import { EXTRA_COMMANDS, createExtraCommands } from './extra-commands.js';

// Built-in chat commands every channel can toggle in Studio → Custom Commands → Global bot commands.
export const GLOBAL_COMMANDS = {
  commands: { level: 'everyone', description: "Show this channel's public commands page" },
  accountage: { level: 'everyone', description: 'Show Twitch account age' },
  followage: { level: 'everyone', description: 'Show how long a viewer has followed' },
  watchtime: { level: 'everyone', description: 'Show estimated chat-based watch time' },
  so: { level: 'moderator', description: 'Shout out a Twitch streamer' },
  addpoints: {
    level: 'supermod',
    description: 'Give loyalty points to a viewer or active chatters'
  },
  setpoints: { level: 'supermod', description: "Set a viewer's loyalty points" },
  setgame: { level: 'supermod', description: 'Change stream category/game' },
  settitle: { level: 'supermod', description: 'Change stream title' },
  ...EXTRA_COMMANDS
};

// "1 year 2 days" style durations, at most two units.
const duration = ms => {
  let seconds = Math.max(0, Math.floor(ms / 1000));
  if (!seconds) return '0 seconds';
  const out = [];
  for (const [n, label] of [
    [31536000, 'year'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
    [1, 'second']
  ]) {
    const value = Math.floor(seconds / n);
    if (value) {
      out.push(value + ' ' + label + (value === 1 ? '' : 's'));
      seconds -= value * n;
    }
    if (out.length >= 2) break;
  }
  return out.join(' ');
};
const numberArg = value => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 && n <= 1000000 ? n : null;
};

export function createGlobalCommands({ db, twitch, baseUrl, log }) {
  const { api, say, botId, resolveViewer } = twitch;
  const BASE = baseUrl;
  db.exec(`CREATE TABLE IF NOT EXISTS global_command_settings(channel TEXT NOT NULL,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(channel,name));
CREATE TABLE IF NOT EXISTS channel_supermods(channel TEXT NOT NULL,user_id TEXT NOT NULL,login TEXT NOT NULL,PRIMARY KEY(channel,user_id));`);
  const isGlobalEnabled = (channel, name) => {
    if (name === 'accept' || name === 'deny') name = 'duel';
    const row = db
      .prepare('SELECT enabled FROM global_command_settings WHERE channel=? AND name=?')
      .get(channel, name);
    return row
      ? row.enabled === 1
      : GLOBAL_COMMANDS[name]?.level !== 'supermod' && !GLOBAL_COMMANDS[name]?.defaultOff;
  };
  const globalListing = channel =>
    Object.entries(GLOBAL_COMMANDS)
      .filter(([, item]) => !item.hidden)
      .map(([name, item]) => ({ name, ...item, enabled: isGlobalEnabled(channel, name) }));
  const cooldowns = new Map();
  // Shared with the chat handler: recently active chatters and one-shot link permits.
  const recentChatters = new Map();
  const linkPermits = new Map();
  let extraCommands = null;
  const extras = () =>
    (extraCommands ||= createExtraCommands({
      db,
      api,
      say,
      resolveViewer,
      recentChatters,
      permits: linkPermits,
      log
    }));
  const runExtra = (name, ctx) => extras()(name, ctx);

  // Returns true when the message was an enabled global command (handled or refused).
  async function handle({ ch, e, parts, cmd, isMod }) {
    const globalName = cmd === '!command' ? 'commands' : cmd.slice(1);
    if (!GLOBAL_COMMANDS[globalName] || !isGlobalEnabled(ch.id, globalName)) return false;
    await run(globalName, { ch, e, parts, isMod });
    return true;
  }

  async function run(globalName, { ch, e, parts, isMod }) {
    const isOwner = e.chatter_user_id === ch.id;
    const supermod =
      isOwner ||
      Boolean(
        db
          .prepare('SELECT 1 FROM channel_supermods WHERE channel=? AND user_id=?')
          .get(ch.id, e.chatter_user_id)
      );
    const required = GLOBAL_COMMANDS[globalName].level;
    if ((required === 'moderator' && !isMod) || (required === 'supermod' && !supermod)) return;
    const perUser = GLOBAL_COMMANDS[globalName].perUser;
    const key = ch.id + ':global:' + globalName + (perUser ? ':' + e.chatter_user_id : ''),
      now = Date.now();
    if (now < (cooldowns.get(key) || 0)) return;
    cooldowns.set(key, now + (perUser ? 5000 : 10000));
    if (EXTRA_COMMANDS[globalName]) {
      await runExtra(globalName, { ch, e, parts });
      return;
    }
    const requestedLogin = (parts[1] || '').replace(/^@/, '');
    if (globalName === 'commands') {
      await say(
        ch.id,
        'Commands for ' + ch.login + ': ' + BASE + '/commands/' + encodeURIComponent(ch.login)
      );
      return;
    }
    if (globalName === 'accountage' || globalName === 'followage' || globalName === 'watchtime') {
      const viewer = requestedLogin
        ? await resolveViewer(requestedLogin)
        : { id: e.chatter_user_id, login: e.chatter_user_login, created_at: null };
      if (!viewer) {
        await say(ch.id, 'Twitch user not found.');
        return;
      }
      const who = viewer.login || e.chatter_user_login;
      if (globalName === 'watchtime') {
        const points = db
          .prepare('SELECT watch_minutes FROM loyalty WHERE channel=? AND user_id=?')
          .get(ch.id, viewer.id);
        await say(
          ch.id,
          who +
            ' has spent ' +
            duration((points?.watch_minutes || 0) * 60000) +
            ' watching ' +
            ch.login +
            ' (estimated from chat activity).'
        );
        return;
      }
      if (globalName === 'accountage') {
        const user = viewer.created_at
          ? viewer
          : (await api(botId(), 'users?id=' + encodeURIComponent(viewer.id))).data?.[0];
        await say(
          ch.id,
          user?.created_at
            ? who +
                ' created their Twitch account ' +
                duration(Date.now() - Date.parse(user.created_at)) +
                ' ago.'
            : 'Account age unavailable.'
        );
        return;
      }
      try {
        const response = await api(
          ch.id,
          'channels/followers?broadcaster_id=' +
            encodeURIComponent(ch.id) +
            '&user_id=' +
            encodeURIComponent(viewer.id)
        );
        const follow = response.data?.[0]?.followed_at;
        await say(
          ch.id,
          follow
            ? who +
                ' has followed ' +
                ch.login +
                ' for ' +
                duration(Date.now() - Date.parse(follow)) +
                '.'
            : who + ' is not currently following ' + ch.login + '.'
        );
      } catch (err) {
        await say(ch.id, 'Follow age unavailable: reconnect Twitch with follower permissions.');
      }
      return;
    }
    if (globalName === 'so') {
      if (!requestedLogin) {
        await say(ch.id, 'Usage: !so username');
        return;
      }
      const user = await resolveViewer(requestedLogin);
      if (!user) {
        await say(ch.id, 'Streamer not found.');
        return;
      }
      await say(
        ch.id,
        'Go check out ' +
          user.display_name +
          ' at https://www.twitch.tv/' +
          user.login +
          ' — show them some love!'
      );
      return;
    }
    if (globalName === 'settitle' || globalName === 'setgame') {
      const value = parts.slice(1).join(' ').trim();
      if (!value || value.length > 140) {
        await say(
          ch.id,
          'Usage: !' + globalName + ' ' + (globalName === 'settitle' ? 'new title' : 'game name')
        );
        return;
      }
      if (globalName === 'settitle') {
        await api(ch.id, 'channels?broadcaster_id=' + ch.id, 'PATCH', { title: value });
      } else {
        const games = await api(ch.id, 'games?name=' + encodeURIComponent(value));
        const game =
          games.data?.find(g => g.name.toLowerCase() === value.toLowerCase()) || games.data?.[0];
        if (!game) {
          await say(ch.id, 'Game/category not found.');
          return;
        }
        await api(ch.id, 'channels?broadcaster_id=' + ch.id, 'PATCH', { game_id: game.id });
      }
      await say(ch.id, 'Stream ' + (globalName === 'settitle' ? 'title' : 'game') + ' updated.');
      return;
    }
    if (globalName === 'addpoints' || globalName === 'setpoints') {
      const amount = numberArg(parts[2]);
      const target = parts[1]?.replace(/^@/, '');
      if (!target || amount === null) {
        await say(
          ch.id,
          'Usage: !' + globalName + ' username amount (addpoints also supports all active chatters)'
        );
        return;
      }
      if (target.toLowerCase() === 'all') {
        if (globalName === 'setpoints') {
          await say(ch.id, 'Use an individual viewer with !setpoints.');
          return;
        }
        const users = [...(recentChatters.get(ch.id) || new Map())].filter(
          ([, m]) => Date.now() - m.last <= 600000
        );
        const stmt =
          db.prepare(`INSERT INTO loyalty(channel,user_id,username,points,watch_minutes) VALUES(?,?,?,?,0)
    ON CONFLICT(channel,user_id) DO UPDATE SET username=excluded.username,points=MIN(1000000000,loyalty.points+excluded.points)`);
        db.transaction(() => {
          for (const [id, m] of users) stmt.run(ch.id, id, m.login, amount);
        })();
        await say(
          ch.id,
          'Added ' +
            amount +
            ' points to ' +
            users.length +
            ' chatters active in the past 10 minutes.'
        );
        return;
      }
      const viewer = await resolveViewer(target);
      if (!viewer) {
        await say(ch.id, 'Viewer not found.');
        return;
      }
      db.prepare(
        `INSERT INTO loyalty(channel,user_id,username,points,watch_minutes) VALUES(?,?,?,?,0)
    ON CONFLICT(channel,user_id) DO UPDATE SET username=excluded.username,points=${globalName === 'setpoints' ? 'excluded.points' : 'MIN(1000000000,loyalty.points+excluded.points)'}`
      ).run(ch.id, viewer.id, viewer.login, amount);
      await say(
        ch.id,
        viewer.login +
          ' points ' +
          (globalName === 'setpoints' ? 'set to ' : 'increased by ') +
          amount +
          '.'
      );
      return;
    }
  }

  // Non-command chat lines can answer an open trivia round.
  async function onTrivia(ch, e, value) {
    if (isGlobalEnabled(ch.id, 'trivia')) await extras().onChat(ch, e, value);
  }

  function registerRoutes(app, { withUser, csrf, safe, access }) {
    app.get('/api/commands/global', withUser, (req, res) =>
      res.json({
        commands: globalListing(req.channelId),
        supermods: db
          .prepare('SELECT login,user_id FROM channel_supermods WHERE channel=? ORDER BY login')
          .all(req.channelId)
      })
    );
    app.post('/api/commands/global', withUser, access.channelOnly('editor'), csrf, (req, res) => {
      const name = String(req.body.name || '').toLowerCase();
      if (!GLOBAL_COMMANDS[name] || typeof req.body.enabled !== 'boolean')
        return res.status(400).json({ error: 'Invalid global command setting' });
      db.prepare(
        'INSERT INTO global_command_settings(channel,name,enabled) VALUES(?,?,?) ON CONFLICT(channel,name) DO UPDATE SET enabled=excluded.enabled'
      ).run(req.channelId, name, req.body.enabled ? 1 : 0);
      res.json({ ok: true });
    });
    app.post(
      '/api/commands/supermod',
      withUser,
      access.channelOnly('owner'),
      csrf,
      safe(async (req, res) => {
        const login = String(req.body.login || '')
          .trim()
          .replace(/^@/, '');
        if (!/^[a-zA-Z0-9_]{3,25}$/.test(login)) throw Error('Enter a Twitch username');
        const user = await resolveViewer(login);
        if (!user) throw Error('Twitch user not found');
        if (req.body.enabled === true)
          db.prepare(
            'INSERT INTO channel_supermods(channel,user_id,login) VALUES(?,?,?) ON CONFLICT(channel,user_id) DO UPDATE SET login=excluded.login'
          ).run(req.channelId, user.id, user.login);
        else
          db.prepare('DELETE FROM channel_supermods WHERE channel=? AND user_id=?').run(
            req.channelId,
            user.id
          );
        res.json({ ok: true });
      })
    );
  }

  return {
    isGlobalEnabled,
    globalListing,
    handle,
    onTrivia,
    registerRoutes,
    recentChatters,
    linkPermits
  };
}
