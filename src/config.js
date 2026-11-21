// Environment configuration for the core server. Feature modules read their own optional
// provider settings (KICK_*, VPZONE_*, NEKOLIVE_*, AI_TITLE_*, ...) directly.
export function loadConfig(env = process.env) {
  const twitch = { clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET };
  const tokenKey = Buffer.from(env.TOKEN_KEY || '', 'hex');
  if (
    !twitch.clientId ||
    !twitch.clientSecret ||
    tokenKey.length !== 32 ||
    !env.SESSION_SECRET ||
    env.SESSION_SECRET.length < 24
  )
    throw Error('Set Twitch credentials, 32-byte TOKEN_KEY and SESSION_SECRET in .env');
  return {
    port: Number(env.PORT || 3000),
    baseUrl: (env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
    dbPath: env.DB_PATH || 'data/streamnexus.sqlite',
    twitch,
    tokenKey,
    // Numeric Twitch IDs allowed into the Admin Panel (BOT_ADMIN_TWITCH_ID is the legacy single value).
    adminIds: new Set(
      (env.BOT_ADMIN_TWITCH_IDS || env.BOT_ADMIN_TWITCH_ID || '')
        .split(',')
        .map(s => s.trim())
        .filter(s => /^[0-9]+$/.test(s))
    )
  };
}

export const createOperatorCheck = adminIds => id => Boolean(id && adminIds.has(String(id)));
