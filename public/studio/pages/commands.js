import {
  $,
  e,
  h,
  card,
  grid,
  actions,
  btn,
  input,
  selector,
  form,
  table,
  editorSlot
} from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { state, access } from '../core/store.js';
import { reloadView } from '../core/router.js';

// Custom commands, global bot commands and supermods.
function editCommand(item) {
  const pane = card(
    'Edit !' + item.name,
    'Update the response, permission and cooldown without deleting the command.'
  );
  const response = input('Bot response', item.response, 'textarea');
  const cooldown = input('Cooldown (seconds)', item.cooldown, 'number');
  const level = selector('Permission', ['everyone', 'subscriber', 'moderator'], item.level);
  pane.append(
    grid('cols2', response.node, cooldown.node, level.node),
    actions(
      btn(
        'Save changes',
        async () => {
          await api('/api/commands', 'POST', {
            name: item.name,
            response: response.value(),
            cooldown: cooldown.value(),
            level: level.value()
          });
          notify('Command updated');
          await reloadView();
        },
        'primary'
      ),
      btn('Cancel', () => reloadView())
    )
  );
  return pane;
}
async function globalCommandsPanel() {
  const data = await api('/api/commands/global');
  const panel = card(
    'Global bot commands',
    'Choose which built-in commands viewers can use. Supermods are explicitly assigned by the channel owner.'
  );
  const rows = data.commands.map(cmd => {
    const enabled = input('Enable !' + cmd.name, Boolean(cmd.enabled), 'checkbox');
    return h(
      'div',
      'kf-result',
      h(
        'div',
        '',
        e('strong', '!' + cmd.name),
        e('div', cmd.description + ' · ' + cmd.level, 'description')
      ),
      enabled.node,
      actions(
        btn(
          'Save',
          async () => {
            await api('/api/commands/global', 'POST', {
              name: cmd.name,
              enabled: enabled.value()
            });
            notify('Global command preference saved');
          },
          'primary'
        )
      )
    );
  });
  panel.append(...rows);
  const modPanel = card(
    'Supermods',
    'Only the channel owner and assigned supermods may use sensitive !settitle, !setgame, !setpoints and !addpoints commands. Regular Twitch moderators can use !so.'
  );
  const name = input('Twitch username to grant supermod access');
  modPanel.append(
    name.node,
    actions(
      btn(
        'Add supermod',
        async () => {
          await api('/api/commands/supermod', 'POST', { login: name.value(), enabled: true });
          notify('Supermod added');
          await reloadView();
        },
        'primary'
      )
    )
  );
  for (const mod of data.supermods)
    modPanel.append(
      h(
        'div',
        'kf-result',
        e('strong', '@' + mod.login),
        actions(
          btn(
            'Remove',
            async () => {
              if (!confirm('Remove supermod @' + mod.login + '?')) return;
              await api('/api/commands/supermod', 'POST', { login: mod.login, enabled: false });
              await reloadView();
            },
            'danger'
          )
        )
      )
    );
  return access.role === 'owner' ? h('div', 'stack', panel, modPanel) : h('div', 'stack', panel);
}
export async function commands() {
  const globals = await globalCommandsPanel();
  const records = state.commands.map(x => [
    '!' + x.name,
    x.response,
    x.level,
    actions(
      btn('Edit', () => {
        const target = $('#command-editor');
        target.replaceChildren(editCommand(x));
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }),
      btn(
        'Delete',
        async () => {
          if (!confirm('Delete !' + x.name + '?')) return;
          await api('/api/commands/' + encodeURIComponent(x.name), 'DELETE');
          await reloadView();
        },
        'danger'
      )
    )
  ]);
  return h(
    'div',
    'stack',
    h(
      'div',
      'grid cols2',
      form(
        'Create custom command',
        [
          ['name', 'Command name (! without prefix)'],
          ['response', 'Bot response'],
          ['cooldown', 'Cooldown in seconds', 'number', 10],
          ['level', 'Permission', 'options', ['everyone', 'subscriber', 'moderator']]
        ],
        'Save command',
        x => api('/api/commands', 'POST', x)
      ),
      h(
        'section',
        'card',
        e('h2', 'Saved commands'),
        table(['Command', 'Response', 'Level', 'Actions'], records)
      )
    ),
    editorSlot('command-editor'),
    globals
  );
}
