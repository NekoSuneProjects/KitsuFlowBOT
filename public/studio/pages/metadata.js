import { e, h, card, grid, actions, btn, link, input } from '../core/dom.js';
import { notify, api } from '../core/api.js';

// Stream title & game sync, AI titles and the OBS control dock.
export async function metadata() {
  const c = h('div', 'stack');
  const metadata = card(
    'Set title and game on linked platforms',
    'Search each platform native game catalog, select its own category, then apply the same stream title to all selected platforms.'
  );
  const titleInput = input('Stream title', '');
  const gameInput = input('Search game / category (example: AION 2)', '');
  const lookup = e('div', '', 'stack');
  const output = e('div', '', 'stack');
  const chosen = {},
    checkboxes = {};
  for (const platform of ['twitch', 'kick', 'vpzone'])
    checkboxes[platform] = input('Update ' + platform.toUpperCase(), true, 'checkbox');
  metadata.append(
    grid('cols2', titleInput.node, gameInput.node),
    h(
      'div',
      'kf-settings-section',
      e('div', 'Publish to platforms', 'kf-settings-section-label'),
      h('div', 'kf-platforms', ...Object.values(checkboxes).map(x => x.node))
    ),
    h(
      'div',
      'actions kf-editor-actions',
      btn(
        'Find platform games',
        async () => {
          const data = await api(
            '/api/stream-metadata/categories?q=' + encodeURIComponent(gameInput.value())
          );
          lookup.replaceChildren();
          for (const platform of ['twitch', 'kick', 'vpzone']) {
            const results = data[platform] || [];
            const select = input(platform.toUpperCase() + ' category', '', 'select');
            select.el.append(new Option('Select category', ''));
            for (const cat of results) {
              const opt = new Option(cat.name, cat.id);
              select.el.append(opt);
            }
            if (results.length === 1) select.el.value = results[0].id;
            select.el.onchange = () => {
              chosen[platform] = results.find(x => x.id === select.el.value) || null;
            };
            if (results.length === 1) chosen[platform] = results[0];
            lookup.append(select.node);
            if (data[platform + '_error'])
              lookup.append(e('p', platform + ': ' + data[platform + '_error'], 'description'));
            else if (!results.length)
              lookup.append(e('p', platform + ': no matching categories returned', 'description'));
          }
        },
        'primary'
      ),
      btn(
        'Update selected platforms',
        async () => {
          const platforms = Object.entries(checkboxes)
            .filter(([, v]) => v.value())
            .map(([k]) => k);
          if (platforms.some(p => !chosen[p])) {
            notify('Choose a native category for every selected platform');
            return;
          }
          const x = await api('/api/stream-metadata/sync', 'POST', {
            title: titleInput.value(),
            platforms,
            categories: chosen
          });
          output.replaceChildren();
          for (const item of x.results)
            output.append(
              e(
                'div',
                item.platform.toUpperCase() +
                  ': ' +
                  item.status +
                  (item.error ? ' — ' + item.error : ' — ' + item.category),
                'description'
              )
            );
        },
        'primary'
      )
    ),
    lookup,
    output
  );
  c.append(metadata);
  const aiCard = card(
    'AI stream title helper',
    'Describe your stream in a few words. KitsuFlowBOT uses its server-configured AI service to suggest a catchy, searchable title. Review the suggestion before publishing.'
  );
  const aiContext = input('Title idea or vibe', 'Chill gameplay, welcoming to newcomers');
  aiCard.append(
    aiContext.node,
    actions(
      btn(
        'Suggest a stream title',
        async () => {
          const x = await api('/api/creator-ai/suggest', 'POST', {
            game: gameInput.value(),
            context: aiContext.value()
          });
          titleInput.el.value = x.title;
          notify('Suggested title added to the Stream title field. Review it before publishing.');
        },
        'primary'
      )
    )
  );
  c.append(aiCard);
  const dockCard = card(
    'OBS Stream Control Dock',
    'Edit your Twitch, Kick and VPZone stream title and game, or generate an AI title, from a private OBS Custom Browser Dock. Unlike the game/title overlay, this dock is a control panel and requires your broadcaster login.'
  );
  dockCard.append(
    actions(link('Open OBS Stream Control Dock ↗', '/obs/stream-control')),
    e(
      'p',
      'In OBS: Docks → Custom Browser Docks → add your KitsuFlowBOT URL ending in /obs/stream-control. Sign in with your broadcaster account in the dock.',
      'description'
    )
  );
  c.append(dockCard);

  return c;
}
