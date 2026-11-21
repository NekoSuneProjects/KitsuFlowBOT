import { notify, error } from './api.js';
import { reloadView } from './router.js';

// DOM builders and form/table widgets shared by every Studio page.
export const $ = s => document.querySelector(s);
export const e = (tag, text, cls) => {
  const x = document.createElement(tag);
  if (text !== undefined) x.textContent = text;
  if (cls) x.className = cls;
  return x;
};
export const h = (tag, cls, ...children) => {
  const x = e(tag, undefined, cls);
  for (const y of children)
    if (y != null) x.append(typeof y === 'string' ? document.createTextNode(y) : y);
  return x;
};
export const card = (title, description) => {
  const c = h('section', 'card');
  c.append(e('h2', title));
  if (description) c.append(e('div', description, 'description'));
  return c;
};
export const wrap = (...things) => h('div', 'grid cols2', ...things);
export const grid = (cls, ...things) => h('div', 'grid ' + cls, ...things);
export const actions = (...things) => h('div', 'actions', ...things);
export const btn = (label, handler, cls = '') => {
  const b = e('button', label, 'btn ' + cls);
  b.onclick = error(async () => {
    b.disabled = true;
    try {
      await handler();
    } finally {
      b.disabled = false;
    }
  });
  return b;
};
export const link = (label, url, cls = '') => {
  const x = e('a', label, 'btn ' + cls);
  x.href = url;
  return x;
};
export const input = (label, value = '', type = 'text') => {
  const l = h('label', 'field', e('span', label));
  let x = e(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
  if (type !== 'textarea' && type !== 'select') x.type = type;
  if (type === 'checkbox') x.checked = !!value;
  else x.value = value ?? '';
  l.append(x);
  return {
    node: l,
    value: () => (type === 'checkbox' ? x.checked : type === 'number' ? Number(x.value) : x.value),
    el: x
  };
};
export function selector(label, options, initial) {
  const i = input(label, initial, 'select');
  for (const opt of options) {
    const o = e('option', Array.isArray(opt) ? opt[1] : opt);
    o.value = Array.isArray(opt) ? opt[0] : opt;
    i.el.append(o);
  }
  i.el.value = initial;
  return i;
}
export const form = (title, fields, buttonText, run) => {
  const c = card(title),
    fieldsBox = h('div', 'fields');
  const refs = {};
  for (const spec of fields) {
    let f =
      spec[2] === 'options'
        ? selector(spec[1], spec[3], spec[4] || spec[3][0])
        : input(spec[1], spec[3] ?? '', spec[2] || 'text');
    refs[spec[0]] = f;
    fieldsBox.append(f.node);
  }
  c.append(
    fieldsBox,
    actions(
      btn(
        buttonText,
        async () => {
          await run(Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v.value()])));
          notify('Saved successfully');
          await reloadView();
        },
        'primary'
      )
    )
  );
  return c;
};
export const table = (cols, rows) => {
  if (!rows?.length) return e('div', 'No records yet.', 'empty');
  const t = e('table', undefined, 'table'),
    thead = e('thead'),
    tr = e('tr');
  cols.forEach(c => tr.append(e('th', c)));
  thead.append(tr);
  t.append(thead);
  const tbody = e('tbody');
  for (const values of rows) {
    const r = e('tr');
    for (const val of values) r.append(h('td', '', val instanceof Node ? val : String(val ?? '')));
    tbody.append(r);
  }
  t.append(tbody);
  return t;
};
export const list = (items, display, onRemove) => {
  const box = e('div');
  if (!items.length) return e('div', 'Nothing configured yet.', 'empty');
  for (const item of items) {
    const row = h('div', 'list-row', e('div', display(item)));
    if (onRemove)
      row.append(
        btn(
          'Remove',
          async () => {
            if (!confirm('Remove this item?')) return;
            await onRemove(item);
            await reloadView();
          },
          'danger'
        )
      );
    box.append(row);
  }
  return box;
};
export const stat = (label, num, icon, foot) =>
  h(
    'section',
    'card',
    e('div', icon, 'stat-icon'),
    e('div', label, 'stat-label'),
    e('div', String(num), 'stat-value'),
    e('div', foot, 'stat-foot')
  );
export const banner = (title, desc, action) =>
  h(
    'div',
    'banner',
    h('div', '', e('strong', title), e('p', desc)),
    e('div', undefined, 'spacer'),
    action
  );
export function editorSlot(id) {
  const node = h('div', '');
  node.id = id;
  return node;
}
