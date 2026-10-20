# StreamNexus

A working **early-stage Twitch bot foundation** with broadcaster OAuth login, a separate bot account, chat EventSub, custom commands, timeouts, bans, clips, browser voice-trigger clipping, URL timeout rules and a dark-purple Studio dashboard.

## Requirements

Node.js 22+, Twitch developer application, an HTTPS reverse proxy in production.

1. Register a Twitch application at https://dev.twitch.tv/console/apps. OAuth redirect URL must match `BASE_URL/auth/callback` exactly (e.g. `http://localhost:3000/auth/callback` for local development).
2. Copy `.env.example` to `.env`. Configure Twitch client ID/secret, strong SESSION_SECRET and a TOKEN_KEY using `openssl rand -hex 32`. Never commit credentials.
3. Run `npm install && npm start` or `docker compose up --build -d`.
4. Visit the web dashboard. Sign in as the streamer, then connect the **separate bot Twitch account**. Enable the bot on the dashboard.
5. In the channel chat, the broadcaster must type `/mod YOUR_BOT_USERNAME` to grant Twitch moderator rights. Without this Twitch-granted role, bot moderation endpoints will fail. Broadcaster OAuth provides channel:bot consent for chat subscriptions but does not give moderator status.
6. Use the custom commands dashboard; `!clip` (moderators), `!timeout username 600 reason`, `!ban username reason` (moderators), `!uptime`. Use voice control in a supported Chromium browser to say **clip it**.

### Capabilities and limitations

- Streamer/bot OAuth user tokens are separately encrypted at rest (AES-256-GCM); refresh tokens rotate.
- EventSub WebSocket is used to ingest chat. Current version opens a single bot WebSocket and recreates subscriptions after reconnect; production should add resilient reconnect-url handling and subscription failure reporting.
- Voice uses Web Speech API in a browser tab after explicit microphone authorisation. It is NOT an always-running desktop microphone service. Browser support, background-tab restrictions and any browser-based speech processing vary.
- Twitch clips require a live broadcast with clipping enabled and Twitch's required user permissions. The returned edit/clip may take time to become available.
- Unapproved URL detection is simplistic and OFF by default only if you uncheck it. Do not rely on the rule as production-grade scam detection. Add link allowlists, review logs, exclusions, and rate limits before rollout.
- This is an initial functional foundation, **not a finished StreamElements/Nightbot alternative**. Needed: robust multi-tenant workers, CSRF token model, session store hardening, per-command granular permissions, live stream events, overlays, migrations, moderation allowlists, metrics, webhook verification, test coverage, and desktop voice app.
- Self-host behind HTTPS. For production set `BASE_URL` to the exact HTTPS origin, `TRUST_PROXY=true` only behind a trusted reverse proxy, and back up the SQLite volume.
- Twitch docs: https://dev.twitch.tv/docs/chat/authenticating/ , https://dev.twitch.tv/docs/eventsub/ , https://dev.twitch.tv/docs/api/reference/

## Multi-channel shared bot (one bot, many broadcasters)

**Set `BOT_ADMIN_TWITCH_ID`** to the numeric Twitch ID of the StreamNexus operator before deployment. Only that account can authorise or replace the global NexusBot Twitch account. Other streamers never connect their own bot account.

1. Operator logs in with Twitch, chooses **Connect global bot account**, authorises the dedicated NexusBot account exactly once.
2. Every streamer logs in to StreamNexus using their **own** broadcaster Twitch account and grants `channel:bot` and `clips:edit`.
3. Each streamer enables the bot only for their own channel. The bot then subscribes to incoming chat events for enabled channels and uses per-channel commands and settings.
4. For moderator actions, each streamer must grant the **shared bot** moderator status on Twitch, e.g. `/mod NexusBotUsername`.
5. Streamers can disable or disconnect their own channel without affecting anyone else's data or account.

**Important scaling note:** This early version uses a single bot-account EventSub WebSocket and reconnects it when channel membership changes. Twitch has per-user WebSocket and per-connection subscription limits, so this must be migrated to App Access Token + EventSub webhooks or conduits, including the required broadcaster authorisations, before serving large numbers of channels. Twitch recommends cloud chatbot architecture for this scenario. Production rollout also requires better reconnect/health monitoring, channel authorisation verification and security testing.
