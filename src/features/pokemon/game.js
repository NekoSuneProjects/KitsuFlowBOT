// KitsuFlow Pokémon chat game (PokemonCommunityGame-style).
// - Wild spawns while a channel is live; viewers !pokecatch with balls from their bag.
// - !pokeshop / !pokebuy spend the channel's loyalty points.
// - Pokédex + bag are global per Twitch user, so collections follow viewers between channels.
// - Raids: channel raids (mods) and Global Raids across every live channel with the game on.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

// All 1025 species (Gens 1–9) from PokeAPI data: [dex, name, generation, tier].
// Tier: c common, u uncommon, r rare, e epic, L legendary/mythical (raid-only).
// Rebuild pokedex.json from PokeAPI's pokemon_species CSVs if new generations are released.
export const DEX = JSON.parse(readFileSync(new URL('./pokedex.json', import.meta.url), 'utf8')).map(
  ([dex, name, gen, tier]) => ({ dex, name, gen, tier })
);
const EVOLUTIONS = JSON.parse(
  readFileSync(new URL('./pokedex-evolutions.json', import.meta.url), 'utf8')
); // fromDex -> [[toDex,minLevel,method]]
const DEX_TOTAL = DEX.length,
  GENS = [...new Set(DEX.map(p => p.gen))].sort((a, b) => a - b);
const TIERS = {
  c: { label: 'Common', weight: 55, catch: 0.75, power: 1 },
  u: { label: 'Uncommon', weight: 28, catch: 0.55, power: 1.2 },
  r: { label: 'Rare', weight: 13, catch: 0.38, power: 1.5 },
  e: { label: 'Epic', weight: 4, catch: 0.22, power: 2 },
  L: { label: 'Legendary', weight: 0, catch: 0.12, power: 3 }
};
const BALLS = {
  pokeball: { name: 'Poké Ball', mult: 1, price: 100 },
  greatball: { name: 'Great Ball', mult: 1.5, price: 300 },
  ultraball: { name: 'Ultra Ball', mult: 2, price: 600 },
  masterball: { name: 'Master Ball', mult: Infinity, price: 15000 }
};
const ITEMS = {
  ...Object.fromEntries(
    Object.entries(BALLS).map(([k, v]) => [
      k,
      {
        name: v.name,
        price: v.price,
        desc: 'x' + (v.mult === Infinity ? '∞ (never fails)' : v.mult) + ' catch rate'
      }
    ])
  ),
  rarecandy: { name: 'Rare Candy', price: 250, desc: '+1 level: !pokecandy <pokemon>' },
  lure: { name: 'Lure', price: 800, desc: 'Spawns a wild Pokémon now: !pokelure' },
  evostone: {
    name: 'Evo Stone',
    price: 1500,
    desc: 'Evolves stone/friendship/trade Pokémon: !pokeevolve'
  }
};
const ALIASES = {
  poke: 'pokeball',
  pokeball: 'pokeball',
  ball: 'pokeball',
  great: 'greatball',
  greatball: 'greatball',
  ultra: 'ultraball',
  ultraball: 'ultraball',
  master: 'masterball',
  masterball: 'masterball',
  candy: 'rarecandy',
  rarecandy: 'rarecandy',
  lure: 'lure',
  stone: 'evostone',
  evostone: 'evostone'
};
const MARKET_MAX = 10,
  TRADE_MS = 120000,
  CHAT_XP = 5,
  CHAT_XP_MS = 60000;
// XP needed to go from `level` to `level+1`.
const need = level => 10 + level * 3;
const STARTER_BALLS = 5,
  CATCH_WINDOW = 90000,
  RAID_MINUTES = 10,
  SHINY_ODDS = 256;
const rand = n => crypto.randomInt(n);
const pick = a => (a.length ? a[rand(a.length)] : undefined);
const chance = p => crypto.randomInt(1000000) < p * 1000000;
const key = n =>
  String(n || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9♀♂]/g, '');
const NAME_INDEX = new Map(DEX.map(p => [key(p.name), p]));
const byName = n => NAME_INDEX.get(key(n));
const parseGens = v => {
  const set = new Set(
    String(v || '')
      .split(',')
      .map(Number)
      .filter(g => GENS.includes(g))
  );
  return set.size ? set : new Set(GENS);
};
const displayName = e =>
  /^[A-Za-z0-9_]{1,25}$/.test(e.chatter_user_name || '')
    ? e.chatter_user_name
    : e.chatter_user_login || 'viewer';

export function installPokemon({
  app,
  db,
  withUser,
  csrf,
  access,
  api,
  say,
  log,
  isOperator,
  botId
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS poke_settings(channel TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,spawn_minutes INTEGER NOT NULL DEFAULT 15,last_spawn INTEGER NOT NULL DEFAULT 0,global_raids INTEGER NOT NULL DEFAULT 1,gens TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS poke_bag(user_id TEXT NOT NULL,item TEXT NOT NULL,qty INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,item));
 CREATE TABLE IF NOT EXISTS poke_trainers(user_id TEXT PRIMARY KEY,login TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS poke_caught(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,login TEXT NOT NULL,dex INTEGER NOT NULL,level INTEGER NOT NULL,shiny INTEGER NOT NULL DEFAULT 0,channel TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'wild',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS poke_caught_user ON poke_caught(user_id,dex);
 CREATE TABLE IF NOT EXISTS poke_events(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  try {
    db.exec("ALTER TABLE poke_settings ADD COLUMN gens TEXT NOT NULL DEFAULT ''");
  } catch {} // older installs
  try {
    db.exec('ALTER TABLE poke_caught ADD COLUMN xp INTEGER NOT NULL DEFAULT 0');
  } catch {}
  try {
    db.exec('ALTER TABLE poke_trainers ADD COLUMN primary_id INTEGER');
  } catch {}
  db.exec(`CREATE TABLE IF NOT EXISTS poke_dex(user_id TEXT NOT NULL,dex INTEGER NOT NULL,PRIMARY KEY(user_id,dex));
 INSERT OR IGNORE INTO poke_dex(user_id,dex) SELECT user_id,dex FROM poke_caught;
 CREATE TABLE IF NOT EXISTS poke_market(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,seller_id TEXT NOT NULL,seller_login TEXT NOT NULL,mon_id INTEGER NOT NULL,price INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'open',buyer_id TEXT,buyer_login TEXT,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,closed TEXT);
 CREATE INDEX IF NOT EXISTS poke_market_open ON poke_market(channel,status,id);
 CREATE UNIQUE INDEX IF NOT EXISTS poke_market_mon_open ON poke_market(mon_id) WHERE status='open';`);
  const settings = ch =>
    db.prepare('SELECT * FROM poke_settings WHERE channel=?').get(ch) || {
      channel: ch,
      enabled: 0,
      spawn_minutes: 15,
      last_spawn: 0,
      global_raids: 1,
      gens: ''
    };
  const event = (ch, kind, detail) =>
    db
      .prepare('INSERT INTO poke_events(channel,kind,detail) VALUES(?,?,?)')
      .run(ch, kind, String(detail).slice(0, 300));
  const points = (ch, user) =>
    db.prepare('SELECT points FROM loyalty WHERE channel=? AND user_id=?').get(ch, user)?.points ||
    0;
  const spend = (ch, user, n) =>
    db
      .prepare('UPDATE loyalty SET points=points-? WHERE channel=? AND user_id=? AND points>=?')
      .run(n, ch, user, n).changes > 0;
  const award = (ch, user, login, n) =>
    db
      .prepare(
        `INSERT INTO loyalty(channel,user_id,username,points,watch_minutes) VALUES(?,?,?,?,0)
  ON CONFLICT(channel,user_id) DO UPDATE SET points=MIN(1000000000,loyalty.points+excluded.points)`
      )
      .run(ch, user, login, n);
  const qty = (user, item) =>
    db.prepare('SELECT qty FROM poke_bag WHERE user_id=? AND item=?').get(user, item)?.qty || 0;
  const give = (user, item, n) =>
    db
      .prepare(
        'INSERT INTO poke_bag(user_id,item,qty) VALUES(?,?,?) ON CONFLICT(user_id,item) DO UPDATE SET qty=MAX(0,poke_bag.qty+excluded.qty)'
      )
      .run(user, item, n);
  const take = (user, item) =>
    db.prepare('UPDATE poke_bag SET qty=qty-1 WHERE user_id=? AND item=? AND qty>0').run(user, item)
      .changes > 0;
  // First time a viewer plays they get starter balls.
  const trainer = e => {
    const r = db
      .prepare('INSERT OR IGNORE INTO poke_trainers(user_id,login) VALUES(?,?)')
      .run(e.chatter_user_id, e.chatter_user_login);
    if (r.changes) give(e.chatter_user_id, 'pokeball', STARTER_BALLS);
    return r.changes > 0;
  };
  const strongest = user =>
    db
      .prepare(
        'SELECT dex,level,shiny FROM poke_caught WHERE user_id=? ORDER BY level DESC,id ASC LIMIT 1'
      )
      .get(user);
  const label = (p, shiny, level) =>
    (shiny ? '✨Shiny ' : '') + p.name + (level ? ' (Lv ' + level + ')' : '');
  const monLabel = m => label(DEX[m.dex - 1], m.shiny, m.level);
  const recordDex = (user, dex) =>
    db.prepare('INSERT OR IGNORE INTO poke_dex(user_id,dex) VALUES(?,?)').run(user, dex).changes >
    0;
  const dexCount = user =>
    db.prepare('SELECT COUNT(*) n FROM poke_dex WHERE user_id=?').get(user).n;
  const addMon = (user, login, dex, level, shiny, channel, source = 'wild') => {
    const id = db
      .prepare(
        'INSERT INTO poke_caught(user_id,login,dex,level,shiny,channel,source) VALUES(?,?,?,?,?,?,?)'
      )
      .run(user, login, dex, level, shiny ? 1 : 0, channel, source).lastInsertRowid;
    const fresh = recordDex(user, dex);
    return { id: Number(id), fresh };
  };
  const getMon = id => db.prepare('SELECT * FROM poke_caught WHERE id=?').get(id);
  const isListed = id =>
    Boolean(db.prepare("SELECT 1 FROM poke_market WHERE mon_id=? AND status='open'").get(id));
  const primaryOf = user => {
    const t = db.prepare('SELECT primary_id FROM poke_trainers WHERE user_id=?').get(user);
    const m = t?.primary_id ? getMon(t.primary_id) : null;
    return m && m.user_id === user ? m : null;
  };
  // Pick one of the viewer's Pokémon by #id or name (name = highest level copy).
  const findMine = (user, text, { excludeListed = true, lowest = false } = {}) => {
    const t = String(text || '').trim();
    const idm = /^#?(\d{1,10})$/.exec(t);
    let m = null;
    if (idm) {
      m = getMon(Number(idm[1]));
      if (m?.user_id !== user) m = null;
    } else {
      const sp = byName(t);
      if (sp)
        m = db
          .prepare(
            "SELECT * FROM poke_caught WHERE user_id=? AND dex=? AND id NOT IN (SELECT mon_id FROM poke_market WHERE status='open') ORDER BY level " +
              (lowest ? 'ASC' : 'DESC') +
              ',id ASC LIMIT 1'
          )
          .get(user, sp.dex);
    }
    if (m && excludeListed && isListed(m.id)) return null;
    return m;
  };
  const evoText = m => {
    const opts = EVOLUTIONS[m.dex] || [];
    if (!opts.length) return 'final form';
    const lv = opts.filter(o => o[2] === 'level').map(o => o[1]);
    const other = opts.some(o => o[2] !== 'level');
    return (
      'evolves ' +
      [
        lv.length ? 'at Lv ' + Math.min(...lv) : '',
        other ? 'with an Evo Stone' + (opts.some(o => o[2] === 'trade') ? ' or trade' : '') : ''
      ]
        .filter(Boolean)
        .join(' / ')
    );
  };
  function evolve(m, toDex) {
    db.prepare('UPDATE poke_caught SET dex=? WHERE id=?').run(toDex, m.id);
    recordDex(m.user_id, toDex);
    return DEX[toDex - 1];
  }
  // Add XP / levels to one Pokémon; evolves at the correct level. Returns {levels,evolutions,level}.
  function grow(m, { xp = 0, levels = 0 }) {
    let level = m.level,
      cur = m.xp + xp,
      dex = m.dex;
    const evolutions = [];
    let gained = 0;
    const step = () => {
      level++;
      gained++;
      const opts = (EVOLUTIONS[dex] || []).filter(o => o[2] === 'level' && o[1] <= level);
      if (opts.length) {
        const o = pick(opts);
        evolutions.push([DEX[dex - 1].name, DEX[o[0] - 1].name]);
        dex = o[0];
        recordDex(m.user_id, dex);
      }
    };
    for (let i = 0; i < levels && level < 100; i++) step();
    while (level < 100 && cur >= need(level)) {
      cur -= need(level);
      step();
    }
    if (level >= 100) cur = 0;
    db.prepare('UPDATE poke_caught SET level=?,xp=?,dex=? WHERE id=?').run(level, cur, dex, m.id);
    return { levels: gained, evolutions, level, dex, xp: cur };
  }
  async function announceGrowth(ch, who, m, r) {
    for (const [a, b] of r.evolutions)
      await say(
        ch,
        '✨ What? ' +
          who +
          "'s " +
          a +
          ' is evolving... Congratulations! It evolved into ' +
          b +
          '! 🎉'
      ).catch(() => {});
    if (r.levels && !r.evolutions.length && (r.level % 5 === 0 || r.level === 100))
      await say(
        ch,
        '⬆️ ' + who + "'s " + DEX[r.dex - 1].name + ' reached Lv ' + r.level + '!'
      ).catch(() => {});
  }
  // XP for the viewer's primary Pokémon.
  async function primaryXp(ch, e, amount) {
    const m = primaryOf(e.chatter_user_id);
    if (!m) return;
    const r = grow(m, { xp: amount });
    await announceGrowth(ch, displayName(e), m, r);
  }
  const chatXpSeen = new Map();
  const trades = new Map(); // channel:targetId -> {from,fromLogin,give,want,expires}

  // ---- wild spawns ----
  const spawns = new Map(); // channel -> {p,shiny,level,expires,caught:Set,tried:Set}
  function rollWild(ch) {
    const gens = parseGens(settings(ch).gens),
      pool = DEX.filter(p => TIERS[p.tier].weight > 0 && gens.has(p.gen)),
      total = pool.reduce((a, p) => a + TIERS[p.tier].weight, 0);
    let r = rand(total);
    for (const p of pool) {
      r -= TIERS[p.tier].weight;
      if (r < 0) return p;
    }
    return pool[0];
  }
  async function spawn(ch, login, reason = 'wild') {
    const p = rollWild(ch),
      shiny = rand(SHINY_ODDS) === 0,
      level = 1 + rand(30);
    const s = {
      p,
      shiny,
      level,
      expires: Date.now() + CATCH_WINDOW,
      caught: new Set(),
      tried: new Set()
    };
    spawns.set(ch, s);
    db.prepare(
      'INSERT INTO poke_settings(channel,last_spawn) VALUES(?,?) ON CONFLICT(channel) DO UPDATE SET last_spawn=excluded.last_spawn'
    ).run(ch, Date.now());
    event(ch, 'spawn', label(p, shiny, level));
    const t = setTimeout(() => {
      if (spawns.get(ch) !== s) return;
      spawns.delete(ch);
      void say(
        ch,
        '💨 The wild ' +
          label(p, shiny) +
          ' fled!' +
          (s.caught.size
            ? ' Caught by ' + s.caught.size + ' trainer' + (s.caught.size === 1 ? '' : 's') + '.'
            : '')
      ).catch(() => {});
    }, CATCH_WINDOW);
    t.unref?.();
    await say(
      ch,
      (shiny ? '✨✨ A SHINY ' : '🌿 A wild ') +
        p.name +
        ' (Lv ' +
        level +
        ', ' +
        TIERS[p.tier].label +
        ', Gen ' +
        p.gen +
        ') appeared' +
        (reason === 'lure' ? ' from a Lure' : '') +
        '! Type !pokecatch [pokeball|greatball|ultraball|masterball] within 90s!'
    );
  }
  async function tick() {
    const rows = db
      .prepare(
        'SELECT p.*,c.login FROM poke_settings p JOIN channels c ON c.id=p.channel WHERE p.enabled=1 AND c.enabled=1'
      )
      .all();
    for (const r of rows) {
      if (spawns.has(r.channel) || Date.now() - r.last_spawn < r.spawn_minutes * 60000) continue;
      try {
        const live = await api(r.channel, 'streams?user_id=' + encodeURIComponent(r.channel));
        if (!live.data?.length) continue;
        await spawn(r.channel, r.login);
      } catch (err) {
        log(r.channel, 'pokemon-spawn-error', err.message);
      }
    }
  }
  setInterval(() => {
    void tick().catch(() => {});
  }, 60000).unref?.();

  // ---- raids ----
  // One global raid at a time (shared HP across channels) plus optional local raids per channel.
  let globalRaid = null;
  const localRaids = new Map();
  const raidFor = ch =>
    localRaids.get(ch) || (globalRaid && globalRaid.channels.has(ch) ? globalRaid : null);
  async function startRaid({ channels, global, starter }) {
    const gens = global ? new Set(GENS) : parseGens(settings(channels[0]).gens);
    const legends = DEX.filter(p => p.tier === 'L' && gens.has(p.gen)),
      boss = pick(legends.length ? legends : DEX.filter(p => p.tier === 'e')),
      hp = global ? 6000 : 1500;
    const raid = {
      boss,
      level: 50 + rand(21),
      hp,
      maxHp: hp,
      global,
      channels: new Set(channels),
      players: new Map(),
      ends: Date.now() + RAID_MINUTES * 60000,
      marks: new Set()
    };
    raid.timer = setTimeout(() => {
      void endRaid(raid, false).catch(() => {});
    }, RAID_MINUTES * 60000);
    raid.timer.unref?.();
    if (global) globalRaid = raid;
    else localRaids.set(channels[0], raid);
    for (const ch of channels) {
      event(ch, global ? 'global-raid' : 'raid', 'Started ' + boss.name + ' by ' + starter);
      await say(
        ch,
        (global ? '🌍 GLOBAL RAID! ' : '⚔️ RAID! ') +
          boss.name +
          ' (Lv ' +
          raid.level +
          ', ' +
          hp +
          ' HP) has appeared' +
          (global
            ? ' across ' + channels.length + ' channel' + (channels.length === 1 ? '' : 's')
            : '') +
          '! Type !pokeraid to attack. ' +
          RAID_MINUTES +
          ' minutes on the clock!'
      ).catch(err => log(ch, 'pokemon-raid-say', err.message));
    }
    return raid;
  }
  async function endRaid(raid, won) {
    clearTimeout(raid.timer);
    if (raid.global) {
      if (globalRaid === raid) globalRaid = null;
    } else for (const ch of raid.channels) if (localRaids.get(ch) === raid) localRaids.delete(ch);
    const players = [...raid.players.entries()].sort((a, b) => b[1].damage - a[1].damage);
    if (!won) {
      for (const ch of raid.channels)
        await say(
          ch,
          '💨 ' +
            raid.boss.name +
            ' escaped the raid with ' +
            raid.hp +
            ' HP left. Better luck next time!'
        ).catch(() => {});
      return;
    }
    const caughtBy = [],
      reward = raid.global ? 300 : 150;
    db.transaction(() => {
      players.forEach(([id, m], i) => {
        award(m.channel, id, m.login, reward);
        const pm = primaryOf(id);
        if (pm) grow(pm, { xp: 50 });
        // Top damage dealer always catches; everyone else gets a raid-ball throw.
        if (i === 0 || chance(raid.global ? 0.5 : 0.35)) {
          const shiny = rand(64) === 0;
          addMon(id, m.login, raid.boss.dex, raid.level, shiny, m.channel, 'raid');
          caughtBy.push((shiny ? '✨' : '') + m.login);
        }
      });
    })();
    const mvp = players[0] ? players[0][1].login + ' (' + players[0][1].damage + ' dmg)' : 'nobody';
    let msg =
      '🏆 ' +
      raid.boss.name +
      ' was defeated by ' +
      players.length +
      ' trainer' +
      (players.length === 1 ? '' : 's') +
      '! MVP: ' +
      mvp +
      '. Everyone gets +' +
      reward +
      ' points. Caught it: ' +
      (caughtBy.join(', ') || 'nobody');
    if (msg.length > 480) msg = msg.slice(0, 477) + '...';
    for (const ch of raid.channels) {
      event(ch, 'raid-won', raid.boss.name);
      await say(ch, msg).catch(() => {});
    }
  }
  async function startGlobalRaid(starter) {
    if (globalRaid) throw Error('A global raid is already running');
    const rows = db
      .prepare(
        'SELECT p.channel FROM poke_settings p JOIN channels c ON c.id=p.channel WHERE p.enabled=1 AND p.global_raids=1 AND c.enabled=1'
      )
      .all();
    const live = [];
    for (const r of rows) {
      try {
        if ((await api(r.channel, 'streams?user_id=' + encodeURIComponent(r.channel))).data?.length)
          live.push(r.channel);
      } catch {}
    }
    if (!live.length)
      throw Error('No live channels have the Pokémon game and global raids enabled');
    return startRaid({ channels: live, global: true, starter });
  }
  const autoHours = Number(process.env.POKEMON_GLOBAL_RAID_HOURS || 0);
  if (autoHours > 0) {
    setInterval(() => {
      if (!globalRaid) void startGlobalRaid('schedule').catch(() => {});
    }, autoHours * 3600000).unref?.();
  }
  const attackCooldown = new Map();

  // ---- chat commands ----
  const COMMANDS = new Set([
    '!pokecatch',
    '!pokeshop',
    '!pokebuy',
    '!pokebag',
    '!pokedex',
    '!poketop',
    '!pokeraid',
    '!pokecandy',
    '!pokelure',
    '!pokespawn',
    '!pokeraidstart',
    '!pokehelp',
    '!pokemon',
    '!pokeprimary',
    '!pokebox',
    '!pokeevolve',
    '!pokesell',
    '!pokemarket',
    '!poketrade'
  ]);
  async function onMessage(ch, e, parts, isMod) {
    const cmd = parts[0]?.toLowerCase();
    if (!COMMANDS.has(cmd)) return false;
    if (!settings(ch.id).enabled) return false;
    const uid = e.chatter_user_id,
      who = displayName(e),
      arg = (parts[1] || '').toLowerCase();
    const isNew = trainer(e);
    if (isNew)
      await say(
        ch.id,
        '🎒 Welcome, Trainer ' +
          who +
          '! Here are ' +
          STARTER_BALLS +
          ' free Poké Balls. Type !pokehelp for commands.'
      ).catch(() => {});
    switch (cmd) {
      case '!pokehelp':
      case '!pokemon':
        await say(
          ch.id,
          'Pokémon: !pokecatch [ball] · !pokeshop · !pokebuy <item> [qty] · !pokebag · !pokebox · !pokeprimary <pokemon> · !pokeevolve · !pokecandy · !pokedex · !poketop · !pokemarket · !pokesell <pokemon> <price> · !poketrade @user <mine> for <theirs> · !pokeraid · !pokelure'
        );
        return true;
      case '!pokecatch': {
        const s = spawns.get(ch.id);
        if (!s || s.expires < Date.now()) {
          await say(ch.id, '@' + who + " there's no wild Pokémon right now. Keep watching!");
          return true;
        }
        if (s.caught.has(uid)) {
          await say(ch.id, '@' + who + ' you already caught this ' + s.p.name + '!');
          return true;
        }
        const ball = ALIASES[arg] || (arg ? null : 'pokeball');
        if (!ball || !BALLS[ball]) {
          await say(
            ch.id,
            '@' + who + ' use: !pokecatch pokeball | greatball | ultraball | masterball'
          );
          return true;
        }
        if (!take(uid, ball)) {
          await say(
            ch.id,
            '@' + who + ' you have no ' + BALLS[ball].name + 's! Buy some with !pokebuy ' + ball
          );
          return true;
        }
        const p = Math.min(
          1,
          TIERS[s.p.tier].catch * BALLS[ball].mult * (s.tried.has(uid) ? 0.85 : 1)
        );
        s.tried.add(uid);
        if (chance(p)) {
          s.caught.add(uid);
          const caught = addMon(uid, e.chatter_user_login, s.p.dex, s.level, s.shiny, ch.id);
          if (!primaryOf(uid))
            db.prepare('UPDATE poke_trainers SET primary_id=? WHERE user_id=?').run(caught.id, uid);
          const total = dexCount(uid),
            first = caught.fresh;
          await say(
            ch.id,
            '🎉 ' +
              who +
              ' caught ' +
              label(s.p, s.shiny, s.level) +
              ' with a ' +
              BALLS[ball].name +
              '!' +
              (first ? ' New Pokédex entry (' + total + '/' + DEX_TOTAL + ')!' : '') +
              ' [#' +
              caught.id +
              ']'
          );
          await primaryXp(ch.id, e, 20);
        } else
          await say(
            ch.id,
            '💥 Oh no! ' +
              s.p.name +
              ' broke free from ' +
              who +
              "'s " +
              BALLS[ball].name +
              '! (' +
              qty(uid, ball) +
              ' left)'
          );
        return true;
      }
      case '!pokeshop':
        await say(
          ch.id,
          '🛒 PokéShop (loyalty points): ' +
            Object.entries(ITEMS)
              .map(([k, v]) => v.name + ' ' + v.price)
              .join(' · ') +
            ' — buy with !pokebuy <item> [qty]'
        );
        return true;
      case '!pokebuy': {
        if (/^#\d+$/.test(arg))
          return onMessage(ch, e, ['!pokemarket', 'buy', arg.slice(1)], isMod);
        const item = ALIASES[arg],
          n = Math.max(1, Math.min(100, Math.floor(Number(parts[2]) || 1)));
        if (!item) {
          await say(
            ch.id,
            '@' +
              who +
              ' usage: !pokebuy pokeball|greatball|ultraball|masterball|rarecandy|lure [qty]'
          );
          return true;
        }
        const cost = ITEMS[item].price * n;
        if (!spend(ch.id, uid, cost)) {
          await say(
            ch.id,
            '@' + who + ' that costs ' + cost + ' points, you have ' + points(ch.id, uid) + '.'
          );
          return true;
        }
        give(uid, item, n);
        event(ch.id, 'buy', who + ' ' + n + 'x ' + item);
        await say(
          ch.id,
          '🛍️ ' +
            who +
            ' bought ' +
            n +
            'x ' +
            ITEMS[item].name +
            ' for ' +
            cost +
            ' points. You now have ' +
            qty(uid, item) +
            '.'
        );
        return true;
      }
      case '!pokebag': {
        const rows = db.prepare('SELECT item,qty FROM poke_bag WHERE user_id=? AND qty>0').all(uid);
        await say(
          ch.id,
          '🎒 ' +
            who +
            "'s bag: " +
            (rows.map(r => (ITEMS[r.item]?.name || r.item) + ' x' + r.qty).join(' · ') || 'empty') +
            ' · ' +
            points(ch.id, uid) +
            ' points here'
        );
        return true;
      }
      case '!pokedex': {
        const target = (parts[1] || '').replace(/^@/, '').toLowerCase();
        const row = target
          ? db.prepare('SELECT user_id,login FROM poke_trainers WHERE LOWER(login)=?').get(target)
          : { user_id: uid, login: who };
        if (!row) {
          await say(ch.id, "That trainer hasn't played yet.");
          return true;
        }
        const st = db
          .prepare('SELECT COUNT(*) total,SUM(shiny) shinies FROM poke_caught WHERE user_id=?')
          .get(row.user_id);
        st.uniq = dexCount(row.user_id);
        const best = primaryOf(row.user_id) || strongest(row.user_id);
        await say(
          ch.id,
          '📕 ' +
            (target ? row.login : who) +
            ': ' +
            st.uniq +
            '/' +
            DEX_TOTAL +
            ' Pokédex · ' +
            st.total +
            ' caught · ' +
            (st.shinies || 0) +
            ' shiny' +
            (best
              ? ' · ' +
                (primaryOf(row.user_id) ? 'Primary' : 'Strongest') +
                ': ' +
                label(DEX[best.dex - 1], best.shiny, best.level)
              : '')
        );
        return true;
      }
      case '!poketop': {
        const rows = db
          .prepare(
            'SELECT t.login,COUNT(*) n FROM poke_dex d JOIN poke_trainers t ON t.user_id=d.user_id GROUP BY d.user_id ORDER BY n DESC LIMIT 5'
          )
          .all();
        await say(
          ch.id,
          rows.length
            ? '🏅 Top trainers: ' +
                rows
                  .map((r, i) => i + 1 + '. ' + r.login + ' (' + r.n + '/' + DEX_TOTAL + ')')
                  .join(' · ')
            : 'Nobody has caught anything yet!'
        );
        return true;
      }
      case '!pokecandy': {
        const text = parts.slice(1).join(' ').trim(),
          m = text ? findMine(uid, text) : primaryOf(uid);
        if (!m) {
          await say(
            ch.id,
            '@' + who + ' usage: !pokecandy [pokemon or #id] (defaults to your primary)'
          );
          return true;
        }
        if (m.level >= 100) {
          await say(ch.id, '@' + who + ' your ' + DEX[m.dex - 1].name + ' is already Lv 100!');
          return true;
        }
        if (!take(uid, 'rarecandy')) {
          await say(ch.id, '@' + who + ' you have no Rare Candy. !pokebuy rarecandy');
          return true;
        }
        const r = grow(m, { levels: 1 });
        if (!r.evolutions.length)
          await say(
            ch.id,
            '🍬 ' + who + "'s " + label(DEX[r.dex - 1], m.shiny) + ' grew to Lv ' + r.level + '!'
          );
        await announceGrowth(ch.id, who, m, { ...r, levels: 0 });
        return true;
      }
      case '!pokeprimary': {
        const text = parts.slice(1).join(' ').trim();
        if (!text) {
          const m = primaryOf(uid);
          await say(
            ch.id,
            m
              ? '⭐ ' +
                  who +
                  "'s primary: " +
                  monLabel(m) +
                  ' [#' +
                  m.id +
                  '] · XP ' +
                  m.xp +
                  '/' +
                  need(m.level) +
                  ' · ' +
                  evoText(m)
              : '@' +
                  who +
                  ' set a primary Pokémon with !pokeprimary <pokemon or #id>. It gains XP while you chat, catch and raid.'
          );
          return true;
        }
        const m = findMine(uid, text);
        if (!m) {
          await say(
            ch.id,
            '@' + who + " you don't have that Pokémon (or it's listed on the market). See !pokebox"
          );
          return true;
        }
        db.prepare('UPDATE poke_trainers SET primary_id=? WHERE user_id=?').run(m.id, uid);
        await say(
          ch.id,
          '⭐ ' + who + ' chose ' + monLabel(m) + ' as their primary! · ' + evoText(m)
        );
        return true;
      }
      case '!pokebox': {
        const page = Math.max(1, Math.floor(Number(parts[1]) || 1)),
          per = 8;
        const total = db.prepare('SELECT COUNT(*) n FROM poke_caught WHERE user_id=?').get(uid).n;
        const rows = db
          .prepare(
            'SELECT * FROM poke_caught WHERE user_id=? ORDER BY level DESC,id ASC LIMIT ? OFFSET ?'
          )
          .all(uid, per, (page - 1) * per);
        const pid = primaryOf(uid)?.id;
        await say(
          ch.id,
          rows.length
            ? '📦 ' +
                who +
                ' (page ' +
                page +
                '/' +
                Math.max(1, Math.ceil(total / per)) +
                '): ' +
                rows
                  .map(
                    m =>
                      '#' +
                      m.id +
                      ' ' +
                      monLabel(m) +
                      (m.id === pid ? ' ⭐' : '') +
                      (isListed(m.id) ? ' 🏷️' : '')
                  )
                  .join(' · ')
            : '@' + who + ' your box is empty. Catch something with !pokecatch!'
        );
        return true;
      }
      case '!pokeevolve': {
        const m = primaryOf(uid);
        if (!m) {
          await say(ch.id, '@' + who + ' set a primary first: !pokeprimary <pokemon>');
          return true;
        }
        const opts = EVOLUTIONS[m.dex] || [];
        if (!opts.length) {
          await say(ch.id, '@' + who + ' ' + DEX[m.dex - 1].name + " doesn't evolve any further.");
          return true;
        }
        const wanted = byName(parts.slice(1).join(' '));
        let pool = wanted ? opts.filter(o => o[0] === wanted.dex) : opts;
        if (!pool.length) {
          await say(
            ch.id,
            '@' +
              who +
              ' ' +
              DEX[m.dex - 1].name +
              ' can evolve into: ' +
              opts.map(o => DEX[o[0] - 1].name).join(', ')
          );
          return true;
        }
        const ready = pool.filter(o => o[2] === 'level' && o[1] <= m.level);
        let o;
        if (ready.length) o = pick(ready);
        else {
          const stoneable = pool.filter(o => o[2] !== 'level');
          if (!stoneable.length) {
            const lv = Math.min(...pool.map(o => o[1]));
            await say(
              ch.id,
              '@' +
                who +
                ' ' +
                DEX[m.dex - 1].name +
                ' evolves at Lv ' +
                lv +
                ' (now Lv ' +
                m.level +
                '). Keep training!'
            );
            return true;
          }
          if (!take(uid, 'evostone')) {
            await say(
              ch.id,
              '@' + who + ' ' + DEX[m.dex - 1].name + ' needs an Evo Stone. !pokebuy evostone'
            );
            return true;
          }
          o = pick(stoneable);
        }
        const from = DEX[m.dex - 1].name,
          to = evolve(m, o[0]);
        await say(
          ch.id,
          '✨ What? ' +
            who +
            "'s " +
            from +
            ' is evolving... Congratulations! It evolved into ' +
            to.name +
            '! 🎉'
        );
        return true;
      }
      case '!pokesell': {
        const price = Math.floor(Number(parts.at(-1)));
        const text = parts.slice(1, -1).join(' ');
        if (!text || !Number.isSafeInteger(price) || price < 1 || price > 1000000) {
          await say(ch.id, '@' + who + ' usage: !pokesell <pokemon or #id> <price>');
          return true;
        }
        const m = findMine(uid, text, { lowest: true });
        if (!m) {
          await say(ch.id, '@' + who + " you don't have that Pokémon available. See !pokebox");
          return true;
        }
        if (primaryOf(uid)?.id === m.id) {
          await say(
            ch.id,
            '@' + who + " you can't sell your primary Pokémon. Pick another primary first."
          );
          return true;
        }
        if (
          db
            .prepare(
              "SELECT COUNT(*) n FROM poke_market WHERE seller_id=? AND channel=? AND status='open'"
            )
            .get(uid, ch.id).n >= MARKET_MAX
        ) {
          await say(ch.id, '@' + who + ' you already have ' + MARKET_MAX + ' listings here.');
          return true;
        }
        const id = db
          .prepare(
            'INSERT INTO poke_market(channel,seller_id,seller_login,mon_id,price) VALUES(?,?,?,?,?)'
          )
          .run(ch.id, uid, who, m.id, price).lastInsertRowid;
        event(ch.id, 'market-list', who + ' ' + monLabel(m) + ' ' + price);
        await say(
          ch.id,
          '🏷️ ' +
            who +
            ' listed ' +
            monLabel(m) +
            ' on the PokéMarket for ' +
            price +
            ' points! Buy it with !pokemarket buy ' +
            id
        );
        return true;
      }
      case '!pokemarket': {
        const sub = arg,
          idArg = Number(String(parts[2] || '').replace('#', ''));
        if (sub === 'buy' || sub === 'cancel') {
          const l = db
            .prepare("SELECT * FROM poke_market WHERE id=? AND channel=? AND status='open'")
            .get(idArg, ch.id);
          if (!l) {
            await say(ch.id, '@' + who + ' listing #' + (idArg || '?') + " isn't available here.");
            return true;
          }
          const m = getMon(l.mon_id);
          if (sub === 'cancel') {
            if (l.seller_id !== uid && !isMod) return true;
            db.prepare(
              "UPDATE poke_market SET status='cancelled',closed=CURRENT_TIMESTAMP WHERE id=?"
            ).run(l.id);
            await say(
              ch.id,
              '❌ Listing #' + l.id + ' (' + monLabel(m) + ') was removed from the market.'
            );
            return true;
          }
          if (l.seller_id === uid) {
            await say(
              ch.id,
              '@' + who + " that's your own listing. Use !pokemarket cancel " + l.id
            );
            return true;
          }
          const ok = db.transaction(() => {
            if (!m || m.user_id !== l.seller_id) {
              db.prepare(
                "UPDATE poke_market SET status='cancelled',closed=CURRENT_TIMESTAMP WHERE id=?"
              ).run(l.id);
              return 'gone';
            }
            if (!spend(ch.id, uid, l.price)) return 'poor';
            award(ch.id, l.seller_id, l.seller_login, l.price);
            db.prepare('UPDATE poke_caught SET user_id=?,login=? WHERE id=?').run(
              uid,
              e.chatter_user_login,
              m.id
            );
            recordDex(uid, m.dex);
            db.prepare(
              "UPDATE poke_market SET status='sold',buyer_id=?,buyer_login=?,closed=CURRENT_TIMESTAMP WHERE id=?"
            ).run(uid, who, l.id);
            return 'ok';
          })();
          if (ok === 'poor') {
            await say(
              ch.id,
              '@' + who + ' that costs ' + l.price + ' points, you have ' + points(ch.id, uid) + '.'
            );
            return true;
          }
          if (ok === 'gone') {
            await say(ch.id, '@' + who + ' that Pokémon is no longer available.');
            return true;
          }
          event(
            ch.id,
            'market-sold',
            who + ' bought ' + monLabel(m) + ' from ' + l.seller_login + ' for ' + l.price
          );
          await say(
            ch.id,
            '🤝 ' +
              who +
              ' bought ' +
              monLabel(m) +
              ' from ' +
              l.seller_login +
              ' for ' +
              l.price +
              ' points! [#' +
              m.id +
              ']'
          );
          return true;
        }
        const search = sub && !/^\d+$/.test(sub) ? byName(parts.slice(1).join(' ')) : null;
        if (sub && !/^\d+$/.test(sub) && !search) {
          await say(
            ch.id,
            '@' +
              who +
              ' usage: !pokemarket [page | pokemon] · !pokemarket buy <id> · !pokemarket cancel <id>'
          );
          return true;
        }
        const page = /^\d+$/.test(sub) ? Math.max(1, Number(sub)) : 1,
          per = 6;
        const rows = db
          .prepare(
            "SELECT m.id,m.price,m.seller_login,c.dex,c.level,c.shiny FROM poke_market m JOIN poke_caught c ON c.id=m.mon_id WHERE m.channel=? AND m.status='open'" +
              (search ? ' AND c.dex=?' : '') +
              ' ORDER BY m.price ASC,m.id ASC LIMIT ? OFFSET ?'
          )
          .all(...(search ? [ch.id, search.dex] : [ch.id]), per, (page - 1) * per);
        await say(
          ch.id,
          rows.length
            ? '🏪 PokéMarket' +
                (search ? ' (' + search.name + ')' : ' p' + page) +
                ': ' +
                rows
                  .map(
                    r =>
                      '#' +
                      r.id +
                      ' ' +
                      label(DEX[r.dex - 1], r.shiny, r.level) +
                      ' ' +
                      r.price +
                      'pts (' +
                      r.seller_login +
                      ')'
                  )
                  .join(' · ') +
                ' — !pokemarket buy <id>'
            : '🏪 The PokéMarket' +
                (search ? ' has no ' + search.name : ' is empty') +
                '. List one with !pokesell <pokemon> <price>'
        );
        return true;
      }
      case '!poketrade': {
        if (arg === 'accept' || arg === 'deny') {
          const key = ch.id + ':' + uid,
            t = trades.get(key);
          trades.delete(key);
          if (!t || t.expires < Date.now()) {
            await say(ch.id, '@' + who + ' you have no pending trade.');
            return true;
          }
          if (arg === 'deny') {
            await say(ch.id, who + ' declined the trade from ' + t.fromLogin + '.');
            return true;
          }
          const a = getMon(t.give),
            b = getMon(t.want);
          const ok = db.transaction(() => {
            if (
              !a ||
              !b ||
              a.user_id !== t.from ||
              b.user_id !== uid ||
              isListed(a.id) ||
              isListed(b.id)
            )
              return false;
            db.prepare('UPDATE poke_caught SET user_id=?,login=? WHERE id=?').run(
              uid,
              e.chatter_user_login,
              a.id
            );
            db.prepare('UPDATE poke_caught SET user_id=?,login=? WHERE id=?').run(
              t.from,
              t.fromRaw,
              b.id
            );
            for (const [u, mon] of [
              [t.from, b],
              [uid, a]
            ]) {
              if (
                db.prepare('SELECT primary_id FROM poke_trainers WHERE user_id=?').get(u)
                  ?.primary_id === (u === t.from ? a.id : b.id)
              )
                db.prepare('UPDATE poke_trainers SET primary_id=? WHERE user_id=?').run(mon.id, u);
              recordDex(u, mon.dex);
            }
            return true;
          })();
          if (!ok) {
            await say(ch.id, 'Trade cancelled: one of the Pokémon is no longer available.');
            return true;
          }
          event(
            ch.id,
            'trade',
            t.fromLogin + ' ' + monLabel(a) + ' <-> ' + who + ' ' + monLabel(b)
          );
          await say(
            ch.id,
            '🔄 Trade complete! ' +
              t.fromLogin +
              ' sent ' +
              monLabel(a) +
              ' to ' +
              who +
              ', and got ' +
              monLabel(b) +
              ' in return!'
          );
          // Trade evolutions, like the games (Kadabra, Machoke, Haunter, ...).
          for (const [mon, owner] of [
            [getMon(a.id), who],
            [getMon(b.id), t.fromLogin]
          ]) {
            const o = pick((EVOLUTIONS[mon.dex] || []).filter(o => o[2] === 'trade') || []);
            if (o) {
              const from = DEX[mon.dex - 1].name,
                to = evolve(mon, o[0]);
              await say(
                ch.id,
                '✨ ' + owner + "'s " + from + ' evolved into ' + to.name + ' after the trade! 🎉'
              );
            }
          }
          return true;
        }
        const target = (parts[1] || '').replace(/^@/, '').toLowerCase(),
          rest = parts.slice(2).join(' '),
          split = rest.split(/\s+for\s+/i);
        if (!target || split.length !== 2) {
          await say(
            ch.id,
            '@' + who + ' usage: !poketrade @user <your pokemon or #id> for <their pokemon or #id>'
          );
          return true;
        }
        const other = db
          .prepare('SELECT user_id,login FROM poke_trainers WHERE LOWER(login)=?')
          .get(target);
        if (!other || other.user_id === uid) {
          await say(ch.id, '@' + who + " that trainer hasn't played yet.");
          return true;
        }
        const give = findMine(uid, split[0]),
          want = findMine(other.user_id, split[1]);
        if (!give) {
          await say(
            ch.id,
            '@' + who + ' you don\'t have "' + split[0].slice(0, 30) + '" available to trade.'
          );
          return true;
        }
        if (!want) {
          await say(
            ch.id,
            other.login + ' doesn\'t have "' + split[1].slice(0, 30) + '" available to trade.'
          );
          return true;
        }
        trades.set(ch.id + ':' + other.user_id, {
          from: uid,
          fromLogin: who,
          fromRaw: e.chatter_user_login,
          give: give.id,
          want: want.id,
          expires: Date.now() + TRADE_MS
        });
        await say(
          ch.id,
          '🔄 @' +
            other.login +
            ', ' +
            who +
            ' offers ' +
            monLabel(give) +
            ' for your ' +
            monLabel(want) +
            '. Type !poketrade accept or !poketrade deny within 2 minutes.'
        );
        return true;
      }
      case '!pokelure':
      case '!pokespawn': {
        if (cmd === '!pokespawn' && !isMod) return true;
        if (spawns.has(ch.id)) {
          await say(ch.id, '@' + who + ' a wild Pokémon is already here! !pokecatch it');
          return true;
        }
        if (cmd === '!pokelure' && !take(uid, 'lure')) {
          await say(ch.id, '@' + who + ' you have no Lures. !pokebuy lure');
          return true;
        }
        await spawn(ch.id, ch.login, cmd === '!pokelure' ? 'lure' : 'mod');
        return true;
      }
      case '!pokeraidstart': {
        if (arg === 'global' && isOperator(uid)) {
          try {
            await startGlobalRaid(who);
          } catch (err) {
            await say(ch.id, 'Global raid: ' + err.message);
          }
          return true;
        }
        if (!isMod) return true;
        if (raidFor(ch.id)) {
          await say(ch.id, 'A raid is already running here! !pokeraid to attack');
          return true;
        }
        await startRaid({ channels: [ch.id], global: false, starter: who });
        return true;
      }
      case '!pokeraid': {
        const raid = raidFor(ch.id);
        if (!raid) {
          await say(ch.id, '@' + who + ' no raid right now. Watch for 🌍 Global Raids!');
          return true;
        }
        const key = uid + ':' + raid.boss.dex + ':' + raid.ends,
          now = Date.now();
        if ((attackCooldown.get(key) || 0) > now) return true;
        attackCooldown.set(key, now + 15000);
        if (attackCooldown.size > 5000)
          for (const [k, t] of attackCooldown) if (t < now) attackCooldown.delete(k);
        const best = primaryOf(uid) || strongest(uid);
        const base = best
          ? Math.round((20 + best.level * 2) * TIERS[DEX[best.dex - 1].tier].power)
          : 15;
        const crit = chance(0.1),
          dmg = Math.min(raid.hp, Math.round((base + rand(21)) * (crit ? 2 : 1)));
        raid.hp -= dmg;
        const p = raid.players.get(uid) || { login: who, channel: ch.id, damage: 0 };
        p.damage += dmg;
        raid.players.set(uid, p);
        const pct = Math.round((raid.hp / raid.maxHp) * 100);
        {
          const pm = primaryOf(uid);
          if (pm) grow(pm, { xp: 5 });
        }
        if (raid.hp <= 0) {
          await endRaid(raid, true);
          return true;
        }
        const mark = [75, 50, 25].find(m => pct <= m && !raid.marks.has(m));
        if (mark) {
          raid.marks.add(mark);
          for (const c of raid.channels)
            await say(
              c,
              '⚔️ ' +
                raid.boss.name +
                ' is down to ' +
                pct +
                '% HP! (' +
                raid.players.size +
                ' trainer' +
                (raid.players.size === 1 ? '' : 's') +
                ' attacking)'
            ).catch(() => {});
        } else
          await say(
            ch.id,
            (crit ? '💥 CRITICAL! ' : '⚔️ ') +
              who +
              (best ? "'s " + DEX[best.dex - 1].name : '') +
              ' hit ' +
              raid.boss.name +
              ' for ' +
              dmg +
              ' damage! (' +
              raid.hp +
              '/' +
              raid.maxHp +
              ' HP)'
          );
        return true;
      }
    }
    return false;
  }

  // ---- dashboard API ----
  app.get('/api/pokemon', withUser, access.channelOnly('editor'), (req, res) => {
    const s = settings(req.channelId),
      raid = raidFor(req.channelId);
    res.set('Cache-Control', 'no-store').json({
      settings: {
        enabled: Boolean(s.enabled),
        spawn_minutes: s.spawn_minutes,
        global_raids: Boolean(s.global_raids),
        gens: [...parseGens(s.gens)]
      },
      allGens: GENS,
      dexTotal: DEX_TOTAL,
      spawn: spawns.get(req.channelId) ? { name: spawns.get(req.channelId).p.name } : null,
      raid: raid
        ? {
            boss: raid.boss.name,
            hp: raid.hp,
            max: raid.maxHp,
            global: raid.global,
            players: raid.players.size
          }
        : null,
      events: db
        .prepare(
          'SELECT kind,detail,created FROM poke_events WHERE channel=? ORDER BY id DESC LIMIT 30'
        )
        .all(req.channelId),
      top: db
        .prepare(
          'SELECT t.login,(SELECT COUNT(*) FROM poke_dex d WHERE d.user_id=c.user_id) uniq,COUNT(*) total FROM poke_caught c JOIN poke_trainers t ON t.user_id=c.user_id WHERE c.channel=? GROUP BY c.user_id ORDER BY uniq DESC LIMIT 10'
        )
        .all(req.channelId),
      market: db
        .prepare(
          "SELECT m.id,m.seller_login,m.price,c.dex,c.level,c.shiny FROM poke_market m JOIN poke_caught c ON c.id=m.mon_id WHERE m.channel=? AND m.status='open' ORDER BY m.id DESC LIMIT 50"
        )
        .all(req.channelId)
        .map(x => ({
          id: x.id,
          seller: x.seller_login,
          price: x.price,
          pokemon: label(DEX[x.dex - 1], x.shiny, x.level)
        })),
      operator: isOperator(req.session.uid),
      autoGlobalRaidHours: autoHours
    });
  });
  app.post('/api/pokemon', withUser, access.channelOnly('bot_supervisor'), csrf, (req, res) => {
    const { enabled, global_raids } = req.body || {},
      m = Number(req.body?.spawn_minutes),
      gens = Array.isArray(req.body?.gens)
        ? [...new Set(req.body.gens.map(Number))]
            .filter(g => GENS.includes(g))
            .sort((a, b) => a - b)
        : [...GENS];
    if (!gens.length) return res.status(400).json({ error: 'Pick at least one generation' });
    if (
      typeof enabled !== 'boolean' ||
      typeof global_raids !== 'boolean' ||
      !Number.isInteger(m) ||
      m < 3 ||
      m > 180
    )
      return res
        .status(400)
        .json({ error: 'Invalid Pokémon settings (spawn every 3–180 minutes)' });
    db.prepare(
      'INSERT INTO poke_settings(channel,enabled,spawn_minutes,global_raids,gens) VALUES(?,?,?,?,?) ON CONFLICT(channel) DO UPDATE SET enabled=excluded.enabled,spawn_minutes=excluded.spawn_minutes,global_raids=excluded.global_raids,gens=excluded.gens'
    ).run(
      req.channelId,
      enabled ? 1 : 0,
      m,
      global_raids ? 1 : 0,
      gens.length === GENS.length ? '' : gens.join(',')
    );
    log(req.channelId, 'pokemon-config', (enabled ? 'enabled' : 'disabled') + ' every ' + m + 'm');
    res.json({ ok: true });
  });
  app.post(
    '/api/pokemon/spawn',
    withUser,
    access.channelOnly('bot_supervisor'),
    csrf,
    async (req, res) => {
      if (!settings(req.channelId).enabled)
        return res.status(409).json({ error: 'Enable the Pokémon game first' });
      if (spawns.has(req.channelId))
        return res.status(409).json({ error: 'A Pokémon is already spawned' });
      const ch = db.prepare('SELECT login FROM channels WHERE id=?').get(req.channelId);
      try {
        await spawn(req.channelId, ch?.login || '', 'mod');
        res.json({ ok: true });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    }
  );
  app.post(
    '/api/pokemon/raid',
    withUser,
    access.channelOnly('bot_supervisor'),
    csrf,
    async (req, res) => {
      if (!settings(req.channelId).enabled)
        return res.status(409).json({ error: 'Enable the Pokémon game first' });
      if (raidFor(req.channelId))
        return res.status(409).json({ error: 'A raid is already running' });
      try {
        await startRaid({ channels: [req.channelId], global: false, starter: 'dashboard' });
        res.json({ ok: true });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    }
  );
  app.post('/api/admin/pokemon/global-raid', withUser, csrf, async (req, res) => {
    if (!isOperator(req.session.uid))
      return res.status(403).json({ error: 'Operator access required' });
    try {
      const r = await startGlobalRaid('operator');
      res.json({ ok: true, boss: r.boss.name, channels: r.channels.size });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });
  // Any chat message from a trainer gives their primary a little XP (once a minute).
  async function onChat(ch, e) {
    if (!settings(ch.id).enabled) return;
    const k = ch.id + ':' + e.chatter_user_id,
      now = Date.now();
    if ((chatXpSeen.get(k) || 0) > now - CHAT_XP_MS) return;
    chatXpSeen.set(k, now);
    if (chatXpSeen.size > 20000)
      for (const [x, t] of chatXpSeen) if (t < now - CHAT_XP_MS) chatXpSeen.delete(x);
    await primaryXp(ch.id, e, CHAT_XP);
  }
  return { onMessage, onChat, reserved: [...COMMANDS].map(c => c.slice(1)) };
}
