# KitsuFlowBOT

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

**Set `BOT_ADMIN_TWITCH_ID`** to the numeric Twitch ID of the KitsuFlowBOT operator before deployment. Only that account can authorise or replace the global NexusBot Twitch account. Other streamers never connect their own bot account.

1. Operator logs in with Twitch, chooses **Connect global bot account**, authorises the dedicated NexusBot account exactly once.
2. Every streamer logs in to KitsuFlowBOT using their **own** broadcaster Twitch account and grants `channel:bot` and `clips:edit`.
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
- **Stream store:** create rewards priced in internal KitsuFlowBOT loyalty points with finite or unlimited stock. Viewers use `!redeem Reward name`. Requests enter a pending review queue; streamers mark fulfilled or refunded. Points are debited atomically with redemption creation.
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

Each broadcaster has a generated **KitsuFlowBOT account ID** separate from its numeric Twitch ID. The owner can select their own channel or an invited channel using the dashboard selector. Membership roles: **Owner** (own broadcaster account), **Full Control** (administration excluding ownership transfer and security-token issuance), **Bot Supervisor** (operational moderation and bot management) and **Editor** (commands and editor content). Invites are signed by a random bearer secret, single use and expire after a configurable 1–7 days. Recipients need to log in with Twitch first; after acceptance, their channel switcher includes the shared channel. Invite links must be protected like passwords.

Owner-issued **JWT API tokens** are HMAC-SHA256 signed, scoped to `reports:read` or `overlay:read`, expiring, tracked by a hashed secret, and revocable by token ID. The only implemented bearer API endpoints are `GET /api/v1/reports` and `GET /api/v1/overlays`; use `Authorization: Bearer TOKEN`. The JWT is shown only once, never displayed as a standing credential. The channel's separately rotated **overlay integration token** is a future integration credential, **not** yet an authentication mechanism for existing overlay URLs. Existing per-widget overlay URLs remain active when this token rotates.

The application defines a provider-neutral event collection for Twitch, YouTube, Kick and VPzone, but **only Twitch sign-in/chat is currently implemented**. YouTube and Kick OAuth, webhook signature validation, retry/deduplication and mapped event ingestion remain pending. VPzone's API and event availability must be verified before building an adapter. In the future, native follows, subscribers/resubscribers, Twitch bits/raids, YouTube Super Chats/memberships, and Kick subscription/renewal events should map into a common event/alert schema only after individually verified integration.

**Security and launch warning:** this is an early prototype and has not undergone tests or code review. Before deployment, require methodical checks of scoped permissions for every endpoint, token rotation and replay resistance, authenticated overlay delivery, invite CSRF and expiry, session switching, rate-limiting and secret management. Do not distribute generated API/overlay credentials. Existing OBS overlay URLs are independent bearer links, not protected by the newly generated overlay integration token.

## Docker images via GitHub Actions

The workflow `.github/workflows/docker-publish.yml` builds for **linux/amd64** and **linux/arm64** with Buildx/QEMU and uploads to GitHub Container Registry (GHCR) when pushing to `main`, a `feature/**` branch, a `v*` tag, or manually dispatching the workflow. Pull requests build for verification but do not publish.

Image: `ghcr.io/nekosuneprojects/kitsuflowbot`. Tags include branch/tag names; `latest` is produced only from the `main` branch. For the development branch use `feature-twitch-bot-foundation`, not `latest`, until changes are merged to main.

### Self-hosted deployment

1. Copy `.env.example` to `.env`, and set `BASE_URL`, Twitch OAuth credentials, SESSION_SECRET, TOKEN_KEY, BOT_ADMIN_TWITCH_ID. Twitch's application redirect URI must exactly match `BASE_URL/auth/callback`.
2. After merging to `main`, run `docker compose pull && docker compose up -d` using the provided `compose.yaml`. For the feature branch, change the image tag temporarily to `feature-twitch-bot-foundation`.
3. Expose the service behind a trusted HTTPS reverse proxy in production. Persist the `kitsuflowbot_data` Docker volume, which holds the SQLite database and sessions.
4. If the repository/package remains private, grant your server's GitHub account package-read permission and log in to `ghcr.io` using a suitable token with `read:packages`. Never place a token into the Compose YAML or git repository.

The CI image-publish workflow does not install/configure Twitch credentials; secrets are supplied at **runtime** via the uncommitted `.env` file. Check the Actions run and Packages page to verify images actually published.

## Studio dashboard redesign and global bot management

The Studio interface now uses a sidebar with separate pages for overview, activity feed, reports, custom commands, timers, moderation, voice clipping, loyalty, giveaways, store, viewer queues, quotes/counters, overlays, channel connections, channel settings, team invitations and an operator-only Admin Panel. It is responsive and uses a consistent dark design.

**One public bot for everyone:** Configure `BOT_ADMIN_TWITCH_ID` with the **numeric Twitch user ID of the KitsuFlowBOT platform administrator**. Sign into Studio as that account, open **Admin Panel**, then choose **Connect public Twitch bot**. On the Twitch authorisation prompt sign into the **separate dedicated bot account**, not the broadcaster account. Other streamers only authorise their own broadcaster account and then enable the shared bot in Connections. Give the shared bot moderator privileges on channels needing moderation actions.

The Admin Panel shows configured channels, connection state and a safe EventSub reconnect control. Access is enforced on the server, not just hidden in the UI. The streamer-only OAuth callback remains `/auth/callback`; the bot initiation route is `/auth/connect/bot`.

The interface is a substantial frontend overhaul against the current Express APIs, **not** an independently verified production deployment. Test login, channel switching, admin authorisation, CRUD features, mobile layout and Twitch EventSub against your actual domain before release.

## Twitch OAuth: broadcaster versus one public bot

Use `BOT_ADMIN_TWITCH_IDS=12345678,23456789` to allow multiple **numeric** Twitch user IDs into the Admin Panel. The older `BOT_ADMIN_TWITCH_ID` setting is supported as a fallback when the new one is unset. Each broadcaster signs into their own account, authorises broadcaster-scoped API features, and controls only their authorised channel. Broadcaster scopes are intentionally separate from the dedicated public bot scopes. Do not reuse third-party Twitch client IDs or redirects copied from StreamElements or other apps.

The dedicated public bot uses `user:read:chat user:write:chat user:bot moderator:manage:banned_users`. The operator can authorise it using the ordinary Twitch account flow or the **Admin Panel → Generate Twitch device code** flow. Open the Twitch verification URL on a separate device/browser, sign into the **bot account**, approve, then press **Check authorisation** in the admin panel. Twitch device codes expire and the check endpoint enforces a polling interval. The server rejects a bot token whose Twitch ID is the same as the operator/streamer Twitch account.

Broadcasters receive permissions for the currently envisaged channel features, including clips, channel chat bot access, basic channel management, follower lists, subscription information, cheers and channel point activity. **Follower-bot detection is not yet implemented**; `moderator:read:followers` is authorization for follower inspection, not an automatic malicious-follower detector. Twitch follower reviews should avoid automatic bans based solely on heuristic scoring. A broader optional-permission flow can be introduced later to reduce up-front consent.

No tokens or device secrets are returned after grant completion. Only configured operators can initiate or poll the bot device grant. Use HTTPS, do not expose codes publicly, test the Twitch redirect `https://kitsuflowbot.nekosunevr.co.uk/auth/callback`, and confirm bot identity in the Admin Panel after connection.

## Firefox-compatible voice clipping (opt-in Docker worker)

This branch introduces **server-side Twitch live-stream audio recognition**, so browser speech-recognition support is not required. The architecture is `Streamlink (lowest quality) → FFmpeg (mono 16 kHz PCM) → Vosk (offline ASR) → authenticated KitsuFlowBOT API → Twitch Create Clip`. Audio is processed in memory; no recording is intentionally saved.

### Setup
1. In `.env`, set `VOICE_WORKER_SECRET` to a random 32-byte hex string (e.g. `openssl rand -hex 32`). Keep `BASE_URL`, Twitch credentials, and existing secrets as before.
2. Download the **small English Vosk speech recognition model** from [Vosk Models](https://alphacephei.com/vosk/models) and extract its files into `./models/vosk/` (so `./models/vosk/am`, `./models/vosk/conf`, etc. exist). Ensure the Docker worker UID 65534 can read the directory. The model isn't bundled in Git to avoid committing large binary files.
3. Start the backend with `docker compose up -d`. Start the voice worker with `docker compose --profile voice up -d --build voice-worker`.
4. On the broadcaster's **Voice & Clips** Studio page, enable recognition, set a trigger phrase such as `clip it`, and select cooldown (20–600 seconds).
5. Ensure the streamer authorised Twitch `clips:edit`, is live and enabled the bot. When someone says the phrase in the stream audio, the worker attempts a clip and the clip appears in Voice & Clips history.

### Privacy, latency and scale
- **Explicit opt-in per channel**; disabled by default. Audio processing stops after the channel goes offline/gets disabled (next scheduler poll). Never process private or unconsented broadcasts.
- Recognition listens to **all mixed broadcast audio** (game, Discord callers and guests), not exclusively the streamer's microphone. False triggers are possible.
- Twitch HLS playback latency and speech recognition delay may cause clips to cover a later window than the intended moment. Twitch Create Clip is asynchronous and playback is subject to availability and platform conditions.
- The voice Docker service is opt-in (`profiles: [voice]`), runs as unprivileged UID, has CPU and memory limits, and defaults to one simultaneously monitored channel. Higher concurrency needs more CPU/RAM and separately provisioned workers.
- If Twitch playback changes or Streamlink loses access, recognition will fail until the integration is updated; Twitch Helix does not provide an HLS URL.
- This implementation is an **initial beta**, not live-tested. The speech model must be installed explicitly. Do not enable on hundreds of channels without durable work queues, per-stream status reporting, retries/backoff, resource accounting and tests.

## Kick and VPZone connections (beta)

The Studio **Connections** page now supports two additional OAuth 2.1 broadcaster connections, independently of Twitch. Each is scoped to the currently selected, owner-controlled channel; neither replaces the dedicated Twitch bot account.

**Kick:** Register an app at https://dev.kick.com and set `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET`. Register the exact callback `https://kitsuflowbot.nekosunevr.co.uk/auth/platform/callback/kick`. The connection requests `user:read channel:read events:subscribe` with S256 PKCE and encrypts tokens at rest. Kick webhook endpoint: `https://kitsuflowbot.nekosunevr.co.uk/webhooks/kick`. Configure the webhook URL in Kick developer settings. The receiver verifies the signed raw payload against Kick's rotating public key, checks message timestamps and deduplicates message IDs. It stores verified messages in the existing platform event/activity and overlay tables **when the Kick broadcaster ID matches a connected channel**. **Event subscriptions must still be created through Kick's Events Subscriptions API**; configuring a webhook URL alone is not enough for live alerts.

**VPZone:** Register a confidential OAuth app at https://vpzone.tv/developers/oauth and configure `VPZONE_CLIENT_ID` / `VPZONE_CLIENT_SECRET`. Register exact callback `https://kitsuflowbot.nekosunevr.co.uk/auth/platform/callback/vpzone`. OAuth 2.1 requires S256 PKCE for confidential apps too; rotating refresh tokens are encrypted at rest. KitsuFlowBOT reads `/api/v1/me` and uses the returned **channel slug** (not username) for a channel lookup. This first version supports connecting/disconnecting the account and authorised channel reads; VPZone realtime WebSocket/chat, registered signed webhooks and automated follower/cheer/subscription overlays require a follow-up provider adapter and are **not** enabled yet.

Do not paste user API keys into the UI or GitHub. Configure server-side OAuth application credentials in an uncommitted `.env` file and restart Docker. Existing Twitch bot/moderation, loyalty and Streamlink clipping stay Twitch-specific until corresponding Kick and VPZone adapters are independently developed and tested.

**Release warning:** these integrations have been code-authored but not end-to-end tested against real Kick/VPZone accounts. Confirm response schemas, registration, refresh, webhook subscriptions and events in a staging environment before production.

## Public homepage and unified creator profile

- `/`: public KitsuFlowBOT information homepage, accessible without signing in.
- `/login`: Twitch sign-in page. Twitch remains the **single primary sign-in**.
- `/dashboard`: creator Studio, requires a Twitch session; unauthenticated visitors are redirected to `/login`.
- Kick and VPZone are **linked streaming accounts**, not separate KitsuFlowBOT login identities. They attach to the active Twitch-owned creator channel and return to `/dashboard` after OAuth.
- The existing commands, timers, loyalty data, overlays and settings remain associated with the primary Twitch creator channel; connecting an additional provider does not copy or reset them.

**Cross-platform execution limitation:** These shared settings become the source of truth for additional platform adapters, but Kick and VPZone commands are **not yet executed or sent in their respective chats**. Their respective incoming chat events, outgoing messaging and permission mapping must be implemented and tested before cross-platform commands, timers and moderation become active. Kick verified webhook events may populate the common activity/overlay store after Kick event subscriptions are configured. Do not promise that Twitch-only moderation or clipping transfers to other platforms.

## Kick bot messages and multi-platform voice trigger beta

The linked Kick channel now has a dashboard **Send via Kick bot** test action. It uses a Kick OAuth client-credentials **application token** and the documented `POST https://api.kick.com/public/v1/chat` with `{content,type:"bot"}`, matching the implementation pattern in the private `NekoSuneProjectsPrivate/StreamBOT` repository's `backendlive/src/kickBot.ts`. It does not impersonate the Twitch bot, and the Kick API/app must permit bot chat posting. Do not send a message to any channel without a linked and authorised Kick broadcaster. Chat command listeners for Kick still require webhook subscriptions and dispatch routing.

**Voice & Clips:** The same Docker worker may opt into separate Kick and VPZone stream-audio processing with a trigger phrase and cooldown per platform. The platform source is constructed exclusively from the authorised linked channel slug and the fixed Kick or VPZone host, and the backend verifies the linked account and opt-in status. The worker uses Streamlink → FFmpeg → offline Vosk, so Firefox needs no microphone API.

**Important: Voice trigger detection is not native clip creation.** The publicly documented Kick API has no official clip creation endpoint as of October 2026, and VPZone's API documents clips **read/list** but not a create endpoint. Successful recognition on Kick or VPZone is recorded as `trigger_detected_native_clips_api_unavailable`, not as a new clip. Do not claim a successful clip or invent a provider endpoint. Playback discovery for Kick and especially VPZone is not guaranteed supported by Streamlink; if it fails, the worker stops that source and retries on the next scheduler cycle. Verify provider permissions, publicly accessible live playback, CPU limits and worker logs before enabling. This is beta, not a production-ready automatic Kick/VPZone clipping solution. A supported OBS local recorder/rolling-buffer adapter would provide a better cross-platform clip-creation backend.

## Multi-platform shared bots and chat relay — implementation notes

Private reference reviewed: `NekoSuneProjectsPrivate/StreamBOT`, branch `backendlive`, notably `.env.example`, `src/kickBot.ts`, `src/kickTokens.ts` and `src/index.ts`. Its Kick implementation contains configurable scopes, optional Pusher realtime subscriptions, webhook handling, anti-spam settings, and Twitch↔Kick relay directions. Only the independently appropriate configuration and officially authenticated message posting patterns were carried into this PR. The Pusher websocket URL is documented as a reference, not enabled, and raw-message logging remains disabled.

In **Admin Panel → Shared Kick / VPZone bot accounts**, platform admins can initiate a separate OAuth PKCE flow for a dedicated bot identity and revoke the connection; broadcaster accounts remain linked to their own Twitch-owned creator profile. Platform bot tokens are encrypted in SQLite, and connecting a bot identity already linked as a broadcaster is rejected. Register these additional developer-app redirect URLs:

- `https://kitsuflowbot.nekosunevr.co.uk/auth/platform-bot/callback/kick`
- `https://kitsuflowbot.nekosunevr.co.uk/auth/platform-bot/callback/vpzone`

Kick's application-token **bot** chat posting remains the supported active send method; the newly linked user bot identity is stored but not yet used to send. VPZone bot authorization is implemented as an identity link, **not working chat sending**, until VPZone's official write endpoint and permissions are verified.

Studio → Connections → **Cross-platform chat relay** offers directional per-channel toggles for Twitch, Kick, VPZone. All toggles default to **disabled**. The relay engine labels messages, limits length, suppresses duplicate content and ignores already-relayed messages to avoid loops. Twitch and Kick are registered output transports; VPZone is not registered until its official send API is added. Kick incoming chat requires a Kick subscription that actually delivers signed `chat.message.sent` or `chat.message.created` webhooks; installing a webhook endpoint by itself does not complete event subscriptions. The legacy Pusher listener is **not** implemented in this PR, so Kick-to-Twitch relay must not be assumed live. Do not enable public cross-posting without permission from each connected channel and moderators.

This remains a draft/beta requiring manual OAuth, event schema, relay, and rate-limit tests. 

## Provider connection lifecycle

OAuth linking is not equivalent to running a realtime listener. VPZone now opens the documented public chat WebSocket (`wss://chat.vpzone.tv/ws?channel=<slug>`) after a broadcaster connects and restores existing connections after server restarts, with reconnect-on-close and a per-channel runtime status in Connections. Incoming VPZone chat is only relayed to configured supported targets when the creator explicitly enabled a route; VPZone outbound chat is still unsupported. Kick currently validates signed webhook deliveries but does **not** create Kick event subscriptions; its runtime status explicitly reports that no subscription is active. Kick bots and broadcaster logins do not implicitly connect a Pusher socket. Add official subscription provisioning and confirm callbacks/permission scopes before claiming Kick automatic chat works. Confirm incoming VPZone event message structure with a live-stream integration test.

## VPZone bot outgoing chat and custom commands (PR #9)

VPZone documents `POST /api/v1/channels/{slug}/chat` and the `chat:write` OAuth permission. KitsuFlowBOT now requests `chat:write` for VPZone OAuth, authenticates the outgoing API request using the **separately connected VPZone bot account**, refreshes its rotating OAuth tokens, and offers a test message under Connections. The VPZone WebSocket also checks the shared creator profile's custom `!commands`, with cooldown and `everyone` access only. Moderator/subscriber-restricted commands cannot execute until trustworthy platform-role mapping is available. Relay to VPZone is now supported using this same bot sender.

**Reauthorise your VPZone bot account from Admin Panel after upgrading:** an already linked OAuth grant may lack `chat:write`. If chat posting returns 401/403, reauthorise it. Do not paste tokens into logs. Outgoing chat is sent as the authorised VPZone bot identity; if the platform restricts that bot from posting to a linked broadcaster's channel, the dashboard will show the provider's error. Live cross-channel API permissions and message payload should be verified in a real channel before treating this as finished.
