# Chess coach spec (v1)

Status: approved (PR #1), with the owner's answers to the open questions folded in on
2026-11-08. Red-teamed once with Fable (fixes listed at the end). The owner chose to skip the
outside review.

## What it is

A chess app for `chess.prignano.ai` with three parts:

1. **Play the computer at your level.** The opponent plays like a person at your rating, not
   like a perfect engine. It starts from your chess.com rating if you have one, keeps adjusting
   as you play, and offers a "twin" opponent that opens the way you do.
2. **A coach.** It gives hints during the game and a review afterwards. You choose the depth:
   Beginner, Advanced or Competition. Claude writes the explanations, and a chess engine supplies
   the facts.
3. **Live games with a friend.** One player creates a room and shares a 6-character code. The
   other player types it in, and they play in real time.

The app is plain JavaScript, with no build step, served as static files plus one Cloudflare
Worker. It can be installed as a PWA from day one.

## Decisions so far

| # | Question | Answer (owner, 2026-11-08) |
| --- | --- | --- |
| 1 | What "at Claude's level" means | Play at **the user's** level: import their chess.com rating, learn a digital twin of the user, or both |
| 2 | Coaching depth | Adjustable: Beginner (basics), Advanced, Competition (grandmaster style) |
| 3 | Spend cap | $10 a month |
| 4 | Home | `chess.prignano.ai`, from its own public repo (this one), GPL-3, a PWA from day one |
| 5 | Live play | A 6-character room code, reconnect, the server checks every move, no chat, no spectators, no accounts needed |
| 6 | Sign-in | Google sign-in, built with Cloudflare Access (option A below) |
| 7 | Coach model | Claude Sonnet 5.5 (`claude-sonnet-5-5`) |
| 8 | App name | Chess, at `chess.prignano.ai` |
| - | License | GPL-3.0-or-later. Stockfish is GPL-3 and we ship it, so the app has to be GPL-3 too. That is the same as pinball |

## Prior art and licenses

Checked on 2026-11-08 against the npm registry and the projects' own LICENSE files.

| Source | License | What we use |
| --- | --- | --- |
| [chess.js](https://github.com/jhlywa/chess.js) 1.4.0 | BSD-2 | The rules: legal moves, check, mate, draws, FEN and PGN. Used in the browser **and** in the Worker, so both sides agree on what is legal |
| [Stockfish](https://github.com/official-stockfish/Stockfish) via [stockfish.js](https://github.com/nmrugg/stockfish.js) 19.0.1 | GPL-3 | Analysis for the coach (best lines and scores), and the opponent above about 2000. We use the single-threaded "lite" build, so the site needs no cross-origin isolation headers |
| [Maia-2](https://github.com/CSSLab/maia2) (CSSLab, University of Toronto) | MIT (code); weights **unverified** | The human-like opponent. One model covers every rating level (roughly 1100 to 2000 Lichess): you pass the rating in, and it predicts the move a person at that rating would play. A Lichess blog post describes running it in the browser with ONNX Runtime Web. Weights with no stated license can't be redistributed, so a one-day spike runs before build 2: confirm the weights license, export to ONNX, shrink it to int8, and measure it on an iPhone. If any of those fails, we use the fallback below |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | MIT | Runs Maia in the browser |
| [cm-chessboard](https://github.com/shaack/cm-chessboard) | MIT | Possibly the board UI. A plain SVG board we write ourselves is the default. We'll choose during build 1 |
| [chessground](https://github.com/lichess-org/chessground) | GPL-3 | Not used. It is a TypeScript package that expects a bundler |
| lila-stockfish-web | AGPL-3 | Not used. AGPL adds network obligations we don't need |
| [Iamsdt/chess](https://github.com/Iamsdt/chess) | not checked | A similar idea (Stockfish plus LLM coaching). Ideas only, after a license check |
| [chess.com Published-Data API](https://www.chess.com/news/view/published-data-api) | terms | Read-only public ratings and monthly PGN archives, with no key needed. Its terms say to respect chess.com's board colors, piece designs, sounds and **move classification glyphs**, so we draw all of our own |

Our own art and sound: an original SVG piece set and board in prignano-theme colors that follow
light and dark mode, plus our own short move, capture and check sounds. The app is called
Chess.

## How it works

### The opponent: playing at your level

**Engines.** Both engines run on the player's device in Web Workers, so a move against the
computer costs nothing and works offline.

- From about 1100 to 2000 Lichess (roughly 700 to 1700 on chess.com, so most kids are
  covered), Maia-2 picks the move at your rating. Maia's moves look human because it learned
  from millions of human games. It sometimes misses tactics, which is the point.
- **Fallback if Maia fails the spike:** Stockfish with MultiPV, picking among its top moves at
  random, weighted toward the best by an amount tuned to your rating. It is less human but
  ships with no extra download. Maia-1's per-rating networks are a second option, after their
  own license check.
- Only one engine is loaded at a time, and workers are shut down between games, so older
  iPhones stay under their memory limit.
- Below Maia's range, Stockfish plays at a low "Skill Level". Above it, Stockfish plays with
  `UCI_LimitStrength` and `UCI_Elo` set (range 1320 to 3190). This is less human, but it is
  honest about strength.
- For the first few moves, an opening book stops the neural model from playing odd opening
  moves. The book comes from your own games (see "Twin") or from a small built-in book file.
  It never calls a third-party API.

**Build 2 result (2026-11-08).** The Maia spike stopped at its first step: Maia-2's code is
MIT, but its weights are downloaded from Google Drive (and Maia-3's from Hugging Face) with no
license of their own that we could confirm, so build 2 ships the Stockfish MultiPV fallback.
Below 2000 it picks among Stockfish's top 4 to 10 moves, weighted by a rating-set temperature;
from 2000 up it uses `UCI_Elo`. That one picker covers the low ratings too, so there is no
separate "Skill Level" range, and there is no built-in book (the twin's book is the only one).
Maia can replace the picker later in `src/opponent.js` once its weights license is confirmed.
Ratings use the Lichess rapid scale. The chess.com import runs straight from the browser, and
history, the twin and settings are kept in localStorage (small enough; IndexedDB isn't needed
yet). The placement game is the first 10 games, which move your rating quickly. The style
card is built in build 3, with the coach that uses it.

**Your starting level.** There are three ways to set it:

1. **chess.com import.** You type your chess.com username. The Worker fetches
   `/pub/player/{username}/stats` with a recognizable User-Agent (no personal email in it).
   The route only accepts usernames that match chess.com's character rules, is rate limited
   per IP, and caches by username for 12 hours, so it can't be used as an open proxy. It
   reads your rapid rating, or blitz if you have no rapid rating, and maps it to our internal
   rating with **separate rapid and blitz tables** from a published comparison (cited in the
   code). The mapping is approximate, and the app says so. If the build finds the API allows
   calls straight from the browser, a direct fetch is simpler and keeps usernames off our server.
2. **Pick a level** from five plain-language bands, for new players.
3. **Play a placement game**, where the opponent adjusts as it goes.

**Adapting.** After every game, the app updates your rating with Glicko-2, and the next
opponent follows it. A rating that has been set by hand moves faster for its first 10 games.

**Twin ("plays like you").** v1 builds a twin from data, not a trained network:

- **Opening book:** your last 6 months of chess.com games (monthly PGN archives), plus the games
  you play in the app, become a tree of the moves you actually play, weighted by how often you
  play them. The twin follows that tree, then hands over to Maia at your rating.
- **Style card:** a short summary the coach can use, such as your favourite openings, the game
  phase where you tend to go wrong, and how often you lose on time. It is built by Stockfish
  analysis on the device, capped at the 50 most recent games.
- **Not in v1:** training a personal network on your games. Research does this (personalised
  Maia), but it needs thousands of games and a GPU. We can revisit it later.
- **Said plainly in the app:** the twin "opens like you, then plays like a typical player at
  your rating". It is not a copy of you.

The twin and your game history stay **on your device** (IndexedDB). Safari can clear site
storage, so settings has a PGN export and import. See "Privacy" for what the account holds.

### The coach

The coach has three levels, chosen in settings and changeable at any time. The level sets how
the coach talks. It does not change how strong the opponent is.

**Where Claude is used (changed after the red team):** hints during the game are built on the
device from Stockfish facts and templates written for each level. They are free and instant.
Claude writes the **post-game review** and answers an **"Explain this move"** tap, up to 5 taps
a game. That puts the spend where Claude adds the most, and keeps the $10 well clear.

| Level | During the game | After the game |
| --- | --- | --- |
| Beginner | One idea at a time, in plain words: "your knight can be taken", "castle to keep your king safe". No notation unless you tap for it | The 3 biggest moments, each with what happened and the one habit that would have helped |
| Advanced | Names the tactic or plan (pin, fork, weak square, pawn break), shows a short line | Mistakes and missed chances, with a short line for each, plus your opening's main idea |
| Competition | Candidate moves with engine scores, terse. Hints are off by default; ask for them | A full annotated review: score graph, critical moments, better lines, opening name and alternatives |

**What Claude sees.** The Worker builds every request from **structured data only**, so nothing
the browser sends can carry instructions:

- The game is a list of moves in coordinate form (`e2e4`), at most 300 half-moves. The Worker
  replays it with chess.js and rejects anything illegal. PGN headers and comments are never
  accepted.
- Stockfish facts are worked out on the device to save Worker CPU, but each one must be a move
  line that the Worker replays from the stated position, plus a whole-number score within a
  set range. Anything else is dropped.
- The style card is a fixed schema: opening codes (ECO), percentages and set values from a
  short list. It holds no free text.
- The level is one of three values.

**What Claude never sees:** free text from the user (there is no chat box), names, emails,
chess.com usernames or any account details.

**Output** goes through a JSON schema (text with a length cap, plus optional arrows and
squares to highlight), so the app renders it as plain text and nothing in it runs as code. The
review is labelled "written by AI".

**Without Claude:** when the player isn't signed in, or the budget is used up, the coach falls
back to free notes generated on the device from Stockfish ("this loses a bishop: Bxf7 was
better"). These are shorter, but the app still works.

### Sign-in

Sign-in uses Google. Of the two ways to build it, the owner chose **A**:

- **A. Cloudflare Access on `/coach/*` and `/api/coach` only (chosen).** The owner's family app already
  uses Access. It is free for up to 50 users, Google is the sign-in provider, and the policy
  is an email allowlist the owner edits in the dashboard. Access can also offer a one-time code by
  email, for a child whose Google account can't sign in to other sites. The Worker checks the
  Access token on every coach call. We write no sign-in code and store no account table.
- **B. Google Identity Services in the page** (not chosen, kept for the record), like that app's own sign-in. The Worker checks the
  ID token (audience, `email_verified`, email in lower case) and sets an HttpOnly, Secure,
  SameSite=Lax session cookie, limited to `/api` and lasting 7 days. The allowlist is checked
  on every request, not only at sign-in, so removing someone takes effect at once.

Either way:

- **Who needs it:** only the Claude coach. Playing the computer, importing a rating, the twin
  and live games all work without an account.
- **Who may use the coach:** a closed allowlist that the owner controls, never in the repo. It stays
  closed. Opening it to any Google user would let strangers spend the $10, and would mean
  knowingly serving children we have no consent for.
- **Children under 13** use the coach through a parent's sign-in on a family device, or the
  email code in option A with the parent's address. Nothing asks for or records a child's age.
- **What is stored:** for usage counters, a key derived from the account (hashed with a secret
  salt). That key is still a persistent identifier, so we treat it as personal data. We keep
  it only as long as the counters need it, and "Delete my data" removes it. No email, name or
  photo is stored.
- **Known gaps:** Google blocks sign-in inside embedded web views, and sign-in inside the iOS
  home-screen app hasn't been tested on a device (a known gap in the owner's family app). Children's Google
  accounts managed with Family Link may not be allowed to "Sign in with Google" on a third-party
  site, depending on the parent's settings. If they can't, a child plays as a guest and uses the
  coach on a parent's signed-in device.

### Spend and abuse controls

Five layers, the first being the hard stop:

1. **Anthropic workspace spend limit of $10 a month**, on a workspace used only for this app.
   the owner sets it in the Claude Console. It stops spending even if everything else fails.
2. **A Worker budget** in a Durable Object. Before each call it **reserves** the worst case
   (`max_tokens` and the input size at list price), then settles the real cost from the
   response's `usage` field. That way, many requests sent at once can't all slip under the
   cap. It stops Claude calls for the day at $0.33 and for the month at $9. If the budget
   object can't be reached, the coach turns off; it never fails open. After a stop, the coach
   uses the free on-device notes.
3. **Per-user limits:** 2 reviews and 5 "explain" taps a day per account (about $0.09 on
   Sonnet 5.5, so 3 people at their maximum fit in a day), enforced by the
   Durable Object counters, which are the real limit. The Workers Rate Limiting binding sits in
   front as a cheap first filter (it is best effort per data center). The per-user limits are
   set so that several allowlisted users at their maximum fit under the daily cap. If the
   allowlist grows past what fits, the daily cap still holds and later users that day get the
   free on-device notes.
4. **Bounded requests:** `max_tokens` is capped on every call, and the input is a game record
   of at most 300 half-moves, so no single call can cost much.
5. **The API key lives only in a Worker secret** (`ANTHROPIC_API_KEY`), following ai-brain
   decision 0016. It is never in the repo, a claude.ai environment or chat. The owner puts it there
   themselves, and it is rotated new-then-revoke.

**Cost per call** (Anthropic list prices from the skill's price table, dated 2026-10-06),
assuming about 2,000 tokens in and 300 out for an "explain" tap, and about 6,000 in and 1,500
out for a review. The fixed coach instructions are cached, which cuts input cost further. The
build checks cache prices against Anthropic's live pricing page.

| Model | Explain | Review | Daily cap ($0.33) covers |
| --- | --- | --- | --- |
| Haiku 5.5 ($0.10 / $0.50 per million) | $0.0004 | $0.0014 | about 230 reviews |
| Sonnet 5.5 ($2 / $10) | $0.007 | $0.027 | about 12 reviews |
| Opus 5.5 ($4 / $20) | $0.014 | $0.054 | about 6 reviews |

The owner chose Sonnet 5.5 for its writing, so a day's cap covers about 12 reviews, or a
mix of reviews and "explain" taps. Anthropic keeps API inputs and outputs for about 30
days by default and does not train on them; the privacy page says so.

### Live games with a friend

These run on a Cloudflare Durable Object, one per room, using the WebSocket Hibernation API so an
idle room costs nothing.

- **Create:** `POST /api/rooms` (rate limited per IP) returns a 6-character code drawn from 31
  unambiguous letters and digits (about 887 million codes), and a secret seat token. The code
  is written to KV with a time limit.
- **Lookup first:** `/ws/:code` checks KV and returns "no such room" **before** touching a
  Durable Object, so guessed codes never wake or create a room.
- **Message limits:** each socket may send a few messages a second and at most 1,000 per game;
  past that it is closed. One player can't burn the shared Workers quota that the coach
  budget also runs on.
- **Join:** the second player enters the code and gets their own seat token. Colors are random
  or chosen by the creator. A third person is turned away, because there are no spectators in
  v1.
- **Reconnect:** each browser keeps its seat token in `localStorage`. Coming back with it
  restores the seat and the full game, and closes any older socket using the same token.
- **The server is the referee:** it holds the game in Durable Object storage (not memory, which
  is lost when the room sleeps), checks every move with chess.js, and rejects moves made out of
  turn or illegal ones.
- **Clocks** (default off; 5+3, 10+5 or 15+10 when on) are stored as timestamps, with an alarm
  for when a flag falls. They keep running while a player is disconnected, so disconnecting
  doesn't buy time. Each move gets a small lag allowance (0.3 seconds).
- **End of game:** checkmate, draw, resignation, draw by agreement, or a clock running out. A
  player who stays disconnected for 3 minutes can be claimed as having lost.
- **Expiry:** a room is deleted 24 hours after its last move, or 1 hour after creation if no one
  joins, using Durable Object alarms. Nothing about it is kept.
- **Abuse:** there is no chat and there are no names; players show as White and Black with a
  piece icon. Wrong codes are rate limited per IP, which stops someone guessing their way into
  rooms. A full room can't be joined.
- **Cheating:** the app can't stop a player from using an engine in another tab. These are
  friendly games, so hints, the coach and analysis are switched off in live rooms on the client,
  and the app says plainly that this is honour-based.

### Privacy (kids may play)

- No analytics, ads, trackers or third-party scripts. The prignano-theme header loads from
  jsDelivr pinned to a commit SHA, as pinball does (its file holds personal details, so we don't
  copy it into this repo), plus a subresource integrity hash, which pinball doesn't have yet. It is cached for offline use. A
  Content-Security-Policy header lists the only allowed sources. Sign-in runs on Cloudflare
  Access's own page, so the app loads no Google script.
- Game history, the twin and settings stay on the device. "Delete my data" in settings clears
  them, and also deletes the account record from the Worker if the player is signed in.
- The Worker keeps no game records or request logs. Rate-limit keys are hashed IPs that expire.
  Workers observability stays off, or is kept to error counts only.
- Claude API: Anthropic does not train on API data by default, and keeps it for a limited time
  under its policy. Claude receives only the game and the level, never anything identifying.
- A short privacy page in plain language says all of this.
- Coach prompts follow Anthropic's usage policy for products that minors may use: chess only,
  age-appropriate, and no open-ended conversation.

### Files

```
index.html, styles.css, manifest.webmanifest, sw.js, icons/
src/board.js        SVG board, drag and tap to move, arrows, highlights
src/game.js         game state on top of chess.js, PGN save and load
src/engines/        stockfish-worker.js, maia-worker.js, opponent.js (level -> engine)
src/rating.js       Glicko-2, chess.com mapping
src/twin.js         opening tree and style card from PGN
src/coach.js        calls /api/coach, falls back to local notes
src/live.js         room create/join, WebSocket, reconnect
src/store.js        IndexedDB
vendor/             chess.js, stockfish lite (js + wasm), onnxruntime-web, maia model, all pinned
worker/index.js     routes: /api/auth, /api/coach, /api/chesscom, /api/rooms, /ws/:code
worker/room.js      Durable Object: one live game
worker/budget.js    Durable Object: spend and usage counters
worker/auth.js      Google ID token check, session cookie
wrangler.jsonc
test/               node --test: rules glue, rating, twin, coach request builder, room logic, budget
                    (Durable Object tests run under wrangler dev / miniflare)
```

**GPL notices:** an About screen shows the license, credits and links to the source (GPL-3
§5d). For the Stockfish build we ship, it links the exact stockfish.js release tag and its
source, because shipping a WebAssembly binary means offering that build's source too. The
license stays GPL-3.0-or-later; Stockfish allows that, and the BSD and MIT pieces fit under it.

**Worker CPU:** the free plan allows 10 ms of CPU per request. Replaying a 300-move game may
come close, so build 3 measures it. If it is too slow, we cut the game length or move to the
$5 Workers Paid plan, which needs the owner's yes.

**PWA:** follows the pinball recipe (pinball PR #7 and the ai-brain installable-web-app prompt):
a manifest, icons, and a cache-first service worker with a content-hash version that a test
keeps fresh. The engine files are big (Stockfish lite is several MB, and Maia may be bigger),
so they're cached the first time they're used rather than when the app installs.

## Build plan

Fewer, larger PRs:

1. **Board and rules:** board, pieces, sounds, two players on one device, PGN, PWA, deploy to
   `chess.prignano.ai`.
2. **Opponents:** Stockfish and Maia workers (or the fallback), levels, chess.com import,
   Glicko-2, twin opening book, PGN export. Before this PR opens: run the Maia spike.
3. **Coach:** Worker, Google sign-in, allowlist, coach endpoint, budget and limits, on-device
   fallback notes, privacy page.
4. **Live games:** room Durable Object, codes, reconnect, clocks.

The owner's steps (each one is a few clicks in a dashboard): create the repo (done), create an
Anthropic workspace with a $10 limit and put its key in the Worker secret, set up Cloudflare
Access with Google as the sign-in provider (it needs a Google OAuth client ID) and an email
allowlist policy on the coach paths, and
add the custom domain.

## Answers to the open questions (owner, 2026-11-08)

1. **Coach model:** Sonnet 5.5.
2. **Sign-in build:** A, Cloudflare Access with Google plus an email-code fallback.
3. **App name:** Chess, at `chess.prignano.ai`.
4. **Outside review:** skipped by the owner.

## Fable red team (2026-11-08): what it found and what changed

| Finding | Change |
| --- | --- |
| The budget was checked after each call, so parallel calls could overspend; on Sonnet one user's limits exceeded the daily cap | Reserve the worst case before each call, fail closed, Claude only for reviews and "explain" taps, per-user limits sized to fit |
| The style card and Stockfish facts could carry prompt injection | Structured data only: replayed move lines, scores in range, a fixed-schema style card, output through a JSON schema |
| Maia-2's weights license and size were unverified, with no fallback | A spike before build 2, a written Stockfish MultiPV fallback, one engine loaded at a time |
| Guessed room codes and message spam could use up the shared Workers quota | KV lookup before any room wakes, per-socket message limits, coach off if the budget can't be reached |
| A hashed Google ID is still personal data; an open allowlist means knowingly serving children | Closed allowlist kept, children use a parent's sign-in, the hash is treated as personal data and deletable |
| Removing someone from the allowlist didn't end their session | Checked on every request, 7-day sessions |
| GPL compliance for the shipped Stockfish binary | About screen with notices and a link to the exact source |
| The jsDelivr header and the missing CSP | Pinned SHA with an integrity hash, a CSP header |
| The chess.com route could be used as an open proxy | Username check, per-IP limit, cache |
| Room state and clocks under hibernation weren't specified | State in storage, timestamp clocks with alarms, clocks run while disconnected |
| iOS memory and Safari clearing storage | One engine at a time, PGN export |
| Rating mapping and how honest the "twin" claim is | Separate rapid and blitz tables, plain wording in the app |
| Simpler sign-in | Cloudflare Access offered as option A |
