// Game definitions for KitsuFlowBOT Assistant "interactive" actions: which games exist, how their
// action templates are validated, and ready-made presets for Studio's "Add from preset" list.
// The desktop app re-checks everything it is sent, so these checks are the first of two layers.

// Server-admin commands viewers must never trigger, per game (compared lower-case, first word).
const BLOCKED = {
  minecraft: [
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
  ],
  ark: [
    'doexit',
    'quit',
    'exit',
    'saveworld',
    'banplayer',
    'unbanplayer',
    'kickplayer',
    'allowplayertojoinnocheck',
    'disallowplayertojoinnocheck',
    'destroyall',
    'destroywilddinos',
    'destroystructures',
    'destroytribestructures',
    'destroytribedinos',
    'destroytribeplayers',
    'destroytribeid',
    'destroyallenemies',
    'setmessageoftheday',
    'enablecheats',
    'setcheatplayer',
    'slomo',
    'setglobalpause',
    'renameplayer',
    'renametribe',
    'settargetdinocolor'
  ],
  palworld: ['shutdown', 'doexit', 'kickplayer', 'banplayer', 'unbanplayer', 'save'],
  factorio: [
    '/quit',
    '/ban',
    '/unban',
    '/kick',
    '/promote',
    '/demote',
    '/admins',
    '/purge',
    '/server-save',
    '/config',
    '/whitelist',
    '/mute',
    '/unmute',
    '/delete-blueprint-library'
  ],
  zomboid: [
    'quit',
    'save',
    'banuser',
    'unbanuser',
    'banid',
    'unbanid',
    'kickuser',
    'setaccesslevel',
    'grantadmin',
    'removeadmin',
    'adduser',
    'addusertowhitelist',
    'removeuserfromwhitelist',
    'changeoption',
    'reloadoptions',
    'reloadlua',
    'setpassword',
    'releasesafehouse'
  ],
  rcon: ['stop', 'quit', 'exit', 'shutdown', 'doexit', 'restart', 'ban', 'kick', 'op', 'admin']
};

export const GAMES = {
  minecraft: {
    label: 'Minecraft (Java)',
    kind: 'minecraft',
    help: 'One Minecraft command per line, without the leading slash. {player} is your Minecraft name (set in the app).'
  },
  ark: {
    label: 'ARK: Survival Evolved / Ascended',
    kind: 'ark',
    help: 'One RCON admin command per line (no "cheat" prefix needed over RCON). {player} is your in-game player ID (set in the app). Commands that need a crosshair or "self" do not work over RCON.'
  },
  palworld: {
    label: 'Palworld',
    kind: 'rcon',
    help: 'Palworld RCON commands. Broadcast does not allow spaces, so the presets use underscores.'
  },
  factorio: {
    label: 'Factorio',
    kind: 'rcon',
    help: 'Factorio console commands, e.g. /silent-command <Lua>. {player} is your Factorio name. Lua commands disable achievements for that save.'
  },
  zomboid: {
    label: 'Project Zomboid',
    kind: 'rcon',
    help: 'Project Zomboid server commands. {player} is your Zomboid username.'
  },
  rcon: {
    label: 'Other RCON game',
    kind: 'rcon',
    help: 'Any game with Source-style RCON. {player} is the name set in the app.'
  },
  keys: {
    label: 'PC key presses (Windows)',
    kind: 'keys',
    help: 'One step per line: a key or combo, optionally with how long to hold it in ms (e.g. "space", "ctrl+s", "w 1500"), "click" / "rclick", or "wait 500". The app only types into the window whose title you set in the app.'
  }
};
export const GAME_IDS = Object.keys(GAMES);

// Keys the desktop app can press. Windows/meta keys are never allowed.
const KEY_NAMES = new Set([
  ...'abcdefghijklmnopqrstuvwxyz0123456789',
  ...Array.from({ length: 12 }, (_, i) => 'f' + (i + 1)),
  'space',
  'enter',
  'tab',
  'esc',
  'backspace',
  'up',
  'down',
  'left',
  'right',
  'shift',
  'ctrl',
  'alt',
  'capslock',
  'insert',
  'delete',
  'home',
  'end',
  'pageup',
  'pagedown',
  'minus',
  'equals',
  'comma',
  'period',
  'slash',
  'semicolon',
  'quote',
  'lbracket',
  'rbracket',
  'backslash',
  'backtick',
  ...Array.from({ length: 10 }, (_, i) => 'num' + i)
]);
const MOUSE = new Set(['click', 'rclick', 'mclick']);
const BLOCKED_COMBOS = ['alt+f4', 'alt+tab', 'ctrl+esc', 'ctrl+shift+esc', 'ctrl+alt+delete'];
const MAX_HOLD_MS = 5000;

// Parses a key-press template into steps: { keys: [...], hold } | { wait }.
export function parseKeySteps(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim().toLowerCase())
    .filter(Boolean);
  if (!lines.length) throw Error('Add at least one key step');
  if (lines.length > 10) throw Error('At most 10 key steps per action');
  let total = 0;
  const steps = lines.map(line => {
    const [combo, msText, extra] = line.split(/\s+/);
    if (extra !== undefined) throw Error('Bad key step "' + line + '"');
    const ms = msText === undefined ? null : Number(msText);
    if (ms !== null && (!Number.isInteger(ms) || ms < 10 || ms > MAX_HOLD_MS))
      throw Error('Hold/wait time must be 10–' + MAX_HOLD_MS + ' ms ("' + line + '")');
    if (combo === 'wait') {
      if (ms === null) throw Error('"wait" needs a time in ms, e.g. wait 500');
      total += ms;
      return { wait: ms };
    }
    const keys = combo.split('+');
    if (keys.length > 4) throw Error('At most 4 keys in one combo');
    for (const key of keys)
      if (!KEY_NAMES.has(key) && !(MOUSE.has(key) && keys.length === 1))
        throw Error('"' + key + '" is not a supported key');
    const sorted = [...keys].sort().join('+');
    if (BLOCKED_COMBOS.some(c => c.split('+').sort().join('+') === sorted))
      throw Error('"' + combo + '" is blocked for safety');
    const hold = ms ?? 80;
    total += hold;
    return { keys, hold };
  });
  if (total > 15000) throw Error('A key action can last at most 15 seconds in total');
  return steps;
}

// Validates an RCON template for a game: one command per line, no admin commands.
export function parseRconLines(game, text) {
  const isFactorio = game === 'factorio';
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .map(l => (isFactorio ? l : l.replace(/^\/+/, '')))
    .filter(Boolean);
  if (!lines.length) throw Error('Add at least one command');
  if (lines.length > 10) throw Error('At most 10 commands per action');
  const blocked = new Set(BLOCKED[game] || BLOCKED.rcon);
  for (const line of lines) {
    if (line.length > 400) throw Error('Each command must be 400 characters or fewer');
    let word = line.split(/\s+/)[0].toLowerCase();
    if (game === 'minecraft') word = word.replace(/^minecraft:/, '');
    if (game === 'ark') word = word.replace(/^(admin)?cheat$/, '') || line.split(/\s+/)[1] || '';
    word = word.toLowerCase();
    if (blocked.has(word))
      throw Error('"' + word + '" is a server-admin command and is not allowed');
  }
  return lines;
}

// Returns the validated template lines (RCON) or steps (keys) for a game.
export function parseTemplate(game, text) {
  if (!GAMES[game]) throw Error('Choose a game');
  return game === 'keys' ? parseKeySteps(text) : parseRconLines(game, text);
}

const cmd = (name, command, commands, extra = {}) => ({
  name,
  trigger_type: 'command',
  command,
  cost: 100,
  cooldown: 30,
  commands: commands.join('\n'),
  ...extra
});

// Ready-made actions shown in Studio. {player} is filled in by the app, {user} by the bot.
export const PRESETS = {
  minecraft: [
    cmd('Spawn a creeper', 'creeper', [
      'execute at {player} run summon creeper ~ ~ ~3',
      'tellraw @a {"text":"{user} sent a creeper!","color":"green"}'
    ]),
    cmd('Zombie horde', 'zombies', [
      'execute at {player} run summon zombie ~3 ~ ~',
      'execute at {player} run summon zombie ~-3 ~ ~',
      'execute at {player} run summon zombie ~ ~ ~3',
      'tellraw @a {"text":"{user} sent a zombie horde!","color":"dark_green"}'
    ]),
    cmd('Anvil drop', 'anvil', [
      'execute at {player} run summon falling_block ~ ~12 ~ {BlockState:{Name:"minecraft:anvil"},Time:1}',
      'tellraw @a {"text":"{user} dropped an anvil! Look up!","color":"gray"}'
    ]),
    cmd('Smite (lightning)', 'smite', [
      'execute at {player} run summon lightning_bolt ~ ~ ~',
      'tellraw @a {"text":"{user} smited the streamer!","color":"yellow"}'
    ]),
    cmd('Random teleport', 'randomtp', [
      'execute at {player} run spreadplayers ~ ~ 0 300 false {player}',
      'tellraw @a {"text":"{user} teleported the streamer somewhere random!","color":"light_purple"}'
    ]),
    cmd('Spawn a pig', 'pig', ['execute at {player} run summon pig ~ ~ ~2'], { cost: 25 }),
    cmd('Primed TNT', 'tnt', [
      'execute at {player} run summon tnt ~ ~ ~',
      'tellraw @a {"text":"{user} lit some TNT! RUN!","color":"red"}'
    ]),
    cmd('Levitate', 'levitate', ['effect give {player} levitation 3 1']),
    cmd('Blindness', 'blind', ['effect give {player} blindness 8 0']),
    cmd('Heal + feed', 'heal', [
      'effect give {player} instant_health 1 1',
      'effect give {player} saturation 5 5'
    ]),
    cmd('Give a diamond', 'diamond', ['give {player} diamond 1'], { cost: 250 }),
    cmd('Make it night', 'night', ['time set night'], { cost: 50 }),
    cmd('Thunderstorm', 'storm', ['weather thunder 300'], { cost: 50 }),
    cmd('Fireworks', 'fireworks', [
      'execute at {player} run summon firework_rocket ~ ~1 ~ {LifeTime:20}'
    ]),
    {
      name: 'Raid: zombie + shout-out',
      trigger_type: 'event',
      event_platform: 'any',
      event_type: 'raid',
      cooldown: 0,
      commands:
        'execute at {player} run summon zombie ~3 ~ ~\ntellraw @a {"text":"{user} raided with {amount} viewers!","color":"gold"}'
    },
    {
      name: 'Follow: firework',
      trigger_type: 'event',
      event_platform: 'any',
      event_type: 'follow',
      cooldown: 5,
      commands: 'execute at {player} run summon firework_rocket ~ ~1 ~ {LifeTime:20}'
    }
  ],
  ark: [
    cmd('Server message', 'arkhello', ['ServerChat {user} says hi from Twitch!'], { cost: 10 }),
    cmd('Broadcast', 'arkshout', ['Broadcast {user} is watching you...'], { cost: 50 }),
    cmd('Give XP', 'arkxp', ['GiveExpToPlayer {player} 1000 0 1'], { cost: 200 }),
    cmd(
      'Give raw meat',
      'arkmeat',
      [
        'GiveItemToPlayer {player} "Blueprint\'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_RawMeat.PrimalItemConsumable_RawMeat\'" 10 0 0'
      ],
      { cost: 50 }
    ),
    cmd(
      'Smite (kill the streamer)',
      'arksmite',
      ['ServerChat {user} smites the streamer!', 'KillPlayer {player}'],
      { cost: 1000, cooldown: 600 }
    ),
    cmd('Make it night', 'arknight', ['SetTimeOfDay 22:00'], { cost: 100 }),
    cmd('Make it day', 'arkday', ['SetTimeOfDay 08:00'], { cost: 100 })
  ],
  palworld: [cmd('Broadcast', 'palhello', ['Broadcast {user}_says_hi_from_Twitch!'], { cost: 10 })],
  factorio: [
    cmd('Chat message', 'fhello', ['/silent-command game.print("{user} says hi from Twitch!")'], {
      cost: 10
    }),
    cmd('Biter attack', 'biters', [
      '/silent-command local p=game.get_player("{player}") if p and p.character then for i=1,5 do p.surface.create_entity{name="small-biter",position={p.position.x+math.random(-12,12),p.position.y+math.random(-12,12)},force="enemy"} end end',
      '/silent-command game.print("{user} sent biters!")'
    ]),
    cmd('Give iron plates', 'iron', [
      '/silent-command local p=game.get_player("{player}") if p then p.insert{name="iron-plate",count=100} end'
    ])
  ],
  zomboid: [
    cmd('Server message', 'pzhello', ['servermsg "{user} says hi from Twitch!"'], { cost: 10 }),
    cmd('Zombie horde', 'horde', ['createhorde 10 "{player}"']),
    cmd('Helicopter event', 'chopper', ['chopper'], { cost: 500, cooldown: 900 }),
    cmd('Lightning', 'pzsmite', ['lightning "{player}"']),
    cmd('Give an axe', 'axe', ['additem "{player}" Base.Axe 1'], { cost: 300 })
  ],
  rcon: [cmd('Say hello', 'rconhello', ['say {user} says hi from Twitch!'], { cost: 10 })],
  keys: [
    cmd('Jump', 'jump', ['space'], { cost: 10, cooldown: 5 }),
    cmd('Crouch for 2 seconds', 'crouch', ['ctrl 2000'], { cost: 25, cooldown: 15 }),
    cmd('Walk forward', 'forward', ['w 1500'], { cost: 25, cooldown: 15 }),
    cmd('Spin around', 'spin', ['left 1200'], { cost: 50, cooldown: 30 }),
    cmd('Attack', 'attack', ['click'], { cost: 10, cooldown: 5 }),
    cmd('Drop item', 'drop', ['q'], { cost: 100, cooldown: 60 })
  ]
};
