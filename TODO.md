# TODO — BEAM integration for KitsuFlowBOT

> Status: Planned. This checklist is an implementation plan, not a claim that BEAM support is already working.
>
> References: [BEAM OpenAPI](https://developers.beamstream.gg/openapi.json) · [KitsuFlowBOT](https://github.com/NekoSuneProjects/KitsuFlowBOT)

## P0 — API validation and architecture

- [ ] Audit existing `src/platforms/`, `src/twitch/`, `src/features/`, `src/commands/`, and Studio platform settings to identify reusable interfaces.
- [ ] Build a BEAM endpoint/event/scope compatibility matrix directly from the latest OpenAPI schema; record payload samples and unsupported features.
- [ ] Confirm BEAM app registration, OAuth authorization-code flow, refresh/revocation behavior, and channel-owner consent requirements.
- [ ] Decide how to represent BEAM channel IDs, user IDs, bot identity, room IDs, and cross-platform identities without collisions.
- [ ] Define a platform-neutral event envelope (`platform`, `channelId`, `eventId`, `type`, `occurredAt`, `actor`, `payload`).
- [ ] Add feature flags so existing Twitch/Kick/other platforms continue to work unchanged.

## P1 — BEAM connection and authentication

- [ ] Add a BEAM adapter/module under `src/platforms/` consistent with current project conventions.
- [ ] Add BEAM client configuration and environment variables to `.env.example`; never commit secrets.
- [ ] Implement streamer OAuth connect, callback, encrypted token storage, refresh, disconnect, and scope validation.
- [ ] Determine whether a shared bot account or per-channel authorization is required for each action.
- [ ] Add BEAM connection status and enable/disable controls to Studio.
- [ ] Enforce channel-scoped authorization and prevent one broadcaster from accessing another's data.

## P1 — Events and stream lifecycle

- [ ] Implement BEAM real-time event transport using supported selectors/SSE or webhooks as appropriate.
- [ ] Subscribe to and normalize follow events (`channel.follow.created`).
- [ ] Subscribe to and normalize live/offline events (`stream.started`, `stream.ended`).
- [ ] Investigate and normalize raid events (`channel.raid.created`), including source/target semantics.
- [ ] Map subscription, gift-subscription, tips/Embers, paid-message, and reward-redemption events from the actual `support.*` schema.
- [ ] Map moderation and chat events, including deletes, timeouts, bans, and pins where available.
- [ ] Persist event IDs for deduplication; handle retries, out-of-order events, reconnections, and missed-event recovery.
- [ ] On startup/reconnect, query channel live status (check `/v1/channels/{id}/streams?status=live`) to reconcile state without duplicate go-live alerts.
- [ ] Verify webhook signatures/authenticity, replay windows, selector ownership, delivery retries, and any platform limits against documentation.

## P1 — Chatbot and commands

- [ ] Resolve chat room IDs and connect incoming BEAM messages to KitsuFlowBOT's shared command dispatcher.
- [ ] Implement read/send chat with the documented chat endpoints and appropriate OAuth scopes (`chat:read`, `chat:write`, `chat:bot` as applicable).
- [ ] Support command permissions, cooldowns, prefixes, bot/self-message filtering, and per-channel settings.
- [ ] Adapt `!uptime`, `!title`, `!game`, `!viewers`, `!followers`, `!followage`, and `!subcount` only where BEAM exposes the necessary data; show a graceful unavailable response otherwise.
- [ ] Reuse platform-independent fun commands, points, games, loyalty, giveaways, timers, and Pokémon features.
- [ ] Map moderation actions (`!timeout`, `!ban`, `!permit`) only after verifying BEAM scopes and endpoints.
- [ ] Verify stream-title/category updates, clips (`!clip` and voice clipping), and other platform-specific commands separately; do not assume Twitch API parity.

## P2 — Alerts, overlays, and Studio

- [ ] Route normalized BEAM follow/raid/sub/gift/tip/live/offline events through existing activity-feed and alert pipelines.
- [ ] Add BEAM event filters, alert templates, and per-channel enable/disable settings.
- [ ] Reuse OBS browser-source overlays, goals, stream boss, subathon, and multi-chat where event payloads allow.
- [ ] Add BEAM to Studio platform connection, account status, chat, alert test, and error-reporting views.
- [ ] Define loyalty/watch-time tracking rules for BEAM users and avoid accidental cross-platform account merges.
- [ ] Add optional Discord go-live notifications with duplicate suppression and configurable destinations.

## P2 — Reliability, security, and observability

- [ ] Implement backoff with jitter, connection health checks, token-refresh retries, and rate-limit handling (`429`, `Retry-After`).
- [ ] Log event processing failures without exposing tokens or private chat data.
- [ ] Add metrics for event latency, missed events, API errors, selector/webhook health, and chat-send failures.
- [ ] Validate event payloads, sanitize user-controlled text, and protect webhooks from replay attacks.
- [ ] Document BEAM platform limits and scaling approach for multiple broadcaster channels.

## P3 — Testing and release

- [ ] Unit-test OAuth/token handling, event normalization, deduplication, and command dispatch.
- [ ] Add fixture-based tests for follow, live/offline, raid, subscription, gifts, tips, chat, and moderation payloads.
- [ ] Integration-test BEAM authorization and permissions with a real test channel.
- [ ] Verify chat reads/writes, live alerts, disconnect/reconnect, stream-end handling, and duplicate suppression end-to-end.
- [ ] Regression-test Twitch, Kick, VPZone, NekoLive, TikTok, Studio, and existing overlays.
- [ ] Run `npm run check`, `npm run format`, and applicable CI checks.
- [ ] Update README with BEAM setup, OAuth redirect configuration, supported features, and known limitations.
- [ ] Roll out behind a feature flag to one test channel before enabling broadly.

## Open questions / not yet verified

- [ ] Exact BEAM event names and payloads for each `support.*` event.
- [ ] Whether follow/raid/subscription events require individual channel-owner grants.
- [ ] Whether BEAM provides Twitch-equivalent clips, channel points, watch-time, follower age, and stream editing.
- [ ] Whether BEAM has bot-specific chat rate limits or multi-channel selector limits that affect a shared bot.
- [ ] Whether historical event replay is available after downtime.

## Definition of done

- [ ] A streamer can connect/disconnect BEAM safely from Studio.
- [ ] The bot can read and send messages and run shared commands in authorized BEAM channels.
- [ ] Follow, go-live, offline, raid, and supported monetization events trigger the correct alerts exactly once.
- [ ] Existing KitsuFlowBOT integrations continue functioning.
- [ ] Unsupported features fail gracefully and are documented.
- [ ] Automated tests, monitoring, security checks, and setup documentation are complete.
