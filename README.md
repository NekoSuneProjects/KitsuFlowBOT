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

## Streamer engagement modules

The dashboard now includes per-channel:
- **Custom commands** with cooldowns, templates and permissions (existing feature).
- **Timers** with a named announcement and interval (5–1440 minutes), sent while live.
- **Counters**, editable from the dashboard and via `!counter name` and moderator-only `!counter name +` / `!counter name -`.
- **Banned words and phrases** configured for log-only, ten-minute timeout or ban. Beware false positives; start with log-only and review.
- **Quotes** added through the dashboard or moderator-only `!addquote text`; `!quote` selects a random entry and `!quote number` chooses a specific one.
- **Viewer points** configurable with a points amount and reward interval; `!points` and `!top` display balances.

**Loyalty accuracy:** Twitch EventSub chat events do not provide an exhaustive list of viewers. This implementation awards points only to recently active chat participants after checking the channel is live. It does not and cannot correctly award points to every passive viewer/lurker without another consented presence mechanism. Watch minutes are an *estimate of active chat participation*, not actual video watch time. Points do not grant cash-equivalent rewards.

The engagement engine uses an in-process interval loop. For larger production deployments, move this into a durable, distributed queue with idempotency and per-channel rate limiting. The feature has been committed but not validated against Twitch live traffic or fully regression-tested.

## Creator Suite: rewards, viewer activities and OBS overlays

Each broadcaster owns an isolated Creator Suite in the Studio dashboard.

- **Giveaways and contests:** create open-entry or loyalty-point-cost campaigns. Viewers enter in the broadcaster's chat using `!join`. Only one entry per Twitch identity per campaign. Streamers can draw a cryptographically selected winner, which closes entries. `contest` currently uses the same random-draw mechanics as giveaway; judged competitions, voting, and submission management are not yet implemented.
- **Stream store:** create rewards priced in internal StreamNexus loyalty points with finite or unlimited stock. Viewers use `!redeem Reward name`. Requests enter a pending review queue; streamers mark fulfilled or refunded. Points are debited atomically with redemption creation.
- **Viewer queue:** `!queue join`, `!queue leave`, `!queue`; streamers can call the next user or clear the queue.
- **Leaderboard:** per-channel point totals and estimated chat-active minutes, including `!top`.
- **Reports and activity feed:** dashboard member count, points in circulation, number of redemptions, recent events, and leaderboard.
- **OBS overlays:** create per-channel browser-source pages for alert activity, points leaderboard, viewer queue or ticker at `/overlay/KEY`. Add an HTTPS overlay URL in OBS as a Browser Source. The overlay is transparent and refreshes approximately every five seconds. Test alerts are available from the Studio dashboard.

### Caveats before public launch
- Giveaways are strictly **virtual loyalty-point/community activities** at this stage. Do not use paid-entry raffles or monetary prizes without reviewing applicable platform rules and laws. A paid loyalty-point entry could also create fairness concerns; use free entry as the default.
- A public overlay URL is an unguessable bearer capability. Treat it as secret and rotate when leaked (rotation UI is a future task); never put OAuth tokens into overlays.
- This first release offers basic event displays and not the full StreamElements visual editor: scene designer, animated alert themes, real follower/sub/raid integrations, asset uploads, sound mixing and widget drag-and-drop are pending.
- No guarantees of financial or physical prize fulfillment; implement eligibility rules, entry cutoffs, anti-abuse protections, auditable draw records, and accessibility considerations before real giveaways.
- The changes are committed but have not been end-to-end tested with real Twitch channels. Stress testing, security review, pagination, durable jobs and multi-node scheduling remain pending.

## Channel accounts, staff invitations, API keys and cross-platform model

Each broadcaster has a generated **StreamNexus account ID** separate from its numeric Twitch ID. The owner can select their own channel or an invited channel using the dashboard selector. Membership roles: **Owner** (own broadcaster account), **Full Control** (administration excluding ownership transfer and security-token issuance), **Bot Supervisor** (operational moderation and bot management) and **Editor** (commands and editor content). Invites are signed by a random bearer secret, single use and expire after a configurable 1–7 days. Recipients need to log in with Twitch first; after acceptance, their channel switcher includes the shared channel. Invite links must be protected like passwords.

Owner-issued **JWT API tokens** are HMAC-SHA256 signed, scoped to `reports:read` or `overlay:read`, expiring, tracked by a hashed secret, and revocable by token ID. The only implemented bearer API endpoints are `GET /api/v1/reports` and `GET /api/v1/overlays`; use `Authorization: Bearer TOKEN`. The JWT is shown only once, never displayed as a standing credential. The channel's separately rotated **overlay integration token** is a future integration credential, **not** yet an authentication mechanism for existing overlay URLs. Existing per-widget overlay URLs remain active when this token rotates.

The application defines a provider-neutral event collection for Twitch, YouTube, Kick and VPzone, but **only Twitch sign-in/chat is currently implemented**. YouTube and Kick OAuth, webhook signature validation, retry/deduplication and mapped event ingestion remain pending. VPzone's API and event availability must be verified before building an adapter. In the future, native follows, subscribers/resubscribers, Twitch bits/raids, YouTube Super Chats/memberships, and Kick subscription/renewal events should map into a common event/alert schema only after individually verified integration.

**Security and launch warning:** this is an early prototype and has not undergone tests or code review. Before deployment, require methodical checks of scoped permissions for every endpoint, token rotation and replay resistance, authenticated overlay delivery, invite CSRF and expiry, session switching, rate-limiting and secret management. Do not distribute generated API/overlay credentials. Existing OBS overlay URLs are independent bearer links, not protected by the newly generated overlay integration token.

## Docker images via GitHub Actions

The workflow `.github/workflows/docker-publish.yml` builds for **linux/amd64** and **linux/arm64** with Buildx/QEMU and uploads to GitHub Container Registry (GHCR) when pushing to `main`, a `feature/**` branch, a `v*` tag, or manually dispatching the workflow. Pull requests build for verification but do not publish.

Image: `ghcr.io/nekosuneprojects/streamnexus`. Tags include branch/tag names; `latest` is produced only from the `main` branch. For the development branch use `feature-twitch-bot-foundation`, not `latest`, until changes are merged to main.

### Self-hosted deployment

1. Copy `.env.example` to `.env`, and set `BASE_URL`, Twitch OAuth credentials, SESSION_SECRET, TOKEN_KEY, BOT_ADMIN_TWITCH_ID. Twitch's application redirect URI must exactly match `BASE_URL/auth/callback`.
2. After merging to `main`, run `docker compose pull && docker compose up -d` using the provided `compose.yaml`. For the feature branch, change the image tag temporarily to `feature-twitch-bot-foundation`.
3. Expose the service behind a trusted HTTPS reverse proxy in production. Persist the `streamnexus_data` Docker volume, which holds the SQLite database and sessions.
4. If the repository/package remains private, grant your server's GitHub account package-read permission and log in to `ghcr.io` using a suitable token with `read:packages`. Never place a token into the Compose YAML or git repository.

The CI image-publish workflow does not install/configure Twitch credentials; secrets are supplied at **runtime** via the uncommitted `.env` file. Check the Actions run and Packages page to verify images actually published.
