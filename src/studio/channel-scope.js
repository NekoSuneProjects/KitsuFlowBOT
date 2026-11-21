// Core Studio endpoints act on the *selected* channel (owner or invited team member), not the
// login identity. This sets req.channelId and enforces the minimum role per path and method.
export function registerChannelScope(app, { withUser, access }) {
  app.use(
    [
      '/api/state',
      '/api/settings',
      '/api/commands',
      '/api/clip',
      '/api/moderate',
      '/api/engagement',
      '/api/creator'
    ],
    withUser,
    (req, res, next) => {
      const channel = access.channelFor(req);
      if (!channel) return res.status(403).json({ error: 'No channel access' });
      if (req.path.startsWith('/api/settings') && !access.can(req.session.uid, channel, 'owner'))
        return res.status(403).json({ error: 'Owner access required' });
      if (req.method !== 'GET') {
        const required =
          req.path.startsWith('/api/moderate') ||
          req.path.startsWith('/api/settings') ||
          req.path.startsWith('/api/clip') ||
          req.path.startsWith('/api/creator/queue') ||
          req.path.startsWith('/api/creator/campaign/draw') ||
          req.path.startsWith('/api/creator/redeem')
            ? 'bot_supervisor'
            : 'editor';
        if (!access.can(req.session.uid, channel, required))
          return res.status(403).json({ error: 'Insufficient channel permissions' });
      }
      req.channelId = channel;
      next();
    }
  );
}
