// Game state on top of chess.js: moves from the board, status for the page, PGN save and load.
// Nothing here touches the DOM, so the tests run it in Node.

import { Chess } from '../vendor/chess.mjs';

export class Game {
  constructor(pgn) {
    this.chess = new Chess();
    if (pgn) this.loadPgn(pgn);
  }

  turn() {
    return this.chess.turn();
  }

  // Board contents as an 8x8 array, rank 8 first, each square null or { type, color }.
  board() {
    return this.chess.board();
  }

  // Squares the piece on `square` can move to; empty if it isn't the side to move.
  targets(square) {
    return this.chess.moves({ square, verbose: true }).map((m) => m.to);
  }

  // True if moving from -> to is a pawn reaching the last rank, so the page must ask for a piece.
  needsPromotion(from, to) {
    return this.chess.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion);
  }

  // Plays a move; returns the chess.js move (with san, captured, flags) or null if it's illegal.
  move(from, to, promotion) {
    try {
      return this.chess.move({ from, to, promotion });
    } catch {
      return null;
    }
  }

  // Taking a move back also takes back a resignation.
  undo() {
    this.chess.removeHeader('Termination');
    return this.chess.undo();
  }

  // `color` ('w' or 'b') gives up.
  resign(color) {
    this.chess.setHeader('Result', color === 'w' ? '0-1' : '1-0');
    this.chess.setHeader('Termination', `${color === 'w' ? 'White' : 'Black'} resigned`);
  }

  setHeader(key, value) {
    this.chess.setHeader(key, value);
  }

  fen() {
    return this.chess.fen();
  }

  history() {
    return this.chess.history({ verbose: true });
  }

  lastMove() {
    const h = this.chess.history({ verbose: true });
    return h.length ? h[h.length - 1] : null;
  }

  // Where the side to move's king is, if it's in check.
  checkSquare() {
    if (!this.chess.inCheck()) return null;
    const turn = this.chess.turn();
    for (const row of this.chess.board()) {
      for (const p of row) if (p && p.type === 'k' && p.color === turn) return p.square;
    }
    return null;
  }

  // { over, result, text } for the status line.
  status() {
    const c = this.chess;
    const side = c.turn() === 'w' ? 'White' : 'Black';
    const other = c.turn() === 'w' ? 'Black' : 'White';
    // A game that ended some other way, such as a resignation, says how in its headers.
    const { Result, Termination } = c.getHeaders();
    if (Termination && Result && Result !== '*') return { over: true, result: Result, text: `${Termination}.` };
    if (c.isCheckmate()) return { over: true, result: c.turn() === 'w' ? '0-1' : '1-0', text: `Checkmate. ${other} wins.` };
    if (c.isStalemate()) return { over: true, result: '1/2-1/2', text: 'Stalemate. Draw.' };
    if (c.isInsufficientMaterial()) return { over: true, result: '1/2-1/2', text: 'Draw: not enough pieces to mate.' };
    if (c.isThreefoldRepetition()) return { over: true, result: '1/2-1/2', text: 'Draw by repetition.' };
    if (c.isDrawByFiftyMoves()) return { over: true, result: '1/2-1/2', text: 'Draw by the 50-move rule.' };
    return { over: false, result: '*', text: c.inCheck() ? `${side} to move, in check.` : `${side} to move.` };
  }

  pgn() {
    const { result } = this.status();
    this.chess.setHeader('Result', result);
    return this.chess.pgn();
  }

  // Loads a PGN; throws with a readable message if it isn't one.
  loadPgn(pgn) {
    const next = new Chess();
    try {
      next.loadPgn(pgn);
    } catch (e) {
      throw new Error(`That isn't a game this app can read (${e.message}).`);
    }
    this.chess = next;
  }
}
