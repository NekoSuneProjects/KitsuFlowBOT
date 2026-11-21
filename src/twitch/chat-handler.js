// Twitch chat dispatcher, run for every channel.chat.message EventSub notification:
// shared-chat dedupe → scam/link moderation → feature hooks → built-in and custom commands.
export function createChatHandler({ db, twitch, log, globalCommands, scamProtection, features }) {
  const { api, say, botId, moderate, lookup } = twitch;
  const { recentChatters, linkPermits } = globalCommands;
  const cooldowns = new Map();
  const sharedCommandSeen = new Map();
  const allowed = (level, e) =>
    level === 'everyone' ||
    e.badges?.some(b => b.set_id === 'broadcaster' || b.set_id === 'moderator') ||
    (level === 'subscriber' && e.badges?.some(b => b.set_id === 'subscriber'));

  return async function message(e) {
    // EventSub broadcaster_user_id is the receiving chat; source_broadcaster_user_id
    // identifies the originating chat when Twitch mirrors messages in Shared Chat.
    const destination = String(e.broadcaster_user_id || '');
    const origin = String(e.source_broadcaster_user_id || destination);
    const ch = db.prepare('SELECT * FROM channels WHERE id=? AND enabled=1').get(destination);
    if (!ch || e.chatter_user_id === botId()) return;
    // Standalone: source_broadcaster_user_id is null. Stream Together: a message
    // can be mirrored into this destination, but source-only events belong to the origin.
    if (origin !== destination && e.is_source_only === true) return;
    const rawCommand = String(e.message?.text || '').trim();
    if (rawCommand.startsWith('!')) {
      // Mirrored EventSub notifications have distinct message_id values; the source
      // message ID identifies the underlying chat message within this destination.
      const sourceId = String(e.source_message_id || e.message_id || '');
      if (sourceId) {
        const key = destination + ':' + sourceId,
          now = Date.now();
        if ((sharedCommandSeen.get(key) || 0) > now - 60000) return;
        sharedCommandSeen.set(key, now);
        if (sharedCommandSeen.size > 2500)
          for (const [k, t] of sharedCommandSeen) if (t < now - 60000) sharedCommandSeen.delete(k);
      }
      log(
        ch.id,
        origin === destination ? 'standalone-chat-command' : 'shared-chat-command',
        origin + ' -> ' + destination + ': ' + rawCommand.slice(0, 120)
      );
    }
    if ((e.message?.text || '').trim()) {
      const members = recentChatters.get(ch.id) || new Map();
      recentChatters.set(ch.id, members);
      members.set(e.chatter_user_id, { login: e.chatter_user_login, last: Date.now() });
      for (const [id, m] of members) if (Date.now() - m.last > 600000) members.delete(id);
    }
    const rawText = e.message?.text || '';
    if (await scamProtection.check(ch, e, rawText)) return;
    if (rawText.trim())
      void features.pokemon.onChat(ch, e).catch(err => log(ch.id, 'pokemon-xp-error', err.message));
    void features.relay
      .relay(ch.id, 'twitch', e.chatter_user_login, rawText, {
        isBot: false,
        fragments: e.message?.fragments || []
      })
      .catch(err => log(ch.id, 'relay-error', err.message));
    const value = (e.message?.text || '').trim(),
      parts = value.split(/\s+/),
      cmd = parts[0]?.toLowerCase(),
      isMod = e.badges?.some(b => b.set_id === 'moderator' || b.set_id === 'broadcaster');
    const permitKey = ch.id + ':' + e.chatter_user_id,
      permitted = (linkPermits.get(permitKey) || 0) > Date.now();
    const hasLink = /https?:\/\/|(?:[a-z0-9-]+\.)+(?:com|net|org|xyz|click|shop|ru|co\.uk)\b/i.test(
      value
    );
    if (permitted && hasLink) linkPermits.delete(permitKey);
    if (ch.links && !isMod && !permitted && hasLink) {
      try {
        await moderate(ch.id, e.chatter_user_id, 60, 'Unapproved URL');
        log(ch.id, 'timeout', e.chatter_user_login + ' URL');
      } catch (err) {
        log(ch.id, 'error', err.message);
      }
      return;
    }
    try {
      if (await features.engagement.onMessage(ch, e, value, parts, isMod)) return;
      if (await features.creator.onMessage(ch, e, value, parts, isMod)) return;
      if (await features.pokemon.onMessage(ch, e, parts, isMod)) return;
      if (await features.interactive.onMessage(ch, e, value, parts)) return;
      if (await features.assistant.onMessage(ch, e, parts)) return;
      if (!cmd?.startsWith('!')) {
        await globalCommands.onTrivia(ch, e, value);
        return;
      }
      if (await globalCommands.handle({ ch, e, parts, cmd, isMod })) return;

      if (cmd === '!clip') {
        await features.chatClip.onCommand(ch, e);
        return;
      }
      if ((cmd === '!ban' || cmd === '!timeout') && isMod) {
        const target = parts[1];
        if (!target) return;
        const uid = await lookup(target);
        const seconds =
          cmd === '!timeout' ? Math.max(1, Math.min(1209600, Number(parts[2]) || 600)) : null;
        await moderate(
          ch.id,
          uid,
          seconds,
          parts.slice(cmd === '!timeout' ? 3 : 2).join(' ') || 'Moderator command'
        );
        log(ch.id, cmd, target);
        await say(ch.id, target + ' ' + (seconds ? 'timed out' : 'banned'));
        return;
      }
      if (cmd === '!uptime') {
        const s = await api(ch.id, 'streams?user_id=' + ch.id);
        await say(
          ch.id,
          s.data?.[0]
            ? 'Live since ' + new Date(s.data[0].started_at).toLocaleString()
            : 'Stream is offline'
        );
        return;
      }
      const custom = db
        .prepare('SELECT * FROM commands WHERE channel=? AND name=?')
        .get(ch.id, cmd.slice(1));
      if (!custom || features.engagement.reserved.has(cmd.slice(1)) || !allowed(custom.level, e))
        return;
      const key = ch.id + ':' + custom.name,
        now = Date.now();
      if (now < (cooldowns.get(key) || 0)) return;
      cooldowns.set(key, now + custom.cooldown * 1000);
      await say(
        ch.id,
        custom.response
          .replaceAll('{user}', e.chatter_user_name)
          .replaceAll('{channel}', ch.login)
          .replaceAll('{args}', parts.slice(1).join(' '))
      );
    } catch (err) {
      log(ch.id, 'error', err.message);
    }
  };
}
