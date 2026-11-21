import { e, h, card, grid, actions, btn, link, input, selector, table } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { reloadView, show } from '../core/router.js';

const EVENT_LABELS = {
  follow: 'Follow',
  subscription: 'Subscription',
  subscription_renewal: 'Resub',
  subscription_gift: 'Gifted subs (amount = count)',
  cheer: 'Bits / Embers / NyaTreats (amount)',
  kicks: 'Kicks (amount)',
  donation: 'Donation (amount)',
  raid: 'Raid'
};

const gameLabel = (d, id) => d.games.find(g => g.id === id)?.label || id;

function actionEditor(d, action = {}, game = action.game || 'minecraft') {
  const isNew = !action.id;
  const info = d.games.find(g => g.id === game) || d.games[0];
  const pane = card(
    (isNew ? 'New action: ' : 'Edit: ' + action.name + ' — ') + info.label,
    info.help +
      ' Placeholders: {user} (viewer) and {amount} (Bits, gift count…). Server-admin commands are blocked.'
  );
  const presets = d.presets[game] || [];
  const preset = selector(
    'Start from a preset',
    [['', '— choose a preset —'], ...presets.map((p, i) => [String(i), p.name])],
    ''
  );
  preset.el.addEventListener('change', () => {
    const p = presets[Number(preset.value())];
    if (!p) return;
    editorSlotOf(pane).replaceChildren(actionEditor(d, { ...p, id: action.id }, game));
  });
  const name = input('Action name', action.name || 'Spawn a creeper');
  const trigger = selector(
    'Trigger',
    [
      ['command', 'Chat command'],
      ['event', 'Stream event']
    ],
    action.trigger_type || 'command'
  );
  const command = input('Chat command (without !)', action.command || 'creeper');
  const level = selector('Who can use the command', d.levels, action.level || 'everyone');
  const cost = input('Loyalty point cost (0 = free)', action.cost ?? 0, 'number');
  const platform = selector('Event platform', d.platforms, action.event_platform || 'any');
  const eventType = selector(
    'Event',
    d.event_types.map(t => [t, EVENT_LABELS[t] || t]),
    action.event_type || 'follow'
  );
  const minAmount = input(
    'Minimum amount (for Bits, gifts, donations)',
    action.min_amount ?? 0,
    'number'
  );
  const cooldown = input('Cooldown (seconds)', action.cooldown ?? 30, 'number');
  const commands = input(
    game === 'keys' ? 'Key steps' : 'Commands',
    action.commands ?? '',
    'textarea'
  );
  const replyText = input(
    'Chat reply when done (optional, {user} and {amount} work)',
    action.reply || ''
  );
  const enabled = input('Enabled', action.enabled !== false, 'checkbox');
  const commandFields = h('div', 'grid cols2', command.node, level.node, cost.node);
  const eventFields = h('div', 'grid cols2', platform.node, eventType.node, minAmount.node);
  const sync = () => {
    commandFields.hidden = trigger.value() !== 'command';
    eventFields.hidden = trigger.value() !== 'event';
  };
  trigger.el.addEventListener('change', sync);
  sync();
  pane.append(
    presets.length ? preset.node : '',
    grid('cols2', name.node, trigger.node, cooldown.node, enabled.node),
    commandFields,
    eventFields,
    commands.node,
    replyText.node,
    actions(
      btn(
        isNew ? 'Create action' : 'Save action',
        async () => {
          await api('/api/assistant/actions', 'POST', {
            id: action.id,
            game,
            name: name.value(),
            trigger_type: trigger.value(),
            command: command.value(),
            level: level.value(),
            cost: Number(cost.value()),
            event_platform: platform.value(),
            event_type: eventType.value(),
            min_amount: Number(minAmount.value()),
            cooldown: Number(cooldown.value()),
            commands: commands.value(),
            reply: replyText.value(),
            enabled: enabled.value()
          });
          notify('Action saved');
          await reloadView();
        },
        'primary'
      ),
      isNew ? null : btn('Cancel', () => reloadView())
    )
  );
  return pane;
}

const editorSlotOf = node => node.parentElement;

// KitsuFlowBOT Assistant: Beat Saber song requests and game actions.
export async function assistant() {
  const d = await api('/api/assistant');
  const root = h('div', 'stack');

  const status = card(
    'KitsuFlowBOT Assistant app',
    'The desktop app runs on your streaming PC: voice clips, Beat Saber song requests and game actions (Minecraft, ARK, other RCON games, key presses). Pair it once with a device key from Voice & Clips → Pair a PC.'
  );
  status.append(
    e(
      'p',
      d.online
        ? '● The Assistant app is connected.'
        : '○ The Assistant app is not connected. Start it on your PC to use song requests and game actions.',
      'description'
    ),
    actions(
      btn('Pair a PC', () => show('voice')),
      link('Download the app ↗', 'https://github.com/NekoSuneProjects/KitsuFlowBOT/releases')
    )
  );
  root.append(status);

  // Beat Saber
  const bsr = card(
    'Beat Saber song requests',
    'Viewers type !bsr <BeatSaver key> in Twitch chat (e.g. !bsr 25f). The Assistant app downloads the map into your PC Beat Saber CustomLevels folder and the bot confirms in chat.'
  );
  const bsrEnabled = input('Enable !bsr', d.bsr.enabled, 'checkbox');
  const bsrLevel = selector('Who can request', d.levels, d.bsr.level);
  const bsrCooldown = input('Cooldown per viewer (seconds)', d.bsr.user_cooldown, 'number');
  const bsrMax = input('Maximum songs waiting to install', d.bsr.max_queue, 'number');
  bsr.append(
    grid('cols2', bsrEnabled.node, bsrLevel.node, bsrCooldown.node, bsrMax.node),
    actions(
      btn(
        'Save song request settings',
        async () => {
          await api('/api/assistant/bsr', 'POST', {
            enabled: bsrEnabled.value(),
            level: bsrLevel.value(),
            user_cooldown: Number(bsrCooldown.value()),
            max_queue: Number(bsrMax.value())
          });
          notify('Song request settings saved');
          await reloadView();
        },
        'primary'
      )
    )
  );
  root.append(bsr);

  // Game actions
  const mc = card(
    'Game Interactive',
    'Chat commands (paid with channel points), stream events and tests run actions in your game: Minecraft, ARK and other RCON games through RCON, or key presses in any Windows game. Set up each game (address, password, your player name/ID, or the game window for key presses) in the Assistant app.'
  );
  const editorSlot = h('div', '');
  const rows = d.actions.map(a => [
    a.name + (a.enabled ? '' : ' (off)'),
    gameLabel(d, a.game || 'minecraft'),
    a.trigger_type === 'command'
      ? '!' + a.command + (a.cost ? ' · ' + a.cost + ' pts' : '') + ' · ' + a.level
      : (a.event_platform === 'any' ? 'any platform' : a.event_platform) +
        ' ' +
        (EVENT_LABELS[a.event_type] || a.event_type) +
        (a.min_amount ? ' ≥ ' + a.min_amount : ''),
    a.cooldown + 's',
    actions(
      btn('Test', async () => {
        await api('/api/assistant/actions/' + a.id + '/test', 'POST', {});
        notify('Test sent to the Assistant app');
        await reloadView();
      }),
      btn('Edit', () => {
        editorSlot.replaceChildren(actionEditor(d, a));
        editorSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }),
      btn(
        'Delete',
        async () => {
          if (!confirm('Delete ' + a.name + '?')) return;
          await api('/api/assistant/actions/' + a.id, 'DELETE');
          await reloadView();
        },
        'danger'
      )
    )
  ]);
  const newGame = selector(
    'Game for a new action',
    d.games.map(g => [g.id, g.label]),
    'minecraft'
  );
  mc.append(
    table(['Action', 'Game', 'Trigger', 'Cooldown', ''], rows),
    newGame.node,
    actions(
      btn(
        'New action',
        () => {
          const g = newGame.value();
          editorSlot.replaceChildren(actionEditor(d, { ...(d.presets[g]?.[0] || {}) }, g));
          editorSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        },
        'primary'
      )
    ),
    editorSlot
  );
  root.append(mc);

  // Job history
  const history = card(
    'Recent requests and actions',
    'Points are refunded automatically when an action fails or the app does not pick it up within 10 minutes.'
  );
  history.append(
    table(
      ['When', 'Type', 'Item', 'By', 'Status', ''],
      d.jobs.map(j => [
        new Date(j.created).toLocaleString(),
        j.kind === 'bsr' ? 'Beat Saber' : gameLabel(d, j.game),
        j.title,
        j.requester || '—',
        j.status + (j.result ? ' — ' + j.result : ''),
        ['pending', 'delivered'].includes(j.status)
          ? btn('Cancel', async () => {
              await api('/api/assistant/jobs/' + j.id + '/cancel', 'POST', {});
              await reloadView();
            })
          : ''
      ])
    )
  );
  root.append(history);
  return root;
}
