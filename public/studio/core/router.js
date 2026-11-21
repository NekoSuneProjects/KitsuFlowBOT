import { overview, reports } from '../pages/overview.js';
import { activity } from '../pages/activity.js';
import { commands } from '../pages/commands.js';
import { timers } from '../pages/timers.js';
import { moderation } from '../pages/moderation.js';
import { pokemon } from '../pages/pokemon.js';
import { voice } from '../pages/voice.js';
import { loyalty, campaigns, store, queue, quotes } from '../pages/community.js';
import { overlays } from '../pages/overlays.js';
import { subathon } from '../pages/subathon.js';
import { streamboss } from '../pages/stream-boss.js';
import { support } from '../pages/support.js';
import { goals } from '../pages/goals.js';
import { connections } from '../pages/connections.js';
import { metadata } from '../pages/metadata.js';
import { multichat } from '../pages/multichat.js';
import { relay } from '../pages/relay.js';
import { channel, team } from '../pages/settings.js';
import { admin } from '../pages/admin.js';
import { $, e, h } from './dom.js';
import { notify, api, error } from './api.js';
import { state, access, page, setStudioData, setPage } from './store.js';

// Sidebar navigation, page registry and page switching.
export const groups = [
  [
    'WORKSPACE',
    [
      ['overview', '◫', 'Overview'],
      ['activity', '◷', 'Activity Feed'],
      ['reports', '▥', 'Data & Reports'],
      ['goals', '◎', 'Creator Goals']
    ]
  ],
  [
    'BOT MANAGEMENT',
    [
      ['commands', '⌘', 'Custom Commands'],
      ['timers', '◴', 'Timers'],
      ['moderation', '◇', 'Moderation'],
      ['voice', '◉', 'Voice & Clips']
    ]
  ],
  [
    'COMMUNITY',
    [
      ['loyalty', '✧', 'Loyalty & Points'],
      ['campaigns', '♢', 'Giveaways & Contests'],
      ['store', '▣', 'Stream Store'],
      ['queue', '☷', 'Viewer Queue'],
      ['quotes', '❞', 'Quotes & Counters'],
      ['pokemon', '◓', 'Pokémon Game']
    ]
  ],
  [
    'STREAM TOOLS',
    [
      ['overlays', '▤', 'Overlay Studio'],
      ['metadata', '✦', 'Stream Title & Game'],
      ['multichat', '▣', 'Multi-chat & TTS'],
      ['relay', '⇄', 'Chat Relay'],
      ['subathon', '⏳', 'Subathon Timer'],
      ['streamboss', '⚔', 'Stream Boss'],
      ['support', '♡', 'Alerts & Donations'],
      ['connections', '⇄', 'Connections']
    ]
  ],
  [
    'SETTINGS',
    [
      ['channel', '⚙', 'Channel Settings'],
      ['team', '♙', 'Team & Invites'],
      ['admin', '♛', 'Admin Panel']
    ]
  ]
];
export const ownerPages = new Set([
  'connections',
  'team',
  'channel',
  'overlays',
  'subathon',
  'streamboss',
  'support',
  'goals',
  'metadata',
  'multichat',
  'relay'
]);
export const descriptions = {
  overview: 'A clear view of everything happening across your channel.',
  activity: 'Recent messages, moderation and bot activity.',
  reports: 'Understand loyalty activity, redemptions and channel engagement.',
  commands: 'Create and manage the commands your viewers can use.',
  timers: 'Schedule automatic Twitch chat announcements.',
  moderation: 'Keep your community safe with moderation controls.',
  voice: 'Create clips with your voice or a single click.',
  loyalty: 'Configure loyalty rewards and view community standings.',
  campaigns: 'Run community giveaways and draw winners.',
  store: 'Manage redeemable loyalty-point rewards.',
  queue: 'Organise who plays or joins you next.',
  quotes: 'Capture favourite moments and manage counters.',
  pokemon: 'Wild spawns, PokéShop, Pokédex and raids for your chat.',
  overlays: 'Create OBS browser sources for your stream.',
  subathon: 'Run a cross-platform subathon with automatic time rewards and a custom OBS countdown.',
  streamboss: 'Customisable standalone Stream Boss with health, event damage and an OBS overlay.',
  support: 'Configure OBS alerts, donation services, and verified membership webhooks.',
  goals: 'Create custom targets and track progress automatically.',
  metadata: 'Set stream titles and game categories, with AI suggestions.',
  multichat: 'Manage OBS multi-chat and TTS.',
  relay: 'Manage cross-platform relay and diagnostics.',
  connections: 'View broadcaster and shared public bot status.',
  channel: 'Manage your own channel and security credentials.',
  team: 'Invite editors and trusted moderators.',
  admin: 'Configure and monitor the public bot for all channels.'
};
export async function load() {
  try {
    setStudioData({
      state: await api('/api/state'),
      access: await api('/api/access'),
      creator: await api('/api/creator'),
      engagement: await api('/api/engagement')
    });
    $('#shell').hidden = false;
    $('#login').hidden = true;
    buildNav();
    updateChrome();
    buildNav();
    await show(page);
  } catch (ex) {
    if (ex.message === 'Login required') {
      location.replace('/login');
      return;
    } else {
      $('#shell').hidden = false;
      notify(ex.message);
    }
  }
}
export async function reloadView() {
  setStudioData({
    state: await api('/api/state'),
    access: await api('/api/access'),
    creator: await api('/api/creator'),
    engagement: await api('/api/engagement')
  });
  updateChrome();
  await show(page);
}
export function buildNav() {
  const nav = $('#nav');
  nav.replaceChildren();
  for (const [heading, items] of groups) {
    const visible = items.filter(
      ([id]) =>
        (id !== 'admin' || state.isOperator) && (!ownerPages.has(id) || access.role === 'owner')
    );
    if (!visible.length) continue;
    nav.append(e('div', heading, 'nav-group'));
    for (const [id, icon, title] of visible) {
      const b = h('button', 'nav-link', e('span', icon, 'glyph'), e('span', title));
      b.dataset.page = id;
      b.onclick = () => show(id);
      nav.append(b);
    }
  }
}
export function updateChrome() {
  $('#channel-label').textContent = state.channel?.login || 'Channel';
  $('#profile-name').textContent = state.channel?.login || 'Account';
  const st = $('#global-status');
  st.textContent = state.bot ? 'Global Bot: @' + state.bot.login : 'Public bot not connected';
  st.className = 'pill ' + (state.bot ? 'good' : 'warn');
}
export function popup() {
  const menu = $('#profile-menu');
  menu.replaceChildren();
  menu.hidden = !menu.hidden;
  if (menu.hidden) return;
  menu.append(e('div', 'SWITCH CHANNEL', 'nav-group'));
  for (const ch of access.channels) {
    const b = e(
      'button',
      (ch.id === access.active_channel ? '✓ ' : '') + ch.login + ' — ' + ch.role
    );
    b.onclick = error(async () => {
      await api('/api/channels/select', 'POST', { channel: ch.id });
      location.reload();
    });
    menu.append(b);
  }
  const log = e('button', 'Sign out');
  log.onclick = error(async () => {
    await api('/logout', 'POST');
    location.reload();
  });
  menu.append(log);
}
const views = {
  overview,
  activity,
  reports,
  commands,
  timers,
  moderation,
  voice,
  loyalty,
  campaigns,
  store,
  queue,
  quotes,
  pokemon,
  overlays,
  subathon,
  streamboss,
  support,
  goals,
  metadata,
  multichat,
  relay,
  connections,
  channel,
  team,
  admin
};
export async function show(id) {
  if ((id === 'admin' && !state.isOperator) || (ownerPages.has(id) && access.role !== 'owner'))
    id = 'overview';
  setPage(id);
  $('#crumb').textContent = groups.flatMap(x => x[1]).find(x => x[0] === id)?.[2] || id;
  $('#page-title').textContent = $('#crumb').textContent;
  $('#page-desc').textContent = descriptions[id];
  $('#kicker').textContent = id === 'admin' ? 'PLATFORM ADMINISTRATION' : 'CREATOR CONTROL CENTER';
  document
    .querySelectorAll('.nav-link')
    .forEach(x => x.classList.toggle('active', x.dataset.page === id));
  const view = $('#view');
  view.replaceChildren(e('p', 'Loading...', 'muted'));
  try {
    const result = await views[id]();
    view.replaceChildren(result);
  } catch (ex) {
    view.replaceChildren(e('div', 'Failed to load page: ' + ex.message, 'empty'));
  }
}
