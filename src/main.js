// The page: board, controls, move list, the computer opponent, your level and twin, save and
// load, sound, the installable app and the site header.

import { Sounds } from './audio.js';
import { Board } from './board.js';
import { cleanUsername, fetchGames, fetchRating } from './chesscom.js';
import { browserEngine } from './engine.js';
import { Game } from './game.js';
import { chooseMove } from './opponent.js';
import { pieceSvg } from './pieces.js';
import { LEVELS, afterGame, fromChessCom, startingPlayer } from './rating.js';
import { addGame, bookMove } from './twin.js';
import { LEVELS as COACH_LEVELS, analyseGame, callCoach, hint, localExplain, localReview } from './coach.js';

const THEME_MODULE = 'https://cdn.jsdelivr.net/gh/nickprignano/prignano-theme@4c2effc3829269e40ad663baf130a6b899a402bb/index.js';
const SAVE_KEY = 'chess-current-game';
const FLIP_KEY = 'chess-orientation';
// Everything below stays on this device. "Delete my data" clears all of it.
const MODE_KEY = 'chess-mode'; // who the current game is against
const PLAYER_KEY = 'chess-player'; // your rating
const GAMES_KEY = 'chess-games'; // finished games, for "Save all my games" and the twin
const TWIN_KEY = 'chess-twin'; // the twin's opening book
const USER_KEY = 'chess-com-user'; // your chess.com username, if you gave one
const COACH_KEY = 'chess-coach-level'; // beginner, advanced or competition
const ALL_KEYS = [SAVE_KEY, FLIP_KEY, MODE_KEY, PLAYER_KEY, GAMES_KEY, TWIN_KEY, USER_KEY, COACH_KEY, 'chess-muted'];
const MAX_GAMES = 200;
const MAX_CHESSCOM_GAMES = 500;
const MIN_THINK_MS = 500; // so the computer's reply doesn't land the instant you let go

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

function loadJson(key) {
  try {
    return JSON.parse(load(key));
  } catch {
    return null;
  }
}
const saveJson = (key, value) => save(key, JSON.stringify(value));

// The game in progress survives a reload. A saved game that no longer loads is dropped.
let game;
try {
  game = new Game(load(SAVE_KEY) || undefined);
} catch {
  game = new Game();
}
let orientation = load(FLIP_KEY) === 'b' ? 'b' : 'w';
// A friend: { opponent: 'friend' }. The computer or your twin: { opponent: 'computer' | 'twin',
// you: 'w' | 'b', rating (the computer's), rated, recorded, outOfBook, note }.
let mode = loadJson(MODE_KEY) ?? { opponent: 'friend' };
let player = loadJson(PLAYER_KEY); // { rating, rd, vol, games }, or null before you set a level
let games = loadJson(GAMES_KEY) ?? []; // [{ pgn, you }], newest last
let twin = loadJson(TWIN_KEY); // { book, games }, or null

const vsComputer = () => mode.opponent !== 'friend';
const yourTurn = () => !vsComputer() || (game.turn() === mode.you && !thinking);

const board = new Board($('board'), {
  targets: (square) => (game.status().over || !yourTurn() ? [] : game.targets(square)),
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
  computerMove();
}

// The computer: one engine in a worker, started for a game and shut down after it, so it only
// takes memory while you're playing it.
let engine = null;
let thinking = false;
let thinkToken = 0;

function getEngine() {
  if (!engine) {
    engine = browserEngine();
    engine.ready = engine.start();
  }
  return engine;
}
function quitEngine() {
  engine?.quit();
  engine = null;
}
// Stops a move the computer is still working out (Undo, New game).
function stopThinking() {
  if (!thinking) return;
  thinkToken++;
  thinking = false;
  quitEngine();
}

async function computerMove() {
  if (!vsComputer() || game.status().over || game.turn() === mode.you || thinking) return;
  const token = ++thinkToken;
  thinking = true;
  update();
  const started = Date.now();
  try {
    let uci = null;
    if (mode.opponent === 'twin' && !mode.outOfBook) {
      uci = bookMove(twin?.book ?? {}, game.fen());
      // Once out of your book, it stays out for the rest of the game.
      if (!uci) mode.outOfBook = true;
    }
    if (!uci) {
      const e = getEngine();
      await e.ready;
      uci = await chooseMove(e, game.fen(), mode.rating);
    }
    await new Promise((r) => setTimeout(r, Math.max(0, MIN_THINK_MS - (Date.now() - started))));
    if (token !== thinkToken) return;
    thinking = false;
    play(uci.slice(0, 2), uci.slice(2, 4), uci[4]);
  } catch (error) {
    if (token !== thinkToken) return;
    thinking = false;
    quitEngine();
    update();
    $('status').textContent = `${error.message} Tap Undo, or start a new game.`;
  }
}

// Once per game, when it ends: keep it for "Save all my games", and against the computer,
// update your rating and teach your twin your moves.
function recordGame() {
  mode.recorded = true;
  const pgn = game.pgn();
  games.push({ pgn, you: vsComputer() ? mode.you : null });
  games = games.slice(-MAX_GAMES);
  saveJson(GAMES_KEY, games);
  if (!vsComputer()) return;
  quitEngine();
  const { result } = game.status();
  const score = result === '1/2-1/2' ? 0.5 : (result === '1-0') === (mode.you === 'w') ? 1 : 0;
  if (mode.rated && player) {
    const before = player.rating;
    player = afterGame(player, mode.rating, score);
    saveJson(PLAYER_KEY, player);
    mode.note = `Your rating: ${before} → ${player.rating}.`;
  } else {
    mode.note = 'Not rated, because a move was taken back.';
  }
  twin ??= { book: {}, games: 0 };
  addGame(twin.book, pgn, mode.you);
  twin.games++;
  saveJson(TWIN_KEY, twin);
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
  if (status.over && !mode.recorded) recordGame();
  board.set({ board: game.board(), orientation, lastMove: game.lastMove(), check: game.checkSquare(), locked: !yourTurn() });
  let text = status.text;
  if (vsComputer()) {
    const them = mode.opponent === 'twin' ? 'Your twin' : 'The computer';
    if (status.over) text = `${status.text} ${mode.note ?? ''}`;
    else if (thinking) text = `${them} is thinking…`;
    else if (game.turn() === mode.you) text = game.checkSquare() ? 'Your move. You’re in check.' : 'Your move.';
  }
  $('status').textContent = text;
  const yourMoves = game.history().filter((m) => !vsComputer() || m.color === mode.you).length;
  $('btn-undo').disabled = yourMoves === 0 || (vsComputer() && mode.recorded);
  $('btn-hint').hidden = !vsComputer() || status.over;
  $('btn-hint').disabled = !yourTurn();
  // Once the game is over, each move in the list can be tapped for the coach's view of it.
  const list = $('moves');
  list.innerHTML = '';
  list.classList.toggle('explainable', status.over);
  const history = game.history();
  for (let i = 0; i < history.length; i += 2) {
    const li = document.createElement('li');
    for (const ply of [i, i + 1]) {
      if (!history[ply]) continue;
      const span = document.createElement(status.over ? 'button' : 'span');
      span.className = 'mv';
      span.textContent = history[ply].san;
      if (status.over) {
        span.type = 'button';
        span.setAttribute('aria-label', `Explain ${history[ply].san}`);
        span.addEventListener('click', () => runCoach('explain', ply));
      }
      li.append(span);
    }
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
  saveJson(MODE_KEY, mode);
}

// Against the computer, Undo takes back its reply too, and the game is no longer rated.
$('btn-undo').addEventListener('click', () => {
  stopThinking();
  if (!vsComputer()) {
    game.undo();
  } else {
    do game.undo(); while (game.history().length && game.turn() !== mode.you);
    mode.rated = false;
  }
  update();
  computerMove();
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

// Menu: new game, resign, your level, save and load.
$('btn-menu').addEventListener('click', () => {
  $('btn-resign').hidden = !vsComputer() || game.status().over;
  $('btn-review').hidden = !game.status().over || !game.history().length;
  $('menu').showModal();
});
$('btn-menu-close').addEventListener('click', () => $('menu').close());
$('btn-resign').addEventListener('click', () => {
  if (!confirm('Resign this game?')) return;
  stopThinking();
  game.resign(mode.you);
  $('menu').close();
  update();
});

// A rated game you leave halfway counts as a loss, so leaving can't dodge one.
function leaveGame() {
  if (!game.history().length || game.status().over) return true;
  if (vsComputer() && !game.history().some((m) => m.color === mode.you)) return true;
  if (vsComputer() && mode.rated) {
    if (!confirm('Start a new game? The current one counts as a loss.')) return false;
    stopThinking();
    game.resign(mode.you);
    update();
    return true;
  }
  return confirm('Start a new game? The current one will be lost unless you save it.');
}

$('btn-new').addEventListener('click', () => {
  $('menu').close();
  const noTwin = !twin?.games;
  $('opp-twin').disabled = noTwin;
  if (noTwin && $('opp-twin').checked) $('opp-computer').checked = true;
  $('twin-hint').textContent = noTwin
    ? 'Your twin needs some of your games first: play the computer, or add your chess.com games under Your level.'
    : `Your twin knows the openings from ${twin.games} of your games. It opens like you, then plays like a typical player at your rating.`;
  $('newgame-rating').textContent = player ? `The computer plays at your rating, ${player.rating}.` : 'You’ll pick your level first.';
  $('newgame').showModal();
});
$('btn-newgame-cancel').addEventListener('click', () => $('newgame').close());
$('btn-newgame-go').addEventListener('click', () => {
  const opponent = document.querySelector('input[name="opponent"]:checked').value;
  let you = document.querySelector('input[name="side"]:checked').value;
  if (opponent !== 'friend' && !player) {
    $('newgame').close();
    openLevel('Pick a level to start. It adjusts after every game.');
    return;
  }
  if (!leaveGame()) return;
  $('newgame').close();
  stopThinking();
  quitEngine();
  game = new Game();
  if (opponent === 'friend') {
    mode = { opponent };
  } else {
    if (you === 'random') you = Math.random() < 0.5 ? 'w' : 'b';
    mode = { opponent, you, rating: player.rating, rated: true, recorded: false, outOfBook: false };
    const them = `${opponent === 'twin' ? 'Your twin' : 'Computer'} (${player.rating})`;
    game.setHeader('White', you === 'w' ? 'You' : them);
    game.setHeader('Black', you === 'b' ? 'You' : them);
    orientation = you;
    save(FLIP_KEY, orientation);
  }
  update();
  computerMove();
});

// The coach: hints during a game against the computer, a review after any game, and "explain"
// for a tapped move. See src/coach.js for what is checked here and what goes to the AI coach.
let coachLevel = COACH_LEVELS.includes(load(COACH_KEY)) ? load(COACH_KEY) : 'beginner';
let analysis = null; // { pgn, facts }: the engine's checks for the finished game, kept for explains

$('coach-level').addEventListener('change', () => {
  coachLevel = $('coach-level').value;
  save(COACH_KEY, coachLevel);
});

// Hints are free and made on this device. Taking one makes the game unrated, like Undo.
$('btn-hint').addEventListener('click', async () => {
  if (!yourTurn() || game.status().over) return;
  $('btn-hint').disabled = true;
  try {
    const e = getEngine();
    await e.ready;
    const h = await hint(e, game.fen(), coachLevel);
    mode.rated = false;
    update();
    if (coachLevel !== 'competition' && h.square) board.activate(h.square);
    $('status').textContent = `Hint: ${h.text} (Hints make this game unrated.)`;
  } catch (error) {
    quitEngine();
    update();
    $('status').textContent = error.message;
  }
});

const WHY_LOCAL = {
  'signed-out': 'Sign in (family only) for a review written by the AI coach. Meanwhile, here are the free notes.',
  'user-limit': 'You’ve used today’s AI reviews. Here are the free notes instead.',
  budget: 'The AI coach is resting until tomorrow. Here are the free notes instead.',
};

async function runCoach(kind, ply) {
  $('menu').close();
  $('coach-title').textContent = kind === 'review' ? 'Game review' : 'About this move';
  $('coach-body').replaceChildren();
  $('coach-source').textContent = '';
  $('coach-signin').hidden = true;
  $('coach-status').textContent = 'Checking the moves on this device…';
  $('coach').showModal();
  const history = game.history();
  const moves = history.map((m) => m.from + m.to + (m.promotion ?? ''));
  const pgn = game.pgn();
  try {
    if (analysis?.pgn !== pgn) {
      const e = getEngine();
      await e.ready;
      const facts = await analyseGame(e, moves, (i, n) => {
        $('coach-status').textContent = `Checking the moves on this device… ${i} of ${n}`;
      });
      analysis = { pgn, facts };
      quitEngine();
    }
  } catch (error) {
    quitEngine();
    $('coach-status').textContent = error.message;
    return;
  }
  $('coach-status').textContent = 'Asking the coach…';
  const body = { level: coachLevel, moves, facts: analysis.facts, ...(kind === 'explain' ? { ply } : {}) };
  const ai = await callCoach(kind, body);
  if (!ai.error) {
    showCoach(ai, history, 'Written by the AI coach (Claude). It can make mistakes.');
    $('coach-status').textContent = '';
    return;
  }
  const side = vsComputer() ? mode.you : null;
  showCoach(kind === 'review' ? localReview(moves, analysis.facts, coachLevel, side) : localExplain(moves, analysis.facts, coachLevel, ply), history, 'Notes from the computer on this device.');
  $('coach-status').textContent = kind === 'review' ? WHY_LOCAL[ai.error] ?? 'The AI coach isn’t available right now. Here are the free notes.' : '';
  $('coach-signin').hidden = ai.error !== 'signed-out';
}

// Shows a review: a summary and moments, all as plain text.
function showCoach({ summary, moments }, history, source) {
  const body = $('coach-body');
  body.replaceChildren();
  if (summary) {
    const p = document.createElement('p');
    p.textContent = summary;
    body.append(p);
  }
  for (const m of moments) {
    const p = document.createElement('p');
    const b = document.createElement('strong');
    b.textContent = m.label ?? `${Math.floor(m.ply / 2) + 1}${m.ply % 2 ? '…' : '.'} ${history[m.ply]?.san ?? ''}`;
    p.append(b, ` ${m.text}`);
    body.append(p);
  }
  $('coach-source').textContent = source;
}
$('btn-review').addEventListener('click', () => runCoach('review'));
$('btn-coach-close').addEventListener('click', () => $('coach').close());

// Whether you're signed in for the AI coach, shown under Your level.
async function showAccount() {
  $('coach-account').textContent = 'Checking sign-in…';
  $('account-signin').hidden = true;
  const s = await callCoach('status');
  if (s.error === 'signed-out') {
    $('coach-account').textContent = 'Not signed in. Family members can sign in for reviews written by the AI coach.';
    $('account-signin').hidden = false;
  } else if (s.error || !s.ready) {
    $('coach-account').textContent = 'The AI coach isn’t switched on yet. Reviews use the free notes.';
  } else {
    $('coach-account').textContent = s.open
      ? `Signed in. Left today: ${s.reviews} AI review${s.reviews === 1 ? '' : 's'} and ${s.explains} explain${s.explains === 1 ? '' : 's'}.`
      : 'Signed in. The AI coach is resting until tomorrow.';
  }
}

// The idea box: ideas for the app go to the owner, never to the AI.
$('btn-idea').addEventListener('click', () => {
  $('menu').close();
  $('idea-text').value = '';
  $('idea-msg').textContent = '';
  $('idea-signin').hidden = true;
  $('idea').showModal();
});
$('btn-idea-cancel').addEventListener('click', () => $('idea').close());
$('btn-idea-send').addEventListener('click', async () => {
  const text = $('idea-text').value.trim();
  if (!text) return;
  $('btn-idea-send').disabled = true;
  const r = await callCoach('idea', { text });
  $('btn-idea-send').disabled = false;
  if (!r.error) {
    $('idea-text').value = '';
    $('idea-msg').textContent = 'Thanks! Your idea was sent.';
  } else {
    $('idea-msg').textContent = r.error === 'signed-out' ? 'Sign in first (family only).' : 'It didn’t send. Try again later.';
    $('idea-signin').hidden = r.error !== 'signed-out';
  }
});

// Your level and twin.
function showLevel() {
  $('coach-level').value = coachLevel;
  $('level-now').textContent = player
    ? `Your rating is ${player.rating}${player.games ? `, after ${player.games} game${player.games === 1 ? '' : 's'} here` : ''}. It adjusts after every game against the computer.`
    : 'You don’t have a rating yet. Pick a level, or bring your chess.com rating.';
  $('twin-now').textContent = twin?.games ? `Your twin knows the openings from ${twin.games} of your games.` : 'Your twin has no games yet.';
}
function openLevel(message) {
  $('level-msg').textContent = message ?? '';
  showAccount();
  $('cc-user').value = load(USER_KEY) ?? '';
  showLevel();
  $('level').showModal();
}
for (const level of LEVELS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = level.name;
  button.addEventListener('click', () => {
    player = startingPlayer(level.rating, 350);
    saveJson(PLAYER_KEY, player);
    $('level-msg').textContent = `Starting at ${level.rating}. Your first 10 games move it quickly.`;
    showLevel();
  });
  $('levels').append(button);
}
$('btn-level').addEventListener('click', () => {
  $('menu').close();
  openLevel();
});
$('btn-level-close').addEventListener('click', () => $('level').close());

// Runs a chess.com request with the buttons locked and the outcome in the message line.
async function withChessCom(work) {
  let username;
  try {
    username = cleanUsername($('cc-user').value);
  } catch (e) {
    $('level-msg').textContent = e.message;
    return;
  }
  save(USER_KEY, username);
  $('btn-cc-rating').disabled = $('btn-cc-twin').disabled = true;
  $('level-msg').textContent = 'Asking chess.com…';
  try {
    $('level-msg').textContent = await work(username);
  } catch (e) {
    $('level-msg').textContent = e.message;
  }
  $('btn-cc-rating').disabled = $('btn-cc-twin').disabled = false;
  showLevel();
}
$('btn-cc-rating').addEventListener('click', () => withChessCom(async (username) => {
  const { rating, kind } = await fetchRating(username);
  player = startingPlayer(fromChessCom(rating, kind), 200);
  saveJson(PLAYER_KEY, player);
  return `chess.com ${kind} ${rating} is about ${player.rating} here. That’s a rough match, and it settles as you play.`;
}));
$('btn-cc-twin').addEventListener('click', () => withChessCom(async (username) => {
  const fromChessComGames = (await fetchGames(username)).slice(-MAX_CHESSCOM_GAMES);
  // Rebuilt from scratch: your chess.com games plus the games you've played the computer here.
  const all = [...fromChessComGames, ...games.filter((g) => g.you).map((g) => ({ pgn: g.pgn, color: g.you }))];
  twin = { book: {}, games: all.length };
  for (const g of all) addGame(twin.book, g.pgn, g.color);
  saveJson(TWIN_KEY, twin);
  return `Read ${fromChessComGames.length} games from your last 6 months on chess.com.`;
}));

$('btn-export').addEventListener('click', () => {
  if (!games.length) {
    $('level-msg').textContent = 'No finished games yet.';
    return;
  }
  download(games.map((g) => g.pgn).join('\n\n') + '\n', 'chess-all-games');
});
$('btn-delete').addEventListener('click', async () => {
  if (!confirm('Delete your rating, your twin, your saved games and settings from this device?')) return;
  // If you're signed in, the coach's usage counters for you go too.
  await callCoach('forget', {});
  for (const key of ALL_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage blocked: there's nothing stored.
    }
  }
  location.reload();
});

function download(text, name) {
  const blob = new Blob([text], { type: 'application/x-chess-pgn' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.pgn`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('btn-save').addEventListener('click', () => download(game.pgn() + '\n', 'chess'));
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
  let loaded;
  try {
    loaded = new Game($('load-text').value);
  } catch (e) {
    $('load-error').textContent = e.message;
    $('load-error').hidden = false;
    return;
  }
  // A loaded game carries on as two players on this device, and isn't added to your games.
  stopThinking();
  quitEngine();
  game = loaded;
  mode = { opponent: 'friend', recorded: true };
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

// Back from signing in: tidy the address.
if (location.search.includes('signed-in')) history.replaceState(null, '', '/');

update();
computerMove(); // if the computer was about to move when the page closed
