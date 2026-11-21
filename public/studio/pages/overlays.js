import { e, h, wrap, actions, btn, link, form, table } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { creator } from '../core/store.js';

// Legacy OBS overlay widgets.
export function overlays() {
  return wrap(
    form(
      'New OBS overlay',
      [
        ['title', 'Overlay name'],
        ['kind', 'Widget', 'options', ['alerts', 'leaderboard', 'queue', 'ticker']]
      ],
      'Create overlay',
      x => api('/api/creator/overlay', 'POST', x)
    ),
    h(
      'section',
      'card',
      e('h2', 'Browser source widgets'),
      table(
        ['Widget', 'Type', 'Actions'],
        creator.overlays.map(x => [
          x.title,
          x.kind,
          actions(
            link('Open source ↗', '/overlay/' + x.public_key),
            btn('Test', async () => {
              await api('/api/creator/overlay/test', 'POST', {
                id: x.id,
                message: 'KitsuFlowBOT test notification'
              });
              notify('Test event sent');
            })
          )
        ])
      )
    )
  );
}
