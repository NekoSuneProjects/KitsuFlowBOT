import { $ } from './dom.js';

// JSON API client and the notice banner.
export function notify(text) {
  $('#notice').textContent = text;
  setTimeout(() => {
    if ($('#notice').textContent === text) $('#notice').textContent = '';
  }, 6500);
}
export async function api(path, method = 'GET', body) {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let x;
  try {
    x = await r.json();
  } catch {
    x = { error: 'Unexpected server response' };
  }
  if (!r.ok) throw Error(x.error || 'Request failed');
  return x;
}
export const error =
  fn =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (ex) {
      notify(ex.message);
    }
  };
