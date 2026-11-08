// The page: board, controls, move list, save and load, sound, the installable app and the
// site header.

import { Sounds } from './audio.js';
import { Board } from './board.js';
import { Game } from './game.js';
import { pieceSvg } from './pieces.js';

const THEME_MODULE = 'https://cdn.jsdelivr.net/gh/nickprignano/prignano-theme@4c2effc3829269e40ad663baf130a6b899a402bb/index.js';
const SAVE_KEY = 'chess-current-game';
const FLIP_KEY = 'chess-orientation';

const $ = (id) => document.getElementById(id);
const sounds = new Sounds();
const installed = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;

function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the game just isn't remembered after a reload.
  }
}

// The game in progress survives a reload. A saved game that no longer loads is dropped.
let game;
try {
  game = new Game(load(SAVE_KEY) || undefined);
} catch {
  game = new Game();
}
let orientation = load(FLIP_KEY) === 'b' ? 'b' : 'w';

const board = new Board($('board'), {
  targets: (square) => (game.status().over ? [] : game.targets(square)),
  onMove: (from, to) => {
    if (game.needsPromotion(from, to)) askPromotion(from, to);
    else play(from, to);
  },
});

function play(from, to, promotion) {
  const move = game.move(from, to, promotion);
  if (!move) return;
  const status = game.status();
  if (status.over) sounds.play('end');
  else if (move.san.includes('+')) sounds.play('check');
  else sounds.play(move.captured ? 'capture' : 'move');
  update();
}

function askPromotion(from, to) {
  const color = game.turn();
  const box = $('promote-choices');
  box.innerHTML = '';
  for (const [type, name] of [['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', name);
    button.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">${pieceSvg(type, color)}</svg>`;
    button.addEventListener('click', () => {
      $('promote').close();
      play(from, to, type);
    });
    box.append(button);
  }
  $('promote').showModal();
}

function update() {
  const status = game.status();
  board.set({ board: game.board(), orientation, lastMove: game.lastMove(), check: game.checkSquare() });
  $('status').textContent = status.text;
  $('btn-undo').disabled = game.history().length === 0;
  const list = $('moves');
  list.innerHTML = '';
  const history = game.history();
  for (let i = 0; i < history.length; i += 2) {
    const li = document.createElement('li');
    li.textContent = history[i].san + (history[i + 1] ? `  ${history[i + 1].san}` : '');
    list.append(li);
  }
  if (status.over) {
    const li = document.createElement('li');
    li.className = 'result';
    li.textContent = status.result;
    list.append(li);
  }
  list.scrollTop = list.scrollHeight;
  save(SAVE_KEY, game.pgn());
}

$('btn-undo').addEventListener('click', () => {
  game.undo();
  update();
});
$('btn-flip').addEventListener('click', () => {
  orientation = orientation === 'w' ? 'b' : 'w';
  save(FLIP_KEY, orientation);
  update();
});

function showMute() {
  $('btn-mute').textContent = sounds.muted ? 'Muted' : 'Sound';
  $('btn-mute').setAttribute('aria-pressed', String(sounds.muted));
}
showMute();
$('btn-mute').addEventListener('click', () => {
  sounds.setMuted(!sounds.muted);
  showMute();
});
// Sound can only start after a tap or key press.
addEventListener('pointerdown', () => sounds.unlock(), { capture: true });
addEventListener('keydown', () => sounds.unlock(), { capture: true });

// Menu: new game, save and load.
$('btn-menu').addEventListener('click', () => $('menu').showModal());
$('btn-menu-close').addEventListener('click', () => $('menu').close());
$('btn-new').addEventListener('click', () => {
  if (game.history().length && !game.status().over && !confirm('Start a new game? The current one will be lost unless you save it.')) return;
  game = new Game();
  $('menu').close();
  update();
});
$('btn-save').addEventListener('click', () => {
  const blob = new Blob([game.pgn() + '\n'], { type: 'application/x-chess-pgn' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `chess-${new Date().toISOString().slice(0, 10)}.pgn`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('btn-load').addEventListener('click', () => {
  $('menu').close();
  $('load-text').value = '';
  $('load-file').value = '';
  $('load-error').hidden = true;
  $('load').showModal();
});
$('load-file').addEventListener('change', async () => {
  const file = $('load-file').files[0];
  if (file) $('load-text').value = (await file.text()).slice(0, 200000);
});
$('btn-load-cancel').addEventListener('click', () => $('load').close());
$('btn-load-go').addEventListener('click', () => {
  try {
    game = new Game($('load-text').value);
  } catch (e) {
    $('load-error').textContent = e.message;
    $('load-error').hidden = false;
    return;
  }
  $('load').close();
  update();
});
$('about-link').addEventListener('click', (e) => {
  e.preventDefault();
  $('menu').close();
  $('about').showModal();
});
$('btn-about-close').addEventListener('click', () => $('about').close());

// Installable app: sw.js keeps every file so it works offline. A new version downloads in the
// background and the menu offers it; it never reloads the page by itself.
let updateWaiting = null;
let installPrompt = null;
let reloadOnUpdate = false;
function showAppActions() {
  $('btn-update').hidden = !updateWaiting;
  $('btn-install').hidden = !installPrompt;
  $('app-actions').hidden = !updateWaiting && !installPrompt;
  // iPhone and iPad have no install button: Safari's Share menu does it.
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('ios-install').hidden = installed || !apple;
}
showAppActions();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((registration) => {
    const watch = (worker) => worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        updateWaiting = worker;
        showAppActions();
      }
    });
    if (registration.waiting && navigator.serviceWorker.controller) updateWaiting = registration.waiting;
    watch(registration.installing);
    registration.addEventListener('updatefound', () => watch(registration.installing));
    // Installed apps are reopened rather than reloaded, so look for a new version each time.
    document.addEventListener('visibilitychange', () => document.hidden || registration.update().catch(() => {}));
    showAppActions();
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => reloadOnUpdate && location.reload());
}
$('btn-update').addEventListener('click', () => {
  reloadOnUpdate = true;
  updateWaiting.postMessage('skip-waiting');
});
addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  showAppActions();
});
$('btn-install').addEventListener('click', async () => {
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  showAppActions();
});

// Site header from prignano-theme, loaded at runtime so this repo carries no personal details.
// The app works without it.
function setHeaderCollapsed(collapsed) {
  $('site-header').classList.toggle('collapsed', collapsed);
  $('btn-header').textContent = collapsed ? '▾' : '▴';
  $('btn-header').setAttribute('aria-expanded', String(!collapsed));
  $('btn-header').setAttribute('aria-label', collapsed ? 'Show the site header' : 'Hide the site header');
}
$('btn-header').addEventListener('click', () => setHeaderCollapsed(!$('site-header').classList.contains('collapsed')));
if (installed) setHeaderCollapsed(true);
import(THEME_MODULE)
  .then(({ headerHtml, initThemeToggle }) => {
    $('site-header').innerHTML = headerHtml({ bio: 'Chess, open source', links: [] });
    initThemeToggle();
    applyTheme();
  })
  .catch(() => $('btn-header').remove());

// The phone's status bar takes the page background (theme-color), in both themes.
function applyTheme() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]').content = bg;
}
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyTheme();

update();
