// OBS browser sources keyed by the multi-chat secret (stream title/game and activity feed),
// plus the signed-in OBS stream-control dock.
export function installObsSources({ app, db, withUser, access, source }) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS stream_overlay_metadata(channel TEXT NOT NULL,platform TEXT NOT NULL,title TEXT NOT NULL,game TEXT NOT NULL,updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(channel,platform))'
  );
  // OBS Custom Browser Dock: authenticated editing only. Overlay bearer URLs remain read-only.
  app.get('/obs/stream-control', withUser, access.channelOnly('owner'), (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile('obs-stream-control.html', { root: 'public' });
  });
  app.get('/api/obs/stream-info', withUser, access.channelOnly('owner'), (req, res) => {
    res.set('Cache-Control', 'no-store').json({
      platforms: db
        .prepare(
          'SELECT platform,title,game,updated FROM stream_overlay_metadata WHERE channel=? ORDER BY platform'
        )
        .all(req.channelId)
    });
  });
  app.get('/obs/game/:key', source, (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.sendFile('obs-game.html', { root: 'public' });
  });
  app.get('/obs/activity/:key', source, (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.sendFile('obs-activity.html', { root: 'public' });
  });
  app.get('/api/obs/game/:key', source, (req, res) => {
    res.set('Cache-Control', 'no-store').json({
      platforms: db
        .prepare(
          'SELECT platform,title,game,updated FROM stream_overlay_metadata WHERE channel=? ORDER BY platform'
        )
        .all(req.source.channel)
    });
  });
  app.get('/api/obs/activity/:key', source, (req, res) => {
    const after = Math.max(0, Math.min(2147483647, Number(req.query.after) || 0));
    const messages = db
      .prepare(
        'SELECT id,platform,event_type,actor,detail,created FROM stream_activity WHERE channel=? AND id>? ORDER BY id ASC LIMIT 60'
      )
      .all(req.source.channel, after);
    res.set('Cache-Control', 'no-store').json({ events: messages });
  });
  app.get('/api/obs/activity', withUser, access.channelOnly('editor'), (req, res) => {
    const after = Math.max(0, Math.min(2147483647, Number(req.query.after) || 0));
    res.set('Cache-Control', 'no-store').json({
      events: db
        .prepare(
          'SELECT id,platform,event_type,actor,detail,created FROM stream_activity WHERE channel=? AND id>? ORDER BY id ASC LIMIT 100'
        )
        .all(req.channelId, after)
    });
  });
}
