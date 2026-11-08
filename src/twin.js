// Your twin's opening book: every position from the first moves of your games, with the moves
// you played there and how often. The twin plays those moves while it can, then hands over to
// the computer at your rating. It opens like you, then plays like a typical player at your
// rating; it is not a copy of you.

import { Chess } from '../vendor/chess.mjs';

const BOOK_PLIES = 20; // the first 10 moves each

// A position's key: the board, side to move, castling and en passant, without move counters.
export function positionKey(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

// The moves of a PGN as SAN, without headers, comments, variations, numbers or the result.
export function sanMoves(pgn) {
  let text = pgn.replace(/^\s*\[.*\]\s*$/gm, '').replace(/\{[^}]*\}/g, ' ').replace(/;.*$/gm, ' ');
  while (/\([^()]*\)/.test(text)) text = text.replace(/\([^()]*\)/g, ' ');
  return text
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.+/, ''))
    .filter((t) => t && !/^(\$\d+|1-0|0-1|1\/2-1\/2|\*)$/.test(t));
}

// Adds a game you played as `color` ('w' or 'b') to the book: { [positionKey]: { [uci]: count } }.
export function addGame(book, pgn, color) {
  const chess = new Chess();
  for (const san of sanMoves(pgn).slice(0, BOOK_PLIES)) {
    const key = positionKey(chess.fen());
    const mine = chess.turn() === color;
    let move;
    try {
      move = chess.move(san);
    } catch {
      return book; // a move we can't read: keep what came before it
    }
    if (mine) {
      const uci = move.from + move.to + (move.promotion ?? '');
      book[key] ??= {};
      book[key][uci] = (book[key][uci] ?? 0) + 1;
    }
  }
  return book;
}

// A move you've played in this position, picked by how often you played it; null if none.
export function bookMove(book, fen, random = Math.random) {
  const moves = Object.entries(book[positionKey(fen)] ?? {});
  if (!moves.length) return null;
  let r = random() * moves.reduce((sum, [, n]) => sum + n, 0);
  for (const [uci, n] of moves) {
    r -= n;
    if (r < 0) return uci;
  }
  return moves[moves.length - 1][0];
}
