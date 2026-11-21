// Watch time for !watchtime / !topwatch: every minute while a channel is live, each viewer present
// in chat earns one minute. Presence comes from Twitch "Get Chatters" (GET /helix/chat/chatters),
// which lists everyone connected to chat, including logged-in lurkers, and needs the broadcaster's
// moderator:read:chatters scope. Independent of loyalty points.
//
// If the broadcaster's grant lacks that scope (or the call fails), viewers who chatted in the last
// 10 minutes are credited instead, and the channel is told once in the logs to reconnect Twitch.
const TICK_MS = 60000;
const MAX_PAGES = 20; // 20 x 1000 viewers per channel per minute
const ACTIVE_MS = 600000;

export function installWatchTime({ db, twitch, log, recentChatters }) {
  const { api, botId } = twitch;
  const credit = db.prepare(
    `INSERT INTO loyalty(channel,user_id,username,points,watch_minutes) VALUES(?,?,?,0,1)
     ON CONFLICT(channel,user_id) DO UPDATE SET username=excluded.username,watch_minutes=MIN(100000000,loyalty.watch_minutes+1)`
  );
  const creditAll = db.transaction((channel, viewers) => {
    for (const v of viewers) credit.run(channel, v.id, v.login);
  });
  const warned = new Set();

  async function chatters(channel) {
    const viewers = [];
    let cursor = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await api(
        channel,
        'chat/chatters?broadcaster_id=' +
          encodeURIComponent(channel) +
          '&moderator_id=' +
          encodeURIComponent(channel) +
          '&first=1000' +
          (cursor ? '&after=' + encodeURIComponent(cursor) : '')
      );
      for (const c of data.data || [])
        viewers.push({ id: String(c.user_id), login: String(c.user_login || c.user_name || '') });
      cursor = data.pagination?.cursor || '';
      if (!cursor) break;
    }
    return viewers;
  }

  function activeChatters(channel) {
    const now = Date.now();
    return [...(recentChatters.get(channel) || new Map())]
      .filter(([, m]) => now - m.last <= ACTIVE_MS)
      .map(([id, m]) => ({ id: String(id), login: String(m.login || '') }));
  }

  async function tickChannel(channel) {
    const stream = await api(channel, 'streams?user_id=' + encodeURIComponent(channel));
    if (!stream.data?.length) return 0;
    let viewers;
    try {
      viewers = await chatters(channel);
    } catch (err) {
      if (!warned.has(channel)) {
        warned.add(channel);
        log(
          channel,
          'watchtime-fallback',
          'Get Chatters failed (' +
            String(err.message).slice(0, 120) +
            '). Counting recent chatters only; reconnect Twitch in Studio to grant moderator:read:chatters.'
        );
      }
      viewers = activeChatters(channel);
    }
    const skip = new Set([String(channel), String(botId() || '')]);
    const seen = new Set();
    const counted = viewers.filter(
      v => v.id && v.login && !skip.has(v.id) && !seen.has(v.id) && seen.add(v.id)
    );
    if (counted.length) creditAll(channel, counted);
    return counted.length;
  }

  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      for (const { id } of db.prepare('SELECT id FROM channels WHERE enabled=1').all()) {
        try {
          await tickChannel(id);
        } catch (err) {
          log(id, 'watchtime-error', err.message);
        }
      }
    } finally {
      running = false;
    }
  }
  setInterval(() => void tick(), TICK_MS).unref?.();
  return { tick, tickChannel };
}
