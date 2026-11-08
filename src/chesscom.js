// Reads public data from chess.com's Published-Data API (no key, read-only). The browser asks
// chess.com directly, so your username never reaches our server. Requests go one at a time,
// which the API allows without limits.

const API = 'https://api.chess.com/pub/player/';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';

// chess.com usernames: 3 to 25 letters, digits, "_" or "-".
export function cleanUsername(text) {
  const name = text.trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,25}$/.test(name)) throw new Error('That doesn’t look like a chess.com username.');
  return name;
}

async function get(url, fetcher) {
  let res;
  try {
    res = await fetcher(url);
  } catch {
    throw new Error('Couldn’t reach chess.com. Check your connection, or pick a level instead.');
  }
  if (res.status === 404) throw new Error('chess.com has no player with that username.');
  if (!res.ok) throw new Error(`chess.com didn’t answer (error ${res.status}). Try again later.`);
  return res.json();
}

// Your rapid rating, or blitz if you have no rapid rating: { rating, kind }.
export async function fetchRating(username, fetcher = fetch) {
  const stats = await get(`${API}${username}/stats`, fetcher);
  const rapid = stats.chess_rapid?.last?.rating;
  if (rapid) return { rating: rapid, kind: 'rapid' };
  const blitz = stats.chess_blitz?.last?.rating;
  if (blitz) return { rating: blitz, kind: 'blitz' };
  throw new Error('That player has no rapid or blitz rating on chess.com yet. Pick a level instead.');
}

// Your standard-chess games from the last `months` monthly archives, as { pgn, color }.
export async function fetchGames(username, months = 6, fetcher = fetch) {
  const { archives = [] } = await get(`${API}${username}/games/archives`, fetcher);
  const games = [];
  for (const url of archives.slice(-months)) {
    const month = await get(url, fetcher);
    for (const g of month.games ?? []) {
      if (g.rules !== 'chess' || !g.pgn || (g.initial_setup && !g.initial_setup.startsWith(START))) continue;
      const color = g.white?.username?.toLowerCase() === username ? 'w' : g.black?.username?.toLowerCase() === username ? 'b' : null;
      if (color) games.push({ pgn: g.pgn, color });
    }
  }
  return games;
}
