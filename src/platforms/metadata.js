import { providers, platformSafe as safe } from './oauth.js';

// Multi-platform stream title/category search and sync (Twitch, Kick, VPZone), plus raw
// linked-channel lookups.
export function registerStreamMetadata(app, { db, withUser, csrf, access, refresh, twitchApi }) {
  // Stream metadata editing is owner-only. Category IDs always come from each provider's own catalog.
  const providerRequest = async (url, token, method = 'GET', body) => {
    const r = await fetch(url, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) throw Error('HTTP ' + r.status + ': ' + (await r.text()).slice(0, 180));
    return r.status === 204 ? {} : await r.json();
  };
  app.get(
    '/api/stream-metadata/categories',
    withUser,
    access.channelOnly('owner'),
    safe(async (req, res) => {
      const q = String(req.query.q || '')
          .trim()
          .slice(0, 80),
        result = {};
      if (q.length < 2) return res.status(400).json({ error: 'Enter at least two characters' });
      try {
        const d = await twitchApi(
          req.channelId,
          'search/categories?query=' + encodeURIComponent(q) + '&first=20'
        );
        result.twitch = (d.data || []).map(x => ({ id: String(x.id), name: x.name }));
      } catch (err) {
        result.twitch_error = err.message;
      }
      const kick = db
        .prepare("SELECT 1 FROM platform_oauth WHERE channel=? AND platform='kick'")
        .get(req.channelId);
      if (kick)
        try {
          const token = await refresh(req.channelId, 'kick');
          const data = await providerRequest(
            'https://api.kick.com/public/v2/categories?name=' + encodeURIComponent(q) + '&limit=30',
            token
          );
          result.kick = (data.data || [])
            .map(x => ({ id: String(x.id), name: x.name }))
            .filter(x => x.name.toLowerCase().includes(q.toLowerCase()));
        } catch (err) {
          result.kick_error = err.message;
        }
      const vp = db
        .prepare("SELECT 1 FROM platform_oauth WHERE channel=? AND platform='vpzone'")
        .get(req.channelId);
      if (vp)
        try {
          const token = await refresh(req.channelId, 'vpzone');
          const data = await providerRequest('https://vpzone.tv/api/v1/categories', token);
          const options = Array.isArray(data.data)
            ? data.data
            : Array.isArray(data.data?.categories)
              ? data.data.categories
              : [];
          result.vpzone = options
            .filter(x =>
              String(x.name || x.title || '')
                .toLowerCase()
                .includes(q.toLowerCase())
            )
            .slice(0, 30)
            .map(x => ({ id: String(x.slug || x.id || x.name), name: x.name || x.title }));
        } catch (err) {
          result.vpzone_error = err.message;
        }
      res.json(result);
    })
  );
  app.post(
    '/api/stream-metadata/sync',
    withUser,
    access.channelOnly('owner'),
    csrf,
    safe(async (req, res) => {
      const title = String(req.body?.title || '').trim(),
        categories = req.body?.categories || {},
        selected = req.body?.platforms;
      if (
        !title ||
        title.length > 140 ||
        !categories ||
        typeof categories !== 'object' ||
        !Array.isArray(selected) ||
        !selected.length ||
        selected.some(x => !['twitch', 'kick', 'vpzone'].includes(x)) ||
        new Set(selected).size !== selected.length
      )
        return res.status(400).json({ error: 'Invalid title or platforms' });
      const result = [];
      for (const platform of selected) {
        try {
          const chosen = categories[platform];
          if (
            !chosen ||
            typeof chosen !== 'object' ||
            typeof chosen.id !== 'string' ||
            !chosen.id ||
            typeof chosen.name !== 'string' ||
            !chosen.name
          )
            throw Error('Select a matching ' + platform + ' category first');
          if (platform === 'twitch') {
            await twitchApi(
              req.channelId,
              'channels?broadcaster_id=' + encodeURIComponent(req.channelId),
              'PATCH',
              { title, game_id: chosen.id }
            );
          } else {
            const linked = db
              .prepare(
                'SELECT display_name,external_id FROM platform_oauth WHERE channel=? AND platform=?'
              )
              .get(req.channelId, platform);
            if (!linked) throw Error('Platform not linked');
            const token = await refresh(req.channelId, platform);
            if (platform === 'kick') {
              if (!/^[0-9]+$/.test(chosen.id)) throw Error('Invalid Kick category ID');
              await providerRequest('https://api.kick.com/public/v1/channels', token, 'PATCH', {
                stream_title: title,
                category_id: Number(chosen.id)
              });
            } else {
              // The VPZone channel slug is returned by /me; username alone is not guaranteed to be slug.
              const me = await providerRequest('https://vpzone.tv/api/v1/me', token);
              const slug = me.data?.channel?.slug;
              if (!slug) throw Error('VPZone channel slug unavailable');
              await providerRequest(
                'https://vpzone.tv/api/v1/channels/' + encodeURIComponent(slug),
                token,
                'PATCH',
                { title, category: chosen.name }
              );
            }
          }
          db.prepare(
            'INSERT INTO stream_overlay_metadata(channel,platform,title,game,updated) VALUES(?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(channel,platform) DO UPDATE SET title=excluded.title,game=excluded.game,updated=CURRENT_TIMESTAMP'
          ).run(req.channelId, platform, title, chosen.name);
          result.push({ platform, status: 'updated', category: chosen.name });
        } catch (err) {
          result.push({
            platform,
            status: 'failed',
            error: String(err.message || err).slice(0, 220)
          });
        }
      }
      res.json({ results: result });
    })
  );
  app.get(
    '/api/platforms/:platform/channel',
    withUser,
    access.channelOnly('owner'),
    safe(async (req, res) => {
      const type = req.params.platform;
      if (!providers[type]) return res.sendStatus(404);
      const row = db
        .prepare('SELECT * FROM platform_oauth WHERE channel=? AND platform=?')
        .get(req.channelId, type);
      if (!row) return res.status(404).json({ error: 'Platform not connected' });
      const token = await refresh(req.channelId, type);
      const url =
        type === 'vpzone'
          ? 'https://vpzone.tv/api/v1/channels/' + encodeURIComponent(row.display_name)
          : 'https://api.kick.com/public/v1/channels?broadcaster_user_id=' +
            encodeURIComponent(row.external_id);
      const r = await fetch(url, {
        headers: { Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(10000)
      });
      if (!r.ok) throw Error(type + ' channel query failed ' + r.status);
      res.json({ platform: type, data: await r.json() });
    })
  );
}
