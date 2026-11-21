import { e, h, card, grid, actions, btn, link, input, table } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { access } from '../core/store.js';
import { reloadView } from '../core/router.js';

// Voice & Clips: chat !clip, server voice worker and the desktop companion.
export async function voice() {
  const alpha = card(
    'Desktop companion — Alpha / Work in progress',
    'The Desktop app is in Alpha. Please expect issues and bugs, and report problems on GitHub Issues.'
  );
  alpha.append(
    actions(
      link(
        'Report an issue on GitHub ↗',
        'https://github.com/NekoSuneProjects/KitsuFlowBOT/issues/new'
      )
    )
  );

  const voiceData = await api('/api/voice');
  const s = voiceData.settings;
  const v = card(
    'Server-side voice detection — Twitch, Kick & VPZone',
    'Works in Firefox because transcription runs inside Docker, not the browser. Only enabled, live channels are processed.'
  );
  const enabled = input('Enable live audio recognition', Boolean(s.enabled), 'checkbox');
  const phrase = input('Trigger phrase', s.phrase);
  const cooldown = input('Clip cooldown (seconds)', s.cooldown, 'number');
  const status = e(
    'div',
    voiceData.workerConfigured
      ? 'Voice worker secret configured'
      : 'Voice worker is not configured. Set VOICE_WORKER_SECRET and start the Docker voice profile.',
    'description'
  );
  v.append(
    grid('cols2', enabled.node, phrase.node, cooldown.node),
    status,
    actions(
      btn(
        'Save server voice settings',
        async () => {
          await api('/api/voice', 'POST', {
            enabled: enabled.value(),
            phrase: phrase.value(),
            cooldown: cooldown.value()
          });
          notify('Voice settings updated');
          await reloadView();
        },
        'primary'
      ),
      btn(
        'Disable listening',
        async () => {
          await api('/api/voice', 'POST', {
            enabled: false,
            phrase: phrase.value(),
            cooldown: cooldown.value()
          });
          notify('Server voice detection disabled');
          await reloadView();
        },
        'danger'
      ),
      btn('Create clip now', async () => {
        const x = await api('/api/clip', 'POST');
        notify('Clip created: ' + x.id);
      })
    )
  );
  const history = card('Recent voice clips', 'Results of phrases detected from stream audio.');
  history.append(
    table(
      ['When', 'Phrase', 'Clip'],
      voiceData.events.map(x => [x.created, x.phrase, x.clip_id || 'Failed'])
    )
  );
  const clipData = await api('/api/clip/settings');
  const cs = clipData.settings;
  const chatClip = card(
    'Chat !clip command',
    'Viewers type !clip in Twitch chat to clip the last 60 seconds. The bot checks the stream is live, applies a shared cooldown and posts the clip link.'
  );
  const clipEnabled = input('Enable !clip in chat', cs.enabled, 'checkbox');
  const clipLevel = input('Who can use !clip', '', 'select');
  for (const level of clipData.levels) {
    const o = e(
      'option',
      level === 'everyone'
        ? 'Everyone'
        : level === 'vip'
          ? 'VIPs + mods'
          : level === 'subscriber'
            ? 'Subscribers, VIPs + mods'
            : 'Moderators only'
    );
    o.value = level;
    clipLevel.el.append(o);
  }
  clipLevel.el.value = cs.level;
  const clipCooldown = input('Cooldown between clips (seconds)', cs.cooldown, 'number');
  chatClip.append(
    grid('cols2', clipEnabled.node, clipLevel.node, clipCooldown.node),
    actions(
      btn(
        'Save !clip settings',
        async () => {
          await api('/api/clip/settings', 'POST', {
            enabled: clipEnabled.value(),
            level: clipLevel.value(),
            cooldown: clipCooldown.value()
          });
          notify('!clip settings saved');
          await reloadView();
        },
        'primary'
      )
    )
  );
  const clipHistory = card('Recent chat clips', 'Clips requested with !clip in chat.');
  clipHistory.append(
    table(
      ['When', 'Viewer', 'Result', 'Clip / details'],
      clipData.events.map(x => [
        x.created,
        x.user_login,
        x.status,
        x.clip_id ? 'https://clips.twitch.tv/' + x.clip_id : x.detail
      ])
    )
  );
  const extra = await api('/api/voice/platforms');
  const platformCard = card(
    'Kick & VPZone voice detection',
    'Use the server audio worker on linked streams. Voice phrases are logged, but these platforms do not currently offer a supported public clip creation API.'
  );
  for (const platform of ['kick', 'vpzone']) {
    const cfg = extra.settings.find(x => x.platform === platform);
    const enabled = input(
      'Enable ' + (platform === 'kick' ? 'Kick' : 'VPZone') + ' listening',
      Boolean(cfg.enabled),
      'checkbox'
    );
    const phrase = input('Trigger phrase', cfg.phrase);
    const cooldown = input('Cooldown in seconds', cfg.cooldown, 'number');
    platformCard.append(
      e('h3', platform === 'kick' ? 'Kick live stream' : 'VPZone live stream'),
      grid('cols2', enabled.node, phrase.node, cooldown.node),
      actions(
        btn(
          'Save ' + platform + ' voice settings',
          async () => {
            await api('/api/voice/platforms/' + platform, 'POST', {
              enabled: enabled.value(),
              phrase: phrase.value(),
              cooldown: cooldown.value()
            });
            notify(platform + ' voice settings updated');
            await reloadView();
          },
          'primary'
        )
      )
    );
  }
  const triggerLog = card(
    'Other platform voice triggers',
    'Recognition is recorded even when no supported native clip creation API exists.'
  );
  triggerLog.append(
    table(
      ['Platform', 'Phrase', 'Result', 'When'],
      extra.history.map(x => [x.platform, x.phrase, x.result, x.created])
    )
  );
  const desktop = card(
    'KitsuFlowBOT Assistant (desktop app)',
    'Your PC listens to its microphone locally, then securely asks this dashboard to clip supported live platforms. No OBS required.'
  );
  if (access.role === 'owner') {
    const companion = await api('/api/voice-companion');
    const cfg = companion.settings;
    const phraseLocal = input('Voice trigger', cfg.phrase);
    const cooldownLocal = input('Cooldown (seconds)', cfg.cooldown, 'number');
    const routing = input('Live platform routing', cfg.routing, 'select');
    for (const [id, label] of [
      ['all', 'All selected platforms'],
      ['first', 'First successful native clip']
    ]) {
      const item = e('option', label);
      item.value = id;
      routing.el.append(item);
    }
    routing.el.value = cfg.routing;
    const picks = {};
    for (const platform of ['twitch', 'kick', 'vpzone'])
      picks[platform] = input(
        platform.toUpperCase() +
          ' (native clip API ' +
          (platform === 'twitch' ? 'supported' : 'unavailable') +
          ')',
        cfg.platforms.includes(platform),
        'checkbox'
      );
    desktop.append(
      grid(
        'cols2',
        phraseLocal.node,
        cooldownLocal.node,
        routing.node,
        ...Object.values(picks).map(p => p.node)
      ),
      actions(
        btn(
          'Save companion settings',
          async () => {
            await api('/api/voice-companion/settings', 'POST', {
              phrase: phraseLocal.value(),
              routing: routing.value(),
              cooldown: cooldownLocal.value(),
              platforms: Object.keys(picks).filter(p => picks[p].value())
            });
            notify('Desktop companion settings saved');
            await reloadView();
          },
          'primary'
        )
      )
    );
    const keyOutput = e('div', '', 'description');
    desktop.append(
      actions(
        btn(
          'Pair a PC',
          async () => {
            const x = await api('/api/voice-companion/devices', 'POST', { label: 'My PC' });
            keyOutput.replaceChildren(
              e('strong', 'One-time device key (copy now):'),
              e('code', x.key)
            );
            notify('Pairing key created. Keep it private; it is shown only once.');
          },
          'primary'
        )
      ),
      keyOutput
    );
    desktop.append(e('h3', 'Paired computers'));
    if (!companion.devices.length)
      desktop.append(e('p', 'No computers paired yet.', 'description'));
    for (const device of companion.devices)
      desktop.append(
        h(
          'div',
          'list-row',
          e('span', device.label + ' · ' + (device.last_seen || 'Never connected')),
          btn(
            'Revoke',
            async () => {
              await api('/api/voice-companion/devices/' + device.id + '/revoke', 'POST', {});
              await reloadView();
            },
            'danger'
          )
        )
      );
    const desktopHistory = card(
      'Desktop clip results',
      'Twitch creates native clips when live. Kick and VPZone report unsupported, rather than claiming a clip exists.'
    );
    desktopHistory.append(
      table(
        ['When', 'Platform', 'Result', 'Details'],
        companion.history.map(x => [x.created, x.platform, x.status, x.clip_id || x.detail])
      )
    );
    desktop.append(
      e(
        'p',
        'Download the KitsuFlowBOT Assistant for Windows/Linux from GitHub Releases (desktopapp branch). It also runs Beat Saber requests and Minecraft Interactive: see Assistant App. Speech models download inside the app; no Python install needed.',
        'description'
      )
    );
    return h(
      'div',
      'stack',
      alpha,
      desktop,
      desktopHistory,
      chatClip,
      clipHistory,
      v,
      history,
      platformCard,
      triggerLog
    );
  }
  return h('div', 'stack', alpha, chatClip, clipHistory, v, history, platformCard, triggerLog);
}
