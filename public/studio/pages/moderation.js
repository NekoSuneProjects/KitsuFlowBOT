import { e, h, card, wrap, actions, btn, input, selector, form, list } from '../core/dom.js';
import { notify, api } from '../core/api.js';
import { engagement } from '../core/store.js';
import { reloadView } from '../core/router.js';

// Scam-link protection, banned words and manual moderation.
export async function moderation() {
  const scam = await api('/api/scam-protection');
  const section = card(
    'Scam link protection',
    'Opt-in: OFF by default. Checks known phishing, malicious and scam domains, including obfuscated (dot) links.'
  );
  const enabled = input(
    'Enable automatic Twitch scam moderation',
    Boolean(scam.enabled),
    'checkbox'
  );
  const action = selector(
    'Action when a blocked domain is detected',
    [
      ['ban', 'Ban user'],
      ['timeout', 'Timeout for 1 second']
    ],
    scam.action || 'ban'
  );
  section.append(
    enabled.node,
    action.node,
    e(
      'p',
      'Twitch bot performs moderation with a recorded reason. Requires the linked bot to have chat moderation permissions. Kick/VPZone auto-ban is not enabled without verified moderation integration. Third-party lists may produce false positives.',
      'description'
    ),
    e('p', 'Cached threat domains: ' + (scam.feed?.domains || 0), 'description'),
    actions(
      btn(
        'Save scam protection',
        async () => {
          await api('/api/scam-protection', 'POST', {
            enabled: enabled.value(),
            action: action.value()
          });
          notify('Scam protection settings saved');
          await reloadView();
        },
        'primary'
      )
    )
  );
  return h(
    'div',
    'stack',
    section,
    wrap(
      form(
        'Banned words',
        [
          ['word', 'Word or phrase'],
          ['action', 'Action', 'options', ['log', 'timeout', 'ban']]
        ],
        'Add word',
        x => api('/api/engagement/word', 'POST', x)
      ),
      form(
        'Manual moderation',
        [
          ['user', 'Twitch username'],
          ['action', 'Action', 'options', ['timeout', 'ban']],
          ['seconds', 'Timeout length in seconds', 'number', 600]
        ],
        'Apply action',
        async x => {
          if (!confirm('Moderate @' + x.user + '?')) return;
          await api('/api/moderate', 'POST', x);
        }
      )
    ),
    h(
      'section',
      'card',
      e('h2', 'Configured word filters'),
      list(
        engagement.words,
        x => x.word + ' → ' + x.action,
        x => api('/api/engagement/word/' + encodeURIComponent(x.word), 'DELETE')
      )
    )
  );
}
