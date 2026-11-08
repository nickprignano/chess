// Your rating: Glicko-2 after every game against the computer, starting from a level you pick
// or your chess.com rating. The app's ratings are on the Lichess rapid scale, which is also
// the scale human-move models use.

// Glicko-2, from Glickman's paper "Example of the Glicko-2 system" (glicko.net/glicko/glicko2.pdf).
const SCALE = 173.7178;
const TAU = 0.5;

// One rating period. `games` is a list of { rating, rd, score } for each opponent (score 1, 0.5
// or 0). Returns the new { rating, rd, vol }.
export function glicko2({ rating, rd, vol }, games) {
  const mu = (rating - 1500) / SCALE;
  const phi = rd / SCALE;
  let vInv = 0;
  let sum = 0;
  for (const o of games) {
    const g = 1 / Math.sqrt(1 + (3 * (o.rd / SCALE) ** 2) / Math.PI ** 2);
    const e = 1 / (1 + Math.exp(-g * (mu - (o.rating - 1500) / SCALE)));
    vInv += g * g * e * (1 - e);
    sum += g * (o.score - e);
  }
  const v = 1 / vInv;
  const delta = v * sum;

  // New volatility (step 5, the Illinois method).
  const a = Math.log(vol * vol);
  const f = (x) => (Math.exp(x) * (delta ** 2 - phi ** 2 - v - Math.exp(x))) / (2 * (phi ** 2 + v + Math.exp(x)) ** 2) - (x - a) / TAU ** 2;
  let A = a;
  let B;
  if (delta ** 2 > phi ** 2 + v) {
    B = Math.log(delta ** 2 - phi ** 2 - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > 1e-6) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const newVol = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi ** 2 + newVol ** 2);
  const newPhi = 1 / Math.sqrt(1 / phiStar ** 2 + 1 / v);
  return { rating: 1500 + SCALE * (mu + newPhi ** 2 * sum), rd: newPhi * SCALE, vol: newVol };
}

// The computer's rating is what it was set to, so it counts as well known.
const COMPUTER_RD = 50;
// A rating set by hand moves faster for its first 10 games; after that it settles but never
// stops adjusting.
const FAST_GAMES = 10;
const FAST_RD = 200;
const MIN_RD = 50;

// A new player record from a starting rating. `rd` says how sure we are of it.
export function startingPlayer(rating, rd) {
  return { rating, rd, vol: 0.06, games: 0 };
}

// The player after one game against the computer at `opponent` (score 1 win, 0.5 draw, 0 loss).
export function afterGame(player, opponent, score) {
  const next = glicko2(player, [{ rating: opponent, rd: COMPUTER_RD, score }]);
  const games = player.games + 1;
  const floor = games < FAST_GAMES ? FAST_RD : MIN_RD;
  return { rating: Math.round(Math.min(3000, Math.max(400, next.rating))), rd: Math.max(floor, next.rd), vol: next.vol, games };
}

// Five plain-language levels for new players.
export const LEVELS = [
  { name: 'New to chess', rating: 800 },
  { name: 'I know how the pieces move', rating: 1100 },
  { name: 'I play now and then', rating: 1400 },
  { name: 'I play a lot', rating: 1700 },
  { name: 'Club or tournament player', rating: 2000 },
];

// chess.com to the app's scale, from the ChessGoals rating comparison table (chessgoals.com/
// rating-comparison, updated July 2026). Rapid and blitz have their own tables; both map to
// Lichess rapid. Approximate, and the app says so.
const FROM_RAPID = [[815, 1290], [905, 1360], [995, 1425], [1085, 1490], [1170, 1555], [1255, 1615], [1340, 1680], [1420, 1740], [1500, 1795], [1580, 1850], [1655, 1905], [1730, 1960], [1800, 2015], [1870, 2065], [1935, 2115], [1995, 2165], [2110, 2260], [2215, 2355], [2300, 2445], [2375, 2530], [2430, 2615]];
const FROM_BLITZ = [[500, 1290], [600, 1360], [700, 1425], [800, 1490], [900, 1555], [1000, 1615], [1100, 1680], [1200, 1740], [1300, 1795], [1400, 1850], [1500, 1905], [1600, 1960], [1700, 2015], [1800, 2065], [1900, 2115], [2000, 2165], [2200, 2260], [2400, 2355], [2600, 2445], [2800, 2530], [3000, 2615]];

// Straight lines between table rows, carried on past both ends.
function interpolate(table, x) {
  let i = 1;
  while (i < table.length - 1 && x > table[i][0]) i++;
  const [x1, y1] = table[i - 1];
  const [x2, y2] = table[i];
  return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
}

// The app rating for a chess.com rapid or blitz rating.
export function fromChessCom(rating, kind) {
  const r = interpolate(kind === 'blitz' ? FROM_BLITZ : FROM_RAPID, rating);
  return Math.round(Math.min(3000, Math.max(400, r)));
}
