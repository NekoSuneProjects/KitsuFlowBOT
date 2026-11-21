// Twitch Helix client for the shared bot and broadcaster accounts:
// token refresh, chat messages, moderation, clips and user lookups.
export function createTwitchClient({ db, config, enc, dec, log }) {
  const { clientId: CID, clientSecret: SECRET } = config.twitch;
  const getAccount = id => db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
  // Share one in-flight refresh per account: parallel refreshes of the same refresh token can
  // invalidate it, which used to leave the bot unable to reconnect until re-authorised.
  const refreshing = new Map();
  async function token(id) {
    let a = getAccount(id);
    if (!a) throw Error('Account not connected');
    if (a.expires > Date.now() + 120000) return dec(a.access);
    if (refreshing.has(id)) return refreshing.get(id);
    const job = refreshToken(id, a).finally(() => refreshing.delete(id));
    refreshing.set(id, job);
    return job;
  }
  async function refreshToken(id, a) {
    const p = new URLSearchParams({
      client_id: CID,
      client_secret: SECRET,
      grant_type: 'refresh_token',
      refresh_token: dec(a.refresh)
    });
    const r = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: p });
    if (!r.ok) {
      const detail = 'Twitch refresh failed: ' + r.status;
      log(id, 'token-refresh-error', detail + ' ' + (await r.text().catch(() => '')).slice(0, 200));
      throw Error(detail);
    }
    const t = await r.json();
    db.prepare('UPDATE accounts SET access=?,refresh=?,expires=? WHERE id=?').run(
      enc(t.access_token),
      enc(t.refresh_token || dec(a.refresh)),
      Date.now() + t.expires_in * 1000,
      id
    );
    return t.access_token;
  }
  async function api(id, route, method = 'GET', body) {
    const t = await token(id);
    const r = await fetch('https://api.twitch.tv/helix/' + route, {
      method,
      headers: {
        'Client-Id': CID,
        Authorization: 'Bearer ' + t,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const x = await r.text();
    if (!r.ok) throw Error('Twitch ' + r.status + ': ' + x.slice(0, 300));
    return x ? JSON.parse(x) : {};
  }
  const botId = () => db.prepare("SELECT value FROM config WHERE key='bot_id'").get()?.value;
  async function say(channel, message) {
    const id = botId();
    if (!id) throw Error('Connect bot first');
    const response = await api(id, 'chat/messages', 'POST', {
      broadcaster_id: channel,
      sender_id: id,
      message: String(message).slice(0, 500)
    });
    const delivery = response.data?.[0];
    if (!delivery || delivery.is_sent !== true) {
      const reason =
        delivery?.drop_reason?.message ||
        delivery?.drop_reason?.code ||
        'Twitch did not confirm delivery';
      log(channel, 'chat-send-failed', String(reason).slice(0, 260));
      throw Error('Chat message not delivered: ' + reason);
    }
    return delivery;
  }
  async function lookup(login) {
    const id = botId();
    if (!id) throw Error('Bot not connected');
    const u = await api(id, 'users?login=' + encodeURIComponent(login.replace(/^@/, '')));
    if (!u.data?.[0]) throw Error('User not found');
    return u.data[0].id;
  }
  async function moderate(channel, user, duration, reason) {
    const id = botId();
    if (!id) throw Error('Connect bot first');
    if (id === user || channel === user) throw Error('Cannot moderate bot or broadcaster');
    await api(id, 'moderation/bans?broadcaster_id=' + channel + '&moderator_id=' + id, 'POST', {
      data: {
        user_id: user,
        ...(duration ? { duration } : {}),
        reason: reason || 'KitsuFlowBOT moderation'
      }
    });
  }
  async function clip(channel) {
    const id = botId();
    if (!id) throw Error('Connect the global bot first');
    const bot = getAccount(id);
    const scopes = JSON.parse(bot?.scopes || '[]');
    if (!scopes.includes('clips:edit'))
      throw Error(
        'Shared Twitch bot is missing clips:edit. Operator must reauthorize the bot in Admin Panel using Connect/Authorize Bot (reconnecting EventSub alone does not grant permissions).'
      );
    const data = await api(
      id,
      'clips?broadcaster_id=' + encodeURIComponent(channel) + '&duration=60',
      'POST'
    );
    const c = data.data?.[0];
    if (!c) throw Error('No live clip returned');
    log(channel, 'clip', c.edit_url || c.id);
    return c;
  }
  const resolveViewer = async (login, fallback) => {
    if (!login) return fallback;
    const account = await api(
      botId(),
      'users?login=' + encodeURIComponent(login.replace(/^@/, ''))
    );
    return account.data?.[0] || null;
  };
  return { getAccount, token, api, botId, say, lookup, moderate, clip, resolveViewer };
}
