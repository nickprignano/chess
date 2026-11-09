// Live games: the rules of a room, with no Cloudflare in them, so the tests run them in Node.
// worker/room.js keeps this state in a Durable Object and talks to the two browsers.
//
// A room has two seats, each held by a secret token the browser keeps. The room is the referee:
// it replays every move with chess.js, runs the clocks from timestamps, and decides how the game
// ended. Nothing here knows who the players are.

import { Chess } from '../vendor/chess.mjs';

// 31 letters and digits that can't be mixed up (no 0, 1, I, L or O): 31^6 is about 887 million.
export const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
export const CLOCKS = { '5+3': [5, 3], '10+5': [10, 5], '15+10': [15, 10] }; // minutes, seconds added a move
export const LAG_MS = 300; // each move's allowance for the network
export const GONE_MS = 3 * 60 * 1000; // after this long disconnected, the other player can claim the win
const OPEN_MS = 60 * 60 * 1000; // a room no one joins closes after an hour
const IDLE_MS = 24 * 60 * 60 * 1000; // and any room a day after its last move
export const MAX_MS = 7 * 24 * 60 * 60 * 1000; // and every room within a week
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

const other = (color) => (color === 'w' ? 'b' : 'w');

// A random room code. `bytes(n)` gives n random bytes.
export function makeCode(bytes = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  let code = '';
  while (code.length < 6) {
    for (const b of bytes(12)) {
      // 248 is the largest multiple of 31 below 256, so every character is equally likely.
      if (b < 248 && code.length < 6) code += CODE_CHARS[b % 31];
    }
  }
  return code;
}

// A new room with its creator in a seat. `color` is 'w', 'b' or 'random'; `coin` is the color
// 'random' lands on.
export function newRoom({ code, color, clock, token, now, coin }) {
  if (!['w', 'b', 'random'].includes(color)) throw new Error('bad color');
  if (clock !== null && !CLOCKS[clock]) throw new Error('bad clock');
  const mine = color === 'random' ? coin : color;
  const seats = { w: null, b: null };
  seats[mine] = token;
  const [minutes, inc] = clock ? CLOCKS[clock] : [];
  return {
    code,
    created: now,
    last: now,
    seats,
    moves: [],
    result: null,
    reason: null,
    clock: clock ? { name: clock, inc: inc * 1000, w: minutes * 60000, b: minutes * 60000, since: null } : null,
    draw: null,
    gone: { w: null, b: null },
  };
}

export const seatFor = (state, token) => (typeof token === 'string' && token
  ? ['w', 'b'].find((c) => state.seats[c] === token) ?? null
  : null);

// The second player takes the empty seat. A full room turns a third person away.
export function join(state, token, now) {
  const color = ['w', 'b'].find((c) => !state.seats[c]);
  if (!color) return { error: 'full' };
  const next = structuredClone(state);
  next.seats[color] = token;
  next.last = now;
  if (next.clock) next.clock.since = now;
  return { state: next, color };
}

function replay(moves) {
  const chess = new Chess();
  for (const m of moves) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  return chess;
}

// When the side to move runs out of time, or null if no clock is running. Each side's first
// move is free, so the clocks start with White's second move.
export function flagAt(state) {
  if (!state.clock || state.result || state.moves.length < 2) return null;
  const turn = state.moves.length % 2 ? 'b' : 'w';
  return state.clock.since + state.clock[turn] + LAG_MS;
}

function end(state, result, reason) {
  state.result = result;
  state.reason = reason;
  state.draw = null;
}

// The side to move loses if their time ran out before `now`. Returns the new state, or the same
// one if nothing changed.
export function checkTime(state, now) {
  const at = flagAt(state);
  if (at === null || now < at) return state;
  const next = structuredClone(state);
  const turn = next.moves.length % 2 ? 'b' : 'w';
  next.clock[turn] = 0;
  end(next, turn === 'w' ? '0-1' : '1-0', 'time');
  return next;
}

// A player's message. Returns { state } or { error }.
export function handle(state, color, msg, now) {
  if (state.result) return { error: 'over' };
  if (!state.seats.w || !state.seats.b) return { error: 'waiting' };
  const next = structuredClone(state);
  const them = other(color);
  switch (msg?.type) {
    case 'move': {
      if (typeof msg.uci !== 'string' || !UCI.test(msg.uci)) return { error: 'bad-move' };
      const chess = replay(next.moves);
      if (chess.turn() !== color) return { error: 'not-your-turn' };
      if (next.clock) {
        if (next.moves.length >= 2) {
          const left = next.clock[color] - Math.max(0, now - next.clock.since - LAG_MS);
          if (left <= 0) return { state: checkTime(state, now) };
          next.clock[color] = left + next.clock.inc;
        }
        next.clock.since = now;
      }
      try {
        chess.move({ from: msg.uci.slice(0, 2), to: msg.uci.slice(2, 4), promotion: msg.uci[4] });
      } catch {
        return { error: 'bad-move' };
      }
      next.moves.push(msg.uci);
      next.last = now;
      next.draw = null;
      if (chess.isCheckmate()) end(next, color === 'w' ? '1-0' : '0-1', 'checkmate');
      else if (chess.isStalemate()) end(next, '1/2-1/2', 'stalemate');
      else if (chess.isInsufficientMaterial()) end(next, '1/2-1/2', 'material');
      else if (chess.isThreefoldRepetition()) end(next, '1/2-1/2', 'repetition');
      else if (chess.isDrawByFiftyMoves()) end(next, '1/2-1/2', 'fifty');
      return { state: next };
    }
    case 'resign':
      end(next, color === 'w' ? '0-1' : '1-0', 'resigned');
      return { state: next };
    case 'draw': // an offer, or accepting the other player's
      if (next.draw === them) end(next, '1/2-1/2', 'agreed');
      else next.draw = color;
      return { state: next };
    case 'decline':
      if (next.draw !== them) return { error: 'no-offer' };
      next.draw = null;
      return { state: next };
    case 'claim':
      if (next.gone[them] === null || now - next.gone[them] < GONE_MS) return { error: 'not-gone' };
      end(next, color === 'w' ? '1-0' : '0-1', 'abandoned');
      return { state: next };
    default:
      return { error: 'bad-request' };
  }
}

// When the room should be deleted.
export function expiresAt(state) {
  const idle = state.seats.w && state.seats.b ? state.last + IDLE_MS : state.created + OPEN_MS;
  return Math.min(idle, state.created + MAX_MS);
}

// The next time the room has something to do: a flag falling, or closing.
export function nextAlarm(state) {
  const flag = flagAt(state);
  return flag === null ? expiresAt(state) : Math.min(flag, expiresAt(state));
}

// What one player is told. Clock times are as of `now`.
export function view(state, color, now) {
  const turn = state.moves.length % 2 ? 'b' : 'w';
  let clock = null;
  if (state.clock) {
    const running = flagAt(state) !== null ? turn : null;
    const left = (c) => (c === running ? Math.max(0, state.clock[c] - Math.max(0, now - state.clock.since)) : state.clock[c]);
    clock = { name: state.clock.name, w: left('w'), b: left('b'), running };
  }
  const them = other(color);
  return {
    type: 'state',
    code: state.code,
    you: color,
    moves: state.moves,
    result: state.result,
    reason: state.reason,
    draw: state.draw,
    clock,
    waiting: !state.seats.w || !state.seats.b,
    goneFor: state.gone[them] === null ? null : now - state.gone[them],
  };
}
