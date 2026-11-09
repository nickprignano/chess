// The coach. Stockfish on this device checks every move; Claude, through our Worker, writes the
// review and "explain" answers for signed-in family members. Without sign-in, or once the day's
// AI budget is used up, the coach writes shorter notes here on the device from the same checks.
// What goes to the Worker is only the moves (e2e4 form), the engine's checks and the level.

import { Chess } from '../vendor/chess.mjs';

export const LEVELS = ['beginner', 'advanced', 'competition'];
const DEPTH = 10;
const LINE_MOVES = 6;
const BIG_LOSS = 100; // centipawns: a move that gives away about a pawn or more

// Scores past ±20 pawns (mates) count as 20 pawns, so one mate doesn't swamp everything.
export const cap = (s) => Math.max(-2000, Math.min(2000, s));

// Engine checks for a game: for each position (before each move, and the final one), the best
// line and its score for the side to move. `moves` are UCI strings. `progress(i, n)` is called
// as it goes.
export async function analyseGame(engine, moves, progress = () => {}) {
  const chess = new Chess();
  const facts = [];
  for (let ply = 0; ply <= moves.length; ply++) {
    progress(ply, moves.length);
    if (chess.isGameOver()) break;
    const { lines } = await engine.search(chess.fen(), { depth: DEPTH });
    if (lines[0]) facts.push({ ply, line: lines[0].pv.slice(0, LINE_MOVES), score: lines[0].score });
    if (ply < moves.length) chess.move({ from: moves[ply].slice(0, 2), to: moves[ply].slice(2, 4), promotion: moves[ply][4] });
  }
  return facts;
}

// How much each move gave away, in centipawns, from the facts before and after it.
export function losses(facts) {
  const byPly = new Map(facts.map((f) => [f.ply, f.score]));
  const out = new Map();
  for (const [ply, before] of byPly) {
    if (!byPly.has(ply + 1)) continue;
    // The score after is from the other side's view, so the mover's score after is its negative.
    out.set(ply, Math.max(0, cap(before) + cap(byPly.get(ply + 1))));
  }
  return out;
}

// SAN for a UCI line played from the position after `ply` moves of the game.
export function sanLine(moves, ply, line) {
  const chess = new Chess();
  for (const m of moves.slice(0, ply)) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  const out = [];
  for (const m of line) {
    try {
      out.push(chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}

const moveLabel = (ply, san) => `${Math.floor(ply / 2) + 1}${ply % 2 ? '…' : '.'} ${san}`;
const pawns = (cp) => (cp / 100).toFixed(1);

// The note for one move, in the level's words.
function note(level, ply, san, loss, best, score) {
  if (level === 'beginner') {
    if (loss >= 300) return `${san} gave away a lot here. Before each move, check what the other side can capture or attack next. ${best ? `${best} was safer.` : ''}`;
    return `${san} let the other side get ahead a little. ${best ? `${best} was better.` : ''}`;
  }
  if (level === 'advanced') return `${san} lost about ${pawns(loss)} pawns of value. ${best ? `${best} was better.` : ''}`;
  return `${san} (−${pawns(loss)}). Best: ${best ?? '?'} (${score > 0 ? '+' : ''}${pawns(cap(score))}).`;
}

// Free notes made on this device: the biggest mistakes by `side` ('w', 'b', or null for both).
// Returns { summary, moments: [{ ply, label, text }] }, the same shape the AI review has.
export function localReview(moves, facts, level, side) {
  const loss = losses(facts);
  const best = new Map(facts.map((f) => [f.ply, f]));
  const sans = sanLine(moves, 0, moves);
  const picked = [...loss.entries()]
    .filter(([ply, l]) => l >= BIG_LOSS && (!side || (ply % 2 === 0) === (side === 'w')))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .sort((a, b) => a[0] - b[0]);
  const moments = picked.map(([ply, l]) => {
    const f = best.get(ply);
    const bestSan = f ? sanLine(moves, ply, f.line.slice(0, 1))[0] : null;
    return { ply, label: moveLabel(ply, sans[ply]), text: note(level, ply, sans[ply], l, bestSan, f?.score ?? 0) };
  });
  const summary = moments.length
    ? `The ${moments.length === 1 ? 'biggest moment' : `${moments.length} biggest moments`} of the game:`
    : 'No big mistakes found. Well played.';
  return { summary, moments };
}

// Free note for one move, made on this device.
export function localExplain(moves, facts, level, ply) {
  const sans = sanLine(moves, 0, moves);
  const f = facts.find((x) => x.ply === ply);
  const l = losses(facts).get(ply) ?? 0;
  const bestSan = f ? sanLine(moves, ply, f.line.slice(0, 1))[0] : null;
  const text = l >= BIG_LOSS
    ? note(level, ply, sans[ply], l, bestSan, f?.score ?? 0)
    : `${sans[ply]} was a good move${bestSan && bestSan !== sans[ply] ? `; ${bestSan} was about as good` : ''}.`;
  return { summary: '', moments: [{ ply, label: moveLabel(ply, sans[ply]), text }] };
}

// A hint for the side to move, from a two-line search. Beginners get the piece to look at,
// Advanced the move, Competition the top moves with scores. Returns { text, square }.
export async function hint(engine, fen, level) {
  const { lines } = await engine.search(fen, { multipv: 2, depth: DEPTH });
  if (!lines.length) return { text: 'No moves to suggest.', square: null };
  const chess = new Chess(fen);
  const san = (m) => new Chess(fen).move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }).san;
  const from = lines[0].move.slice(0, 2);
  const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  if (level === 'beginner') return { text: `Look at your ${names[chess.get(from).type]} on ${from}.`, square: from };
  if (level === 'advanced') return { text: `Try ${san(lines[0].move)}.`, square: from };
  return { text: lines.map((l) => `${san(l.move)} (${l.score > 0 ? '+' : ''}${pawns(cap(l.score))})`).join(', '), square: from };
}

// Calls the Worker. Returns the parsed reply, or { error } with a reason the page can show.
// Signed-out requests are redirected to the sign-in page by Cloudflare Access, which shows up
// here as an opaque redirect.
export async function callCoach(path, body, fetcher = fetch) {
  let res;
  try {
    res = await fetcher(`/api/coach/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      credentials: 'same-origin',
    });
  } catch {
    return { error: 'offline' };
  }
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) return { error: 'signed-out' };
  let data = {};
  try {
    data = await res.json();
  } catch {
    // Not JSON: treated as the coach being unavailable.
  }
  if (!res.ok) return { error: data.error ?? 'unavailable' };
  return data;
}
