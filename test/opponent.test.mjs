// Run with: node --test
// The computer opponent, ratings, the twin and the chess.com reader. Nothing here calls
// chess.com: its answers are made up and handed in through a fake fetch.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { cleanUsername, fetchGames, fetchRating } from '../src/chesscom.js';
import { ENGINE_FILE, Engine } from '../src/engine.js';
import { Game } from '../src/game.js';
import { chooseMove, pickMove, searchFor, temperature } from '../src/opponent.js';
import { afterGame, fromChessCom, glicko2, startingPlayer } from '../src/rating.js';
import { addGame, bookMove, positionKey, sanMoves } from '../src/twin.js';

test('Glicko-2 matches the worked example in Glickman\'s paper', () => {
  const next = glicko2({ rating: 1500, rd: 200, vol: 0.06 }, [
    { rating: 1400, rd: 30, score: 1 },
    { rating: 1550, rd: 100, score: 0 },
    { rating: 1700, rd: 300, score: 0 },
  ]);
  assert.ok(Math.abs(next.rating - 1464.06) < 0.05, next.rating);
  assert.ok(Math.abs(next.rd - 151.52) < 0.05, next.rd);
  assert.ok(Math.abs(next.vol - 0.05999) < 0.00001, next.vol);
});

test('your rating rises after a win, falls after a loss, and moves fast for 10 games', () => {
  const p = startingPlayer(1200, 350);
  assert.ok(afterGame(p, 1200, 1).rating > 1200);
  assert.ok(afterGame(p, 1200, 0).rating < 1200);
  let q = p;
  for (let i = 0; i < 9; i++) q = afterGame(q, q.rating, 0.5);
  assert.equal(q.rd, 200);
  q = afterGame(q, q.rating, 0.5);
  assert.equal(q.games, 10);
  assert.ok(q.rd < 200);
  assert.equal(afterGame(startingPlayer(400, 350), 400, 0).rating, 400);
});

test('chess.com ratings map through separate rapid and blitz tables', () => {
  assert.equal(fromChessCom(815, 'rapid'), 1290);
  assert.equal(fromChessCom(500, 'blitz'), 1290);
  assert.equal(fromChessCom(1000, 'blitz'), 1615);
  assert.ok(fromChessCom(1000, 'rapid') < fromChessCom(1000, 'blitz')); // chess.com rapid runs higher than blitz
  assert.ok(fromChessCom(300, 'rapid') < 1290 && fromChessCom(300, 'rapid') >= 400);
  assert.equal(fromChessCom(1212, 'rapid'), 1585); // between table rows 1170 -> 1555 and 1255 -> 1615
});

test('a lower rating spreads its picks wider; the strongest rating uses the strength limit', () => {
  assert.ok(temperature(400) > temperature(1200) && temperature(1200) > temperature(1900));
  assert.deepEqual(searchFor(2300), { elo: 2300, movetime: 600 });
  assert.equal(searchFor(800).multipv, 10);
  const lines = [{ move: 'e2e4', score: 30 }, { move: 'a2a3', score: -150 }];
  // With the random number near the top of the range, a beginner takes the worse move, a strong player doesn't.
  assert.equal(pickMove(lines, 600, () => 0.9), 'a2a3');
  assert.equal(pickMove(lines, 1900, () => 0.9), 'e2e4');
  assert.equal(pickMove([], 1000), null);
});

test('the twin replays the moves you play, weighted by how often, and only yours', () => {
  const pgn = '[Event "Live Chess"]\n[White "me"]\n\n1. e4 {[%clk 0:09:58]} 1... c5 {[%clk 0:09:59]} 2. Nf3 (2. c3 d5) 2... d6 $1 1-0';
  assert.deepEqual(sanMoves(pgn), ['e4', 'c5', 'Nf3', 'd6']);
  const book = {};
  addGame(book, pgn, 'w');
  addGame(book, '1. e4 e5 2. Nf3 *', 'w');
  addGame(book, '1. d4 d5 *', 'w');
  const start = new Game().fen();
  assert.deepEqual(book[positionKey(start)], { e2e4: 2, d2d4: 1 });
  assert.equal(bookMove(book, start, () => 0), 'e2e4');
  assert.equal(bookMove(book, start, () => 0.99), 'd2d4');
  // Black's replies aren't yours when you played White.
  const g = new Game();
  g.move('e2', 'e4');
  assert.equal(bookMove(book, g.fen()), null);
});

test('a resigned game is over, and says so in its PGN', () => {
  const g = new Game();
  g.move('e2', 'e4');
  g.resign('b');
  assert.deepEqual(g.status(), { over: true, result: '1-0', text: 'Black resigned.' });
  assert.match(g.pgn(), /\[Result "1-0"\]/);
  assert.equal(new Game(g.pgn()).status().over, true);
  g.undo();
  assert.equal(g.status().over, false);
});

// A fake fetch answering from a table of URL -> JSON (or a status number).
function fakeFetch(routes) {
  return async (url) => {
    const r = routes[url];
    if (r === undefined) throw new TypeError('network');
    if (typeof r === 'number') return { ok: false, status: r, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r };
  };
}

test('chess.com: usernames are checked, rapid wins over blitz, and only your standard games count', async () => {
  assert.equal(cleanUsername('  Some_Player-1 '), 'some_player-1');
  assert.throws(() => cleanUsername('no spaces'), /username/);
  assert.throws(() => cleanUsername('ab'), /username/);
  const api = 'https://api.chess.com/pub/player/kid';
  assert.deepEqual(await fetchRating('kid', fakeFetch({ [`${api}/stats`]: { chess_rapid: { last: { rating: 640 } }, chess_blitz: { last: { rating: 500 } } } })), { rating: 640, kind: 'rapid' });
  assert.deepEqual(await fetchRating('kid', fakeFetch({ [`${api}/stats`]: { chess_blitz: { last: { rating: 500 } } } })), { rating: 500, kind: 'blitz' });
  await assert.rejects(fetchRating('kid', fakeFetch({ [`${api}/stats`]: 404 })), /no player/);
  await assert.rejects(fetchRating('kid', fakeFetch({})), /Couldn’t reach/);
  const months = Array.from({ length: 8 }, (_, i) => `${api}/games/2026/0${i + 1}`);
  const routes = { [`${api}/games/archives`]: { archives: months } };
  for (const m of months) routes[m] = { games: [] };
  routes[months[7]] = {
    games: [
      { rules: 'chess', pgn: '1. e4 e5 *', white: { username: 'Kid' }, black: { username: 'x' } },
      { rules: 'chess', pgn: '1. d4 d5 *', white: { username: 'y' }, black: { username: 'kid' } },
      { rules: 'chess960', pgn: '1. f4 *', white: { username: 'kid' }, black: { username: 'x' } },
      { rules: 'chess', pgn: '1. c4 *', white: { username: 'kid' }, black: { username: 'x' }, initial_setup: '8/8/8/8/8/8/8/K6k w - - 0 1' },
    ],
  };
  routes[months[0]] = { games: [{ rules: 'chess', pgn: '1. b3 *', white: { username: 'kid' }, black: { username: 'x' } }] };
  const games = await fetchGames('kid', 6, fakeFetch(routes));
  assert.deepEqual(games, [{ pgn: '1. e4 e5 *', color: 'w' }, { pgn: '1. d4 d5 *', color: 'b' }]);
});

// The real engine file from vendor/, run by Node as a child process.
function nodeEngine() {
  const child = spawn(process.execPath, [ENGINE_FILE], { stdio: ['pipe', 'pipe', 'inherit'] });
  const engine = new Engine((line) => child.stdin.write(`${line}\n`));
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      engine.receive(buffer.slice(0, i).trim());
      buffer = buffer.slice(i + 1);
    }
  });
  engine.quit = () => child.kill();
  return engine;
}

test('the bundled Stockfish plays legal moves at a beginner level and at full strength', { timeout: 60000 }, async () => {
  const engine = nodeEngine();
  try {
    await engine.start();
    const { lines } = await engine.search(new Game().fen(), { multipv: 3, depth: 6 });
    assert.equal(lines.length, 3);
    const game = new Game();
    for (let ply = 0; ply < 12 && !game.status().over; ply++) {
      const uci = await chooseMove(engine, game.fen(), ply % 2 ? 2400 : 800);
      assert.ok(game.move(uci.slice(0, 2), uci.slice(2, 4), uci[4]), `illegal move ${uci}`);
    }
    // It finds mate in one: white Qh5xf7 after 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6.
    const mate = new Game('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6');
    assert.equal((await engine.search(mate.fen(), { depth: 6 })).best, 'h5f7');
  } finally {
    engine.quit();
  }
});
