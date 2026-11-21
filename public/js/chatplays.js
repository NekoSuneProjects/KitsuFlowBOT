'use strict';
// Chat Plays: runs a NES/GBA ROM chosen by the streamer in EmulatorJS (https://emulatorjs.org) and
// presses the buttons chat types. The ROM stays in this browser (optionally saved in IndexedDB).
const key = encodeURIComponent(location.pathname.split('/').pop());
const EJS_DATA = 'https://cdn.emulatorjs.org/stable/data/';
const PRESS_MS = 140,
  GAP_MS = 70,
  MAX_QUEUE = 30,
  FEED = 12;
const $ = id => document.getElementById(id);
let settings = null,
  after = null,
  running = false,
  pressing = false;
const queue = [];

// ---- ROM storage (IndexedDB, this browser only) ----
const STORE = 'roms';
const openDb = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open('kitsuflow-chatplays', 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
async function saveRom(system, file) {
  // Read the bytes first: awaiting inside an IndexedDB transaction lets it auto-commit early.
  const data = await file.arrayBuffer();
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({ name: file.name, type: file.type, data }, system);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function loadRom(system) {
  const db = await openDb();
  return new Promise(resolve => {
    const req = db.transaction(STORE).objectStore(STORE).get(system);
    req.onsuccess = () =>
      resolve(
        req.result ? new File([req.result.data], req.result.name, { type: req.result.type }) : null
      );
    req.onerror = () => resolve(null);
  });
}

// ---- emulator ----
function start(file) {
  if (running) return;
  running = true;
  $('setup').hidden = true;
  $('stage').hidden = false;
  Object.assign(window, {
    EJS_player: '#game',
    EJS_core: settings.system,
    // Passing the File keeps its name, so the core sees the right .nes/.gba extension.
    EJS_gameUrl: file,
    EJS_gameName: file.name.replace(/\.[^.]+$/, ''),
    EJS_pathtodata: EJS_DATA,
    EJS_startOnLoaded: true,
    EJS_color: '#a879f7',
    // English UI without fetching a localization file for the browser's language.
    EJS_language: 'en-US',
    EJS_disableAutoLang: true
  });
  const script = document.createElement('script');
  script.src = EJS_DATA + 'loader.js';
  script.referrerPolicy = 'no-referrer';
  document.body.append(script);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function pressLoop() {
  if (pressing) return;
  pressing = true;
  while (queue.length) {
    const manager = window.EJS_emulator?.gameManager;
    if (!manager) {
      await sleep(300);
      continue;
    }
    const input = queue.shift();
    for (let i = 0; i < input.repeat; i++) {
      manager.simulateInput(0, input.index, 1);
      await sleep(PRESS_MS);
      manager.simulateInput(0, input.index, 0);
      await sleep(GAP_MS);
    }
  }
  pressing = false;
}
function showInput(input) {
  const li = document.createElement('li');
  const button = document.createElement('b');
  button.textContent = input.button + (input.repeat > 1 ? ' ×' + input.repeat : '');
  li.append(button, ' ' + input.user);
  const list = $('inputs');
  list.prepend(li);
  while (list.children.length > FEED) list.lastChild.remove();
}
function showMode(data) {
  if (!data.enabled) {
    $('mode').textContent = 'Chat Plays is turned off in Studio';
    return;
  }
  const buttons = data.buttons.join(' · ');
  if (data.mode === 'democracy') {
    const top = data.vote.tally.map(
      ([v, n]) => v.replace(':1', '').replace(':', ' ×') + ' (' + n + ')'
    );
    $('mode').textContent =
      'Democracy: next input in ' +
      data.vote.seconds_left +
      's\n' +
      (top.join(', ') || 'no votes yet') +
      '\n\nType: ' +
      buttons;
  } else $('mode').textContent = 'Anarchy: type ' + buttons;
}

async function poll() {
  try {
    const res = await fetch('/api/interactive/public/' + key + '/chatplays?after=' + (after ?? 0), {
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      const first = settings === null;
      settings = data;
      if (first) setup();
      showMode(data);
      if (after === null) after = data.latest;
      else
        for (const input of data.inputs) {
          after = Math.max(after, input.id);
          showInput(input);
          if (running && data.enabled) {
            queue.push(input);
            if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
          }
        }
      pressLoop();
    }
  } catch {
    // Network blips: try again on the next tick.
  }
  setTimeout(poll, 400);
}

async function setup() {
  $('system-line').textContent =
    'System: ' +
    settings.system.toUpperCase() +
    ' (change it in Studio → Interactive). Mode: ' +
    settings.mode +
    '.';
  const saved = await loadRom(settings.system).catch(() => null);
  if (saved) {
    $('resume').hidden = false;
    $('resume').textContent = 'Play ' + saved.name;
    $('resume').onclick = () => start(saved);
    // ?autostart=1 reloads straight into the saved ROM (handy when OBS refreshes the source).
    if (new URLSearchParams(location.search).has('autostart')) start(saved);
  }
  $('rom').onchange = async () => {
    const file = $('rom').files[0];
    if (!file) return;
    if ($('remember').checked) await saveRom(settings.system, file).catch(() => {});
    start(file);
  };
}
poll();
