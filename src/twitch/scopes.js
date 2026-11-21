// Twitch OAuth scopes. The shared bot and broadcasters are authorised separately.
export const BOT_SCOPES =
  'user:read:chat user:write:chat user:bot moderator:manage:banned_users moderator:manage:chat_messages clips:edit';
export const STREAMER_SCOPES = [
  'channel:bot',
  'clips:edit',
  'user:read:email',
  'user:read:broadcast',
  'channel:manage:broadcast',
  'channel:manage:redemptions',
  'channel:read:redemptions',
  'bits:read',
  'channel:read:subscriptions',
  'channel:manage:polls',
  'channel:read:polls',
  'channel:manage:predictions',
  'channel:read:predictions',
  'moderator:read:followers',
  'moderator:read:chatters',
  'moderation:read',
  'channel:read:hype_train',
  'channel:read:ads',
  'channel:manage:ads'
].join(' ');
