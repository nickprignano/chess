// How the computer plays at a given rating (the app's rating, on the Lichess rapid scale).
//
// Below 2000 it asks Stockfish for its top few moves and picks one at random, weighted toward
// the best by an amount set by the rating: a low rating spreads its picks over more and worse
// moves, a high one nearly always plays the best. From 2000 up, Stockfish's own strength limit
// (UCI_Elo) plays instead. The spec planned Maia, a network trained on human games, for the
// middle range; its weights have no stated license yet, so this is the spec's fallback.

const LIMIT_FROM = 2000;

// Search settings for a rating.
export function searchFor(rating) {
  if (rating >= LIMIT_FROM) return { elo: Math.min(3190, Math.max(1320, Math.round(rating))), movetime: 600 };
  return {
    multipv: rating < 1000 ? 10 : rating < 1400 ? 6 : 4,
    depth: rating < 1200 ? 6 : rating < 1600 ? 8 : 10,
  };
}

// How many centipawns of loss make a move about e (2.7) times less likely than the best.
export function temperature(rating) {
  const points = [[400, 300], [1000, 150], [1500, 70], [2000, 25]];
  if (rating <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [r1, t1] = points[i - 1];
    const [r2, t2] = points[i];
    if (rating <= r2) return t1 + ((t2 - t1) * (rating - r1)) / (r2 - r1);
  }
  return points[points.length - 1][1];
}

// Picks among the engine's scored moves. `random` returns a number in [0, 1).
export function pickMove(lines, rating, random = Math.random) {
  if (!lines.length) return null;
  const best = Math.max(...lines.map((l) => l.score));
  const t = temperature(rating);
  const weights = lines.map((l) => Math.exp(-(best - l.score) / t));
  let r = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lines.length; i++) {
    r -= weights[i];
    if (r < 0) return lines[i].move;
  }
  return lines[lines.length - 1].move;
}

// The computer's move: one engine search, then a pick for the rating.
export async function chooseMove(engine, fen, rating, random = Math.random) {
  const settings = searchFor(rating);
  const { best, lines } = await engine.search(fen, settings);
  return settings.elo ? best : pickMove(lines, rating, random) ?? best;
}
