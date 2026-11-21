import { e, h, card, grid, actions, btn, input, selector, table } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { access } from '../core/store.js';
import { reloadView } from '../core/router.js';

// Channel settings and team invitations.
export function channel() {
  const c = card('Channel configuration', 'Owner-only channel credentials and access');
  c.append(
    h('div', 'list-row', e('span', 'Account ID'), e('strong', access.account_id)),
    h('div', 'list-row', e('span', 'Your role'), e('strong', access.role))
  );
  if (access.role === 'owner') {
    c.append(
      actions(
        btn('Create API token (reports:read)', async () => {
          const x = await api('/api/access/tokens', 'POST', {
            scopes: ['reports:read'],
            days: 7
          });
          const out = e('textarea');
          out.className = 'key-block';
          out.value = x.token;
          out.readOnly = true;
          out.style.width = '100%';
          out.rows = 5;
          c.append(out);
          notify('Copy the token now; it will not be shown again');
        }),
        btn('Rotate overlay integration token', async () => {
          if (!confirm('Rotate overlay integration credential?')) return;
          const x = await api('/api/access/overlay-token/rotate', 'POST');
          const out = e('textarea');
          out.value = x.token;
          out.readOnly = true;
          out.rows = 4;
          out.className = 'key-block';
          out.style.width = '100%';
          c.append(out);
        })
      )
    );
  }
  return c;
}
export function team() {
  const c = card(
    'Team & invitation links',
    'Create an expiring, one-use invite. Recipients must log into Twitch before accepting it.'
  );
  if (access.role !== 'owner') {
    c.append(e('p', 'Only channel owners can manage invitations.', 'muted'));
    return c;
  }
  const r = selector(
      'Role',
      access.role === 'owner'
        ? ['editor', 'bot_supervisor', 'full_control']
        : ['editor', 'bot_supervisor'],
      'editor'
    ),
    days = input('Valid for days', 1, 'number');
  c.append(
    grid('cols2', r.node, days.node),
    actions(
      btn(
        'Generate invitation',
        async () => {
          const x = await api('/api/access/invite', 'POST', {
            role: r.value(),
            days: days.value()
          });
          const out = e('textarea');
          out.className = 'key-block';
          out.value = x.link;
          out.readOnly = true;
          out.rows = 3;
          out.style.width = '100%';
          c.append(out);
          notify('Copy your invitation URL');
        },
        'primary'
      )
    ),
    e('h3', 'Team members'),
    table(
      ['User ID', 'Role', 'Remove'],
      access.members.map(x => [
        x.user_id,
        x.role,
        btn(
          'Remove',
          async () => {
            await api('/api/access/members/' + x.user_id + '/remove', 'POST');
            await reloadView();
          },
          'danger'
        )
      ])
    )
  );
  return c;
}
