import { e, h, card, grid, actions, btn, link, input, selector, table } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { reloadView } from '../core/router.js';

const PROVIDER_LABELS = {
  none: 'No GIF API (use my GIF link)',
  'nekos:pat': 'nekos.life — pat',
  'nekos:hug': 'nekos.life — hug',
  'nekos:cuddle': 'nekos.life — cuddle',
  'nekos:slap': 'nekos.life — slap',
  'nekos:feed': 'nekos.life — feed',
  'nekos:kiss': 'nekos.life — kiss',
  'nekos:poke': 'nekos.life — poke',
  'nekos:tickle': 'nekos.life — tickle',
  'nekosune:boop': 'NekoSuneVR API — boop'
};
const SOUND_LABELS = {
  streamer: 'Only when the target is the streamer',
  always: 'Every time',
  never: 'Never'
};

function urlField(label, path) {
  const url = location.origin + path,
    field = input(label, url);
  field.el.readOnly = true;
  return h(
    'div',
    'stack',
    field.node,
    actions(
      btn('Copy URL', () => navigator.clipboard.writeText(url)),
      link('Open', url)
    )
  );
}

function overlayEditor(d, a = {}) {
  const isNew = !a.id;
  const pane = card(
    isNew ? 'New overlay action' : 'Edit: !' + a.command,
    'Viewers type !command @someone. {target} is who they named, {user} is the viewer. The GIF comes from the chosen API; your GIF link is used when the API is off or fails.'
  );
  const command = input('Command (without !)', a.command || 'bonk');
  const aliases = input('Aliases (comma separated)', a.aliases || '');
  const provider = selector(
    'GIF source',
    d.providers.map(p => [p, PROVIDER_LABELS[p] || p]),
    a.provider || 'none'
  );
  const gif = input('My GIF link (https://, optional)', a.gif_url || '');
  const sound = input('Sound link (https:// mp3/ogg, optional)', a.sound_url || '');
  const soundMode = selector(
    'Play the sound',
    d.sound_modes.map(m => [m, SOUND_LABELS[m] || m]),
    a.sound_mode || 'streamer'
  );
  const text = input('Overlay text', a.text || '{target}, you just got bonked by @{user}');
  const level = selector('Who can use it', d.levels, a.level || 'everyone');
  const cost = input('Point cost (0 = free)', a.cost ?? 0, 'number');
  const cooldown = input('Cooldown per viewer (seconds)', a.cooldown ?? 10, 'number');
  const enabled = input('Enabled', a.enabled !== false, 'checkbox');
  pane.append(
    grid(
      'cols2',
      command.node,
      aliases.node,
      provider.node,
      gif.node,
      sound.node,
      soundMode.node,
      level.node,
      cost.node,
      cooldown.node,
      enabled.node
    ),
    text.node,
    actions(
      btn(
        isNew ? 'Create overlay action' : 'Save overlay action',
        async () => {
          await api('/api/interactive/actions', 'POST', {
            id: a.id,
            command: command.value(),
            aliases: aliases.value(),
            provider: provider.value(),
            gif_url: gif.value(),
            sound_url: sound.value(),
            sound_mode: soundMode.value(),
            text: text.value(),
            level: level.value(),
            cost: Number(cost.value()),
            cooldown: Number(cooldown.value()),
            enabled: enabled.value()
          });
          notify('Overlay action saved');
          await reloadView();
        },
        'primary'
      ),
      isNew ? null : btn('Cancel', () => reloadView())
    )
  );
  return pane;
}

// Twitch Interactive: viewer overlay actions and Chat Plays (NES/GBA in the browser).
export async function interactive() {
  const d = await api('/api/interactive');
  const s = d.settings;
  const root = h('div', 'stack');

  // Overlay actions
  const overlay = card(
    'Viewer overlay actions',
    'Viewers can !slap, !boop, !pat (and more) someone, and a GIF with text pops up on your stream. Add the overlay URL as an OBS Browser Source (1920×1080). Actions only fire while the overlay is open in OBS, so nobody is charged for an overlay you are not showing.'
  );
  const overlayOn = input('Overlay actions enabled', s.overlay_enabled, 'checkbox');
  const volume = input('Sound volume (0–1)', s.volume, 'number');
  const duration = input('Show each action for (ms)', s.duration_ms, 'number');
  const editorSlot = h('div', '');
  overlay.append(
    urlField('Overlay browser source', d.overlay_url),
    grid('cols2', overlayOn.node, volume.node, duration.node),
    table(
      ['Command', 'GIF', 'Sound', 'Cost', ''],
      d.actions.map(a => [
        '!' +
          a.command +
          (a.aliases ? ' (' + a.aliases.replaceAll(',', ', ') + ')' : '') +
          (a.enabled ? '' : ' (off)'),
        a.provider !== 'none'
          ? PROVIDER_LABELS[a.provider] || a.provider
          : a.gif_url
            ? 'my GIF'
            : '—',
        a.sound_url ? SOUND_LABELS[a.sound_mode] : '—',
        a.cost ? a.cost + ' pts' : 'free',
        actions(
          btn('Test', async () => {
            await api('/api/interactive/actions/' + a.id + '/test', 'POST', {});
            notify('Sent to the overlay');
          }),
          btn('Edit', () => {
            editorSlot.replaceChildren(overlayEditor(d, a));
            editorSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }),
          btn(
            'Delete',
            async () => {
              if (!confirm('Delete !' + a.command + '?')) return;
              await api('/api/interactive/actions/' + a.id, 'DELETE');
              await reloadView();
            },
            'danger'
          )
        )
      ])
    ),
    actions(
      btn('New overlay action', () => {
        editorSlot.replaceChildren(overlayEditor(d));
        editorSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      })
    ),
    editorSlot
  );
  root.append(overlay);

  // Chat Plays
  const plays = card(
    'Chat Plays (NES / GBA)',
    'Chat controls a game running in your browser. Open the Chat Plays page (or add it to OBS as a Browser Source and use Interact), then choose a ROM you own. The ROM stays on your PC; KitsuFlowBOT only sends button presses. Viewers type up, down, left, right, a, b, start, select (GBA also has l and r), optionally with a count like up3.'
  );
  const playsOn = input('Chat Plays enabled', s.chatplays_enabled, 'checkbox');
  const system = selector(
    'System',
    d.systems.map(x => [x, x === 'nes' ? 'NES' : 'Game Boy Advance']),
    s.system
  );
  const mode = selector(
    'Mode',
    [
      ['anarchy', 'Anarchy — every input is pressed'],
      ['democracy', 'Democracy — the most-voted input wins each round']
    ],
    s.mode
  );
  const voteSeconds = input('Democracy round length (seconds)', s.vote_seconds, 'number');
  const gap = input(
    'Anarchy: minimum time between one viewer’s inputs (ms)',
    s.user_gap_ms,
    'number'
  );
  const maxRepeat = input('Highest repeat count (e.g. up9)', s.max_repeat, 'number');
  const allowStart = input(
    'Viewers can press start/select (mods always can)',
    s.allow_start,
    'checkbox'
  );
  plays.append(
    urlField('Chat Plays page', d.chatplays_url),
    grid(
      'cols2',
      playsOn.node,
      system.node,
      mode.node,
      voteSeconds.node,
      gap.node,
      maxRepeat.node,
      allowStart.node
    ),
    e('p', 'Test buttons send a press to the open Chat Plays page:', 'description'),
    actions(
      ...['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select', 'l', 'r'].map(b =>
        btn(b.toUpperCase(), async () => {
          await api('/api/interactive/chatplays/test', 'POST', { button: b });
        })
      )
    )
  );
  root.append(plays);

  const save = card('Save', 'Saves the overlay and Chat Plays settings above.');
  save.append(
    actions(
      btn(
        'Save interactive settings',
        async () => {
          await api('/api/interactive/settings', 'POST', {
            overlay_enabled: overlayOn.value(),
            volume: Number(volume.value()),
            duration_ms: Number(duration.value()),
            chatplays_enabled: playsOn.value(),
            system: system.value(),
            mode: mode.value(),
            vote_seconds: Number(voteSeconds.value()),
            user_gap_ms: Number(gap.value()),
            max_repeat: Number(maxRepeat.value()),
            allow_start: allowStart.value()
          });
          notify('Interactive settings saved');
          await reloadView();
        },
        'primary'
      ),
      btn(
        'New secret URLs',
        async () => {
          if (!confirm('Make new overlay and Chat Plays URLs? The old ones stop working.')) return;
          await api('/api/interactive/regenerate', 'POST', {});
          await reloadView();
        },
        'danger'
      )
    )
  );
  root.append(save);
  return root;
}
