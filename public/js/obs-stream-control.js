'use strict';
const $ = id => document.getElementById(id);
const status = message => {
  $('status').textContent = message;
};
const choices = {};
let working = false;
const platformNames = ['twitch', 'kick', 'vpzone'];
const selected = () =>
  Array.from(document.querySelectorAll('input[type=checkbox]:checked')).map(e => e.value);
async function request(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Error(
      payload.error ||
        'HTTP ' +
          response.status +
          (response.status === 401 ? ' - sign in to KitsuFlowBOT in this dock' : '')
    );
  return payload;
}
async function busy(button, callback) {
  if (working) return;
  working = true;
  const old = button.textContent;
  button.disabled = true;
  button.textContent = 'Working...';
  try {
    await callback();
  } catch (error) {
    status('Error: ' + error.message);
  } finally {
    working = false;
    button.disabled = false;
    button.textContent = old;
  }
}
async function refresh() {
  const data = await request('/api/obs/stream-info');
  const records = data.platforms || [];
  $('current').replaceChildren();
  if (!records.length) {
    $('current').textContent = 'No previously synced metadata. Set a title and game above.';
  }
  records.forEach(item => {
    const p = document.createElement('p');
    p.textContent =
      item.platform.toUpperCase() +
      ': ' +
      item.title +
      ' | ' +
      item.game +
      ' (' +
      item.updated +
      ')';
    $('current').append(p);
  });
  const preferred = records.find(v => v.platform === 'twitch') || records[0];
  if (preferred) {
    if (document.activeElement !== $('title')) $('title').value = preferred.title;
    if (document.activeElement !== $('game')) $('game').value = preferred.game;
  }
  status('Ready. Choose your platforms and update your stream.');
}
$('refresh').onclick = () => busy($('refresh'), refresh);
$('search').onclick = () =>
  busy($('search'), async () => {
    const q = $('game').value.trim();
    if (!q) throw Error('Enter a game or category to search.');
    const data = await request('/api/stream-metadata/categories?q=' + encodeURIComponent(q));
    $('categories').replaceChildren();
    for (const platform of platformNames) {
      delete choices[platform];
      const box = document.createElement('div'),
        label = document.createElement('label'),
        select = document.createElement('select');
      label.textContent = platform.toUpperCase() + ' category';
      const options = data[platform] || [];
      select.add(new Option('Choose ' + platform + ' game', ''));
      for (const item of options) select.add(new Option(item.name, String(item.id)));
      if (options.length === 1) select.value = String(options[0].id);
      select.onchange = () => {
        choices[platform] = options.find(o => String(o.id) === select.value) || null;
      };
      select.onchange();
      box.append(label, select);
      if (data[platform + '_error'] || !options.length) {
        const note = document.createElement('p');
        note.className = 'hint';
        note.textContent = data[platform + '_error'] || 'No matching category returned';
        box.append(note);
      }
      $('categories').append(box);
    }
    status('Category search completed. Select the correct game for each checked platform.');
  });
$('suggest').onclick = () =>
  busy($('suggest'), async () => {
    const game = $('game').value.trim();
    if (!game) throw Error('Enter a game first.');
    const result = await request('/api/creator-ai/suggest', 'POST', {
      game,
      context: $('context').value.trim()
    });
    $('title').value = result.title;
    status('AI title generated. Review it before publishing.');
  });
$('publish').onclick = () =>
  busy($('publish'), async () => {
    const platforms = selected(),
      title = $('title').value.trim();
    if (!title) throw Error('Enter a stream title.');
    if (!platforms.length) throw Error('Select at least one platform.');
    if (platforms.some(p => !choices[p]))
      throw Error('Search and choose a category for every checked platform.');
    const results = await request('/api/stream-metadata/sync', 'POST', {
      title,
      platforms,
      categories: Object.fromEntries(platforms.map(p => [p, choices[p]]))
    });
    status(
      (results.results || [])
        .map(r => r.platform.toUpperCase() + ': ' + r.status + (r.error ? ' - ' + r.error : ''))
        .join('\n') || 'Update submitted'
    );
    const current = await request('/api/obs/stream-info');
    $('current').replaceChildren();
    for (const item of current.platforms || []) {
      const p = document.createElement('p');
      p.textContent = item.platform.toUpperCase() + ': ' + item.title + ' | ' + item.game;
      $('current').append(p);
    }
  });
refresh().catch(err =>
  status('Sign in to KitsuFlowBOT using this OBS dock, then reload. ' + err.message)
);
