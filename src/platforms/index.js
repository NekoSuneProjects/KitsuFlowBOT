import { createPlatformOAuth } from './oauth.js';
import { createVpzone } from './vpzone.js';
import { createKick } from './kick.js';
import { registerStreamMetadata } from './metadata.js';

// Linked Kick and VPZone broadcaster accounts. Twitch stays the primary sign-in.
export function installPlatforms(deps) {
  const { app, db, withUser, access } = deps;
  db.exec(`CREATE TABLE IF NOT EXISTS platform_oauth(channel TEXT NOT NULL,platform TEXT NOT NULL,external_id TEXT NOT NULL,display_name TEXT NOT NULL,access_token TEXT NOT NULL,refresh_token TEXT NOT NULL,expires_at INTEGER NOT NULL,scopes TEXT NOT NULL,PRIMARY KEY(channel,platform));
 CREATE TABLE IF NOT EXISTS platform_delivery(platform TEXT NOT NULL,message_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(platform,message_id));`);
  db.exec(
    'CREATE TABLE IF NOT EXISTS platform_bot_accounts(platform TEXT PRIMARY KEY,external_id TEXT NOT NULL,display_name TEXT NOT NULL,access_token TEXT NOT NULL,refresh_token TEXT NOT NULL,expires_at INTEGER NOT NULL)'
  );
  const hooks = {};
  const { refresh } = createPlatformOAuth({ ...deps, hooks });
  const vpzone = createVpzone({ ...deps, refresh });
  const kick = createKick({ ...deps, refresh });
  hooks.onLinked = (channel, type, identity) => {
    if (type === 'kick') void kick.subscribe(channel);
    if (type === 'vpzone') vpzone.connect(channel, identity.display);
  };
  hooks.onUnlinked = (channel, type) => {
    if (type === 'vpzone') vpzone.disconnect(channel);
  };
  registerStreamMetadata(app, { ...deps, refresh });
  app.get('/api/platforms/runtime', withUser, access.channelOnly('owner'), (req, res) => {
    res.json({
      vpzone: {
        linked: Boolean(
          db
            .prepare("SELECT 1 FROM platform_oauth WHERE channel=? AND platform='vpzone'")
            .get(req.channelId)
        ),
        chat_connected: vpzone.isChatOpen(req.channelId)
      },
      kick: {
        linked: Boolean(
          db
            .prepare("SELECT 1 FROM platform_oauth WHERE channel=? AND platform='kick'")
            .get(req.channelId)
        ),
        webhook_enabled: process.env.KICK_WEBHOOK_ENABLED !== 'false',
        subscription_active:
          db.prepare('SELECT status FROM kick_chat_status WHERE channel=?').get(req.channelId)
            ?.status === 'subscribed',
        detail:
          db.prepare('SELECT detail FROM kick_chat_status WHERE channel=?').get(req.channelId)
            ?.detail || 'Subscription not registered'
      }
    });
  });
  return {
    chatStatus: channel => ({ vpzone: vpzone.chatStatus(channel), kick: kick.chatStatus(channel) })
  };
}
