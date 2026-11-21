import { e, h, card, grid, actions, btn, link, input } from '../core/dom.js';
import { notify, api } from '../core/api.js';

// Multi-chat OBS source and TTS settings.
export async function multichat() {
  const c = h('div', 'stack');
  const multiCard = card(
    'Multi-chat OBS browser source',
    'Read combined Twitch, Kick and VPZone chat in OBS without cross-posting. The private source URL acts as a secret, and browser speech synthesis can read messages aloud.'
  );
  const multi = await api('/api/multichat/settings').catch(() => ({
    configured: false,
    tts_enabled: false
  }));
  const speech = input('Enable browser TTS', multi.tts_enabled, 'checkbox');
  const ttsRate = input('TTS speaking rate (0.5 - 2)', multi.tts_rate ?? 1.08, 'number');
  const ttsVolume = input('TTS volume (0 - 1)', multi.tts_volume ?? 1, 'number');
  const ttsProvider = input('TTS provider', 'browser', 'select');
  for (const [id, name] of [
    ['browser', 'Free browser speech voices'],
    ['kokoro', 'Self-hosted Kokoro neural voices']
  ])
    ttsProvider.el.append(new Option(name, id));
  ttsProvider.el.value = multi.tts_provider || 'browser';
  const ttsVoice = input('Voice', '', 'select');
  const kokoroVoices = [
    ['af_heart', 'Heart - American female'],
    ['af_bella', 'Bella - American female'],
    ['af_nicole', 'Nicole - American female'],
    ['af_sarah', 'Sarah - American female'],
    ['af_sky', 'Sky - American female'],
    ['am_adam', 'Adam - American male'],
    ['am_michael', 'Michael - American male'],
    ['bf_alice', 'Alice - British female'],
    ['bf_emma', 'Emma - British female'],
    ['bf_isabella', 'Isabella - British female'],
    ['bf_lily', 'Lily - British female'],
    ['bm_daniel', 'Daniel - British male'],
    ['bm_fable', 'Fable - British male'],
    ['bm_george', 'George - British male'],
    ['bm_lewis', 'Lewis - British male']
  ];
  function updateTtsVoices() {
    const saved = ttsVoice.el.value || multi.tts_voice || '';
    ttsVoice.el.replaceChildren(new Option('System default / provider default', ''));
    if (ttsProvider.value() === 'kokoro') {
      for (const [id, name] of kokoroVoices) ttsVoice.el.add(new Option(name, id));
    } else {
      const available = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : [];
      for (const voice of available)
        ttsVoice.el.add(
          new Option(
            voice.name + ' (' + voice.lang + ')' + (voice.localService ? ' - local' : ''),
            voice.name
          )
        );
    }
    if ([...ttsVoice.el.options].some(o => o.value === saved)) ttsVoice.el.value = saved;
  }
  ttsProvider.el.addEventListener('change', () => {
    ttsVoice.el.value = '';
    updateTtsVoices();
  });
  if (typeof speechSynthesis !== 'undefined')
    speechSynthesis.addEventListener('voiceschanged', () => {
      if (ttsProvider.value() === 'browser') updateTtsVoices();
    });
  updateTtsVoices();
  const ttsPreview = btn('Preview selected voice', () => {
    if (ttsProvider.value() !== 'browser') {
      notify('Kokoro voice previews require a configured backend and active OBS source.');
      return;
    }
    if (!('speechSynthesis' in window)) {
      notify('Browser speech synthesis is unavailable here');
      return;
    }
    const sample = new SpeechSynthesisUtterance(
      'Hello! Your KitsuFlowBOT multi-chat voice is ready.'
    );
    sample.lang = ttsLang.value() || 'en-GB';
    sample.rate = Number(ttsRate.value()) || 1;
    sample.pitch = Number(ttsPitch.value()) || 1;
    const selected = speechSynthesis.getVoices().find(v => v.name === ttsVoice.value());
    if (selected) sample.voice = selected;
    speechSynthesis.cancel();
    speechSynthesis.speak(sample);
  });
  const ttsLang = input('Voice language (for example en-GB)', multi.tts_lang || 'en-GB');
  const ttsPitch = input('Pitch (0 - 2)', multi.tts_pitch ?? 1, 'number');
  const ttsMax = input(
    'Maximum TTS message characters (20 - 500)',
    multi.tts_max_length ?? 300,
    'number'
  );
  const ttsCooldown = input(
    'Per-viewer TTS cooldown in seconds',
    multi.tts_cooldown ?? 15,
    'number'
  );
  const ttsTemplate = input(
    'Spoken message template ({username}, {message}, {platform})',
    multi.tts_template || '{username} says {message}'
  );
  const ttsPlatforms = {};
  for (const p of ['twitch', 'kick', 'vpzone', 'nekolive', 'beam'])
    ttsPlatforms[p] = input(
      'Read ' + p.toUpperCase() + ' chat',
      multi.tts_platforms?.includes(p) ?? true,
      'checkbox'
    );
  const voicesHelp = e(
    'p',
    'Voices are listed based on the selected engine. Browser voices depend on those installed in this browser/OBS; Kokoro voices require KOKORO_TTS_URL. SleepyChat proprietary voice names are not guaranteed equivalents.',
    'description'
  );
  const sourceOut = e(
    'div',
    multi.configured
      ? 'Source configured. Regenerate to get a replacement URL.'
      : 'No browser source URL generated yet.',
    'description'
  );
  multiCard.append(
    grid(
      'cols2',
      speech.node,
      ttsProvider.node,
      ttsRate.node,
      ttsVolume.node,
      ttsVoice.node,
      ttsLang.node,
      ttsPitch.node,
      ttsMax.node,
      ttsCooldown.node,
      ttsTemplate.node,
      ...Object.values(ttsPlatforms).map(x => x.node)
    ),
    voicesHelp,
    actions(
      ttsPreview,
      btn(
        'Save TTS option',
        async () => {
          await api('/api/multichat/settings', 'POST', {
            tts_enabled: speech.value(),
            tts_provider: ttsProvider.value(),
            tts_rate: ttsRate.value(),
            tts_volume: ttsVolume.value(),
            tts_voice: ttsVoice.value(),
            tts_lang: ttsLang.value(),
            tts_pitch: Number(ttsPitch.value()),
            tts_max_length: Number(ttsMax.value()),
            tts_cooldown: Number(ttsCooldown.value()),
            tts_template: ttsTemplate.value(),
            tts_platforms: Object.keys(ttsPlatforms).filter(p => ttsPlatforms[p].value())
          });
          notify('Multi-chat TTS saved');
        },
        'primary'
      ),
      btn('Generate / rotate OBS URL', async () => {
        const x = await api('/api/multichat/source', 'POST', {});
        const url = location.origin + x.url;
        sourceOut.replaceChildren(
          e('span', 'Keep these OBS browser URLs private:'),
          h('div', 'list-row', e('span', 'Multi-chat'), link(url, url)),
          h(
            'div',
            'list-row',
            e('span', 'Game & title'),
            link(location.origin + x.game_url, location.origin + x.game_url)
          ),
          h(
            'div',
            'list-row',
            e('span', 'Activity Feed'),
            link(location.origin + x.activity_url, location.origin + x.activity_url)
          )
        );
        notify('OBS browser URL generated; copy it now');
      })
    ),
    sourceOut
  );
  c.append(multiCard);

  return c;
}
