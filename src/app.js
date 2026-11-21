import { WebSocket } from 'ws';
import { loadConfig, createOperatorCheck } from './config.js';
import { openDatabase } from './core/database.js';
import { createCipher } from './core/crypto.js';
import { createLogger } from './core/logger.js';
import { createExpressApp, createHttpGuards } from './core/http.js';
import { createTwitchClient } from './twitch/client.js';
import { createEventSub } from './twitch/eventsub.js';
import { createChatHandler } from './twitch/chat-handler.js';
import { registerTwitchAuthRoutes } from './twitch/auth-routes.js';
import { registerTwitchAdminRoutes } from './twitch/admin-routes.js';
import { createGlobalCommands, GLOBAL_COMMANDS } from './commands/global-commands.js';
import { installAssistant } from './features/assistant.js';
import { createAskGpt } from './commands/askgpt.js';
import { installWatchTime } from './features/watch-time.js';
import { createOmniClient } from './features/ai/omni.js';
import { registerChannelScope } from './studio/channel-scope.js';
import { registerChannelRoutes } from './studio/channel-routes.js';
import { registerCommandsPage } from './web/commands-page.js';
import { registerPages } from './web/pages.js';
import { installPlatforms } from './platforms/index.js';
import { installNekoLive } from './platforms/nekolive.js';
import { installBeam } from './platforms/beam.js';
import { installTikTokInbound } from './platforms/tiktok/inbound.js';
import { installAccess } from './features/access.js';
import { installStreamActivity } from './features/stream-activity.js';
import { installStreamAlerts } from './features/stream-alerts.js';
import { installCreatorPayments } from './features/payments.js';
import { installSubathon } from './features/subathon.js';
import { installStreamBoss } from './features/stream-boss.js';
import { installCreatorGoals } from './features/creator-goals.js';
import { installMultichat } from './features/multichat.js';
import { installObsSources } from './features/obs-sources.js';
import { installAiTitles } from './features/ai-titles.js';
import { installRelay } from './features/chat-relay.js';
import { installEngagement } from './features/engagement.js';
import { installCreator } from './features/creator-suite.js';
import { installChatClip } from './features/chat-clip.js';
import { installPokemon } from './features/pokemon/game.js';
import { installVoice } from './features/voice/stream-worker.js';
import { installVoiceCompanion } from './features/voice/desktop-companion.js';
import { createScamProtection } from './features/scam-protection.js';

// Wires every module together. Registration order matters: the channel-scope middleware must
// run before the core Studio routes, and the static folder must come last.
export function startServer() {
  const config = loadConfig();
  const BASE = config.baseUrl;
  const db = openDatabase(config.dbPath);
  const { enc, dec } = createCipher(config.tokenKey);
  const log = createLogger(db);
  const isOperator = createOperatorCheck(config.adminIds);

  // Modules installed further down register here, so the chat handler and EventSub can reach
  // them when messages arrive.
  const features = {};
  const twitch = createTwitchClient({ db, config, enc, dec, log });
  const { api, say, moderate, clip, botId } = twitch;
  const omni = createOmniClient();
  const askgpt = createAskGpt({ omni, say: twitch.say, log });
  const globalCommands = createGlobalCommands({ db, twitch, baseUrl: BASE, log, askgpt });
  const scamProtection = createScamProtection({ db, twitch, log });
  const onChatMessage = createChatHandler({
    db,
    twitch,
    log,
    globalCommands,
    scamProtection,
    features
  });
  const eventsub = createEventSub({ db, twitch, log, onChatMessage, features });

  const app = createExpressApp(BASE);
  const { withUser, csrf, safe } = createHttpGuards(BASE);
  registerTwitchAuthRoutes(app, { db, config, enc, isOperator, eventsub, safe, csrf });

  // Accounts, activity feed and stream-event consumers.
  const access = installAccess({ app, db, withUser, csrf, safe, log });
  const streamActivity = installStreamActivity({ app, db, withUser, access });
  features.streamActivity = streamActivity;
  installStreamAlerts({ app, db, withUser, csrf, access });
  installCreatorPayments({
    app,
    db,
    withUser,
    csrf,
    access,
    enc,
    dec,
    streamActivity,
    log,
    base: BASE
  });
  const subathon = installSubathon({ app, db, withUser, csrf, access, log });
  const streamBoss = installStreamBoss({ app, db, withUser, csrf, access, log });
  const creatorGoals = installCreatorGoals({ app, db, withUser, csrf, access });
  streamActivity.setOnEvent((...args) => {
    subathon.onActivity(...args);
    streamBoss.onActivity(...args);
    creatorGoals.onActivity(...args);
    features.assistant?.onActivity(...args);
  });
  streamActivity.setSender('twitch', say);

  // Multi-chat, OBS sources, AI titles, relay and TikTok inbound chat.
  const multichat = installMultichat({ app, db, withUser, csrf, access });
  installObsSources({ app, db, withUser, access, source: multichat.source });
  installAiTitles({ app, db, withUser, csrf, access });
  const relay = installRelay({
    app,
    db,
    withUser,
    csrf,
    access,
    isOperator,
    log,
    observe: multichat.observe
  });
  features.relay = relay;
  relay.register('twitch', async (channel, text) => say(channel, text));
  const tiktok = installTikTokInbound({ app, db, withUser, csrf, access, relay, log });

  // Core Studio + admin API.
  registerChannelScope(app, { withUser, access });
  registerTwitchAdminRoutes(app, {
    db,
    config,
    enc,
    dec,
    log,
    isOperator,
    twitch,
    eventsub,
    withUser,
    csrf,
    safe
  });
  scamProtection.registerRoutes(app, { withUser, csrf, access, isOperator });
  globalCommands.registerRoutes(app, { withUser, csrf, safe, access });
  registerCommandsPage(app, { db, globalCommands });
  registerChannelRoutes(app, {
    db,
    log,
    isOperator,
    twitch,
    eventsub,
    access,
    withUser,
    csrf,
    safe,
    features
  });

  // Chat features.
  features.engagement = installEngagement({
    app,
    db,
    withUser,
    csrf,
    safe,
    say,
    moderate,
    log,
    api
  });
  installWatchTime({ db, twitch, log, recentChatters: globalCommands.recentChatters });
  features.creator = installCreator({ app, db, withUser, csrf, safe, log, say, access });
  installVoice({ app, db, withUser, csrf, access, api, clip, log, say });
  installVoiceCompanion({ app, db, withUser, csrf, access, api, clip, log, say });
  features.pokemon = installPokemon({
    app,
    db,
    withUser,
    csrf,
    access,
    api,
    say,
    log,
    isOperator,
    botId
  });
  features.chatClip = installChatClip({ app, db, withUser, csrf, access, api, clip, log, say });
  // KitsuFlowBOT Assistant desktop app: Beat Saber requests and Minecraft Interactive.
  features.assistant = installAssistant({
    app,
    db,
    withUser,
    csrf,
    safe,
    access,
    say,
    log,
    reservedCommands: () => [
      ...Object.keys(GLOBAL_COMMANDS),
      ...features.pokemon.reserved,
      ...features.engagement.reserved,
      'clip',
      'ban',
      'timeout',
      'uptime'
    ]
  });

  // Linked streaming platforms.
  const platformDeps = {
    app,
    db,
    withUser,
    csrf,
    access,
    enc,
    dec,
    log,
    base: BASE,
    isOperator,
    relay,
    streamActivity
  };
  const platformRuntime = installPlatforms({ ...platformDeps, twitchApi: api });
  const nekoliveRuntime = installNekoLive(platformDeps);
  const beamRuntime = installBeam(platformDeps);
  multichat.setProviderStatus(channel => {
    const bot = eventsub.botSocket();
    return {
      twitch: {
        status: !botId()
          ? 'pending'
          : bot?.readyState === WebSocket.OPEN
            ? 'connected'
            : bot?.readyState === WebSocket.CONNECTING
              ? 'pending'
              : 'failed',
        detail: !botId() ? 'Shared bot not connected' : 'Twitch EventSub session'
      },
      ...platformRuntime.chatStatus(channel),
      nekolive: nekoliveRuntime.chatStatus(channel),
      beam: beamRuntime.chatStatus(channel),
      tiktok: (() => {
        const status = tiktok.status(channel);
        return {
          status:
            status.status === 'connected'
              ? 'connected'
              : status.status === 'error'
                ? 'failed'
                : 'pending',
          detail: status.status + (status.username ? ' @' + status.username : '')
        };
      })()
    };
  });

  registerPages(app);
  app.listen(config.port, () => console.log('KitsuFlowBOT on ' + config.port));
  eventsub.connectChat();
  eventsub.startHealthCheck();
  process.on('unhandledRejection', err =>
    console.error('Unhandled rejection:', err?.message || err)
  );
  eventsub.connectAllEngagement();
}
