// Run with: node --test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellOf, squareAt } from '../src/board.js';
import { Game } from '../src/game.js';
import { pieceSvg } from '../src/pieces.js';

function playAll(game, moves) {
  for (const m of moves) assert.ok(game.move(m.slice(0, 2), m.slice(2, 4), m[4]), `illegal: ${m}`);
}

test('a new game starts with White to move and 20 legal first moves', () => {
  const g = new Game();
  assert.equal(g.turn(), 'w');
  assert.deepEqual(g.status(), { over: false, result: '*', text: 'White to move.' });
  const total = ['a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2', 'b1', 'g1'].reduce((n, sq) => n + g.targets(sq).length, 0);
  assert.equal(total, 20);
  assert.deepEqual(g.targets('e7'), [], "Black can't move first");
});

test('illegal moves are refused without changing the game', () => {
  const g = new Game();
  assert.equal(g.move('e2', 'e5'), null);
  assert.equal(g.history().length, 0);
});

test("fool's mate ends the game with Black winning", () => {
  const g = new Game();
  playAll(g, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  assert.deepEqual(g.status(), { over: true, result: '0-1', text: 'Checkmate. Black wins.' });
  assert.equal(g.checkSquare(), 'e1');
  assert.match(g.pgn(), /0-1$/);
});

test('check is reported and highlights the king', () => {
  const g = new Game();
  playAll(g, ['e2e4', 'f7f6', 'd1h5']);
  assert.equal(g.status().text, 'Black to move, in check.');
  assert.equal(g.checkSquare(), 'e8');
});

test('a pawn reaching the last rank asks for a piece', () => {
  const g = new Game('[FEN "8/P7/8/8/8/8/8/k6K w - - 0 1"]\n[SetUp "1"]\n\n*');
  assert.ok(g.needsPromotion('a7', 'a8'));
  assert.ok(!g.needsPromotion('h1', 'h2'));
  const move = g.move('a7', 'a8', 'n');
  assert.equal(move.san, 'a8=N');
});

test('castling and en passant are offered', () => {
  const g = new Game();
  playAll(g, ['e2e4', 'a7a6', 'g1f3', 'a6a5', 'f1c4', 'a5a4', 'b2b4']);
  assert.ok(g.targets('a4').includes('b3'), 'en passant');
  playAll(g, ['h7h6']);
  assert.ok(g.targets('e1').includes('g1'), 'short castling');
});

test('stalemate is a draw', () => {
  const g = new Game('[FEN "7k/4Q3/6K1/8/8/8/8/8 w - - 0 1"]\n[SetUp "1"]\n\n*');
  playAll(g, ['e7f7']);
  assert.equal(g.status().text, 'Stalemate. Draw.');
});

test('undo takes back the last move', () => {
  const g = new Game();
  playAll(g, ['e2e4', 'e7e5']);
  g.undo();
  assert.equal(g.turn(), 'b');
  assert.equal(g.lastMove().san, 'e4');
});

test('a saved game loads back the same, and junk is refused with a readable message', () => {
  const g = new Game();
  playAll(g, ['d2d4', 'd7d5', 'c2c4']);
  const copy = new Game(g.pgn());
  assert.deepEqual(copy.history().map((m) => m.san), ['d4', 'd5', 'c4']);
  assert.throws(() => new Game('1. e4 e5 2. Kxe8'), /isn't a game this app can read/);
});

test('board squares map to screen cells both ways round', () => {
  assert.equal(squareAt(0, 0, 'w'), 'a8');
  assert.equal(squareAt(0, 0, 'b'), 'h1');
  assert.equal(squareAt(4, 6, 'w'), 'e2');
  for (const o of ['w', 'b']) {
    for (const sq of ['a1', 'e4', 'h8', 'c7']) assert.equal(squareAt(...cellOf(sq, o), o), sq);
  }
});

test('every piece has artwork for both sides', () => {
  for (const t of 'pnbrqk') {
    assert.match(pieceSvg(t, 'w'), /class="piece white"/);
    assert.match(pieceSvg(t, 'b'), /class="piece black"/);
  }
});
