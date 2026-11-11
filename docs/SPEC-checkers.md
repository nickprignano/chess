# Checkers and Chinese checkers spec (v1)

Status: approved by the owner on 2026-11-11, with every draft answer below taken as the
decision. Not yet red-teamed. Nothing is built until it is the one active build.

## What it is

Two more games inside the Chess app at `chess.prignano.ai`, picked in **New game** next to chess:

1. **Checkers.** 8x8 board, 12 pieces a side, the common American / English rules.
2. **Chinese checkers.** The six-pointed star board with 121 holes, 10 marbles a side, two players
   in v1.

Each can be played against the computer on your device or against a friend in a live room, the
same as chess. The app keeps its name, icon and address. It stays an installable PWA that works
offline, with no new third-party code.

## Decisions

| # | Question | Answer (owner, 2026-11-11) |
| --- | --- | --- |
| 1 | Does a spec for this already exist in the owner's other project? | No; this is the spec |
| 2 | Chinese checkers player count | **2 players** in v1, vs the computer or a friend. 3 and 6 players (with computer players filling seats) later, because live rooms have two seats today |
| 3 | Claude coach for the new games | **Not in v1.** Hints and a short review come free from the on-device engine. A Claude review needs new replay and fact checks in the Worker, which can come later under the same spend controls |
| 4 | Ratings | **Not rated.** You pick one of five levels for each game. Your chess rating and twin stay chess-only |
| 5 | App name | Stays **Chess**. A rename (for example to a board-games name) would touch the domain, the manifest and the games list, so it is a separate decision |

## Rules

### Checkers

- 8x8 board, play on the dark squares, Black (shown in the app's dark piece color) moves first.
- Men move one square diagonally forward; kings move one square diagonally either way.
- **Captures are forced.** If a capture is available you must take one, and you must keep jumping
  with the same piece while you can. You may choose which capture sequence, not only the longest.
- A man reaching the far row becomes a king and its turn ends there, even mid-jump.
- **End:** you win when the other side has no pieces or no legal move. Draw by agreement, by
  threefold repetition, or after 40 moves by each side with no capture and no man moved (an app
  rule, said in the rules screen).
- Resign and undo work as in chess.

### Chinese checkers

- Star board of 121 holes. The two players start in opposite points of the star, 10 marbles each.
- A turn is either one step to a neighbouring empty hole, or a chain of hops over a single marble
  (either color) into the empty hole straight beyond it. A chain may stop after any hop. Nothing is
  captured.
- **Win:** fill the opposite point with your marbles first.
- **Anti-blocking rule:** a marble the other player never moves out of your target point doesn't
  stop you. If every hole of your target point is filled, and at least one of them holds your
  marble, you win.
- **Stall rule:** after 100 moves each, a player with marbles still in their own starting point
  loses. This stops a player from never leaving home to block the other side.
- No draws except by agreement.

## How it works

### Rules code

Each game gets its own small rules module with no DOM in it, so Node tests run it and the
Worker imports the same file to referee live rooms (the way chess.js is shared today):

- `src/checkers.js`: board, legal moves including forced multi-jumps, status, undo, a move
  notation of square numbers 1 to 32 (`11-15`, `22x15x8` for a double jump), which is the
  usual way to write checkers moves.
- `src/halma.js` (Chinese checkers): board as axial hex coordinates, legal steps and hop chains,
  win and stall checks. Moves are written as a list of hole numbers.

We write these ourselves. Both games are small, and no checked library is worth the license and
size review.

### The computer

Stockfish only plays chess, so each game gets a small search of its own, run in a Web Worker like
Stockfish so the page never freezes:

- **Checkers:** alpha-beta search with forced-capture extension. Scores count men, kings
  (worth about 1.5 men), advancement and the back row. Five levels set the search depth (2 to 10
  plies) and how often it plays a weaker move among its top few, the same "weighted pick among
  the top moves" idea the chess opponent uses below 2000.
- **Chinese checkers:** a search 1 to 3 plies deep over a score that sums how far each marble
  still has to travel, with a bonus for long hop chains and a penalty for stragglers. Hop chains
  make the move list large, so moves are pruned to the best few dozen before searching deeper.
  Five levels, as above.
- One engine is loaded at a time, and it is shut down between games, as in the chess spec.

### Board and pieces

- **Checkers** reuses the 8x8 SVG board in `src/board.js` with new piece drawings (a flat disc,
  and a disc with our own crown mark for a king), in the existing light and dark piece colors.
  Tap, drag and keyboard moves work as now. A multi-jump is played one hop at a time, and the
  board only offers the squares a forced capture allows.
- **Chinese checkers** gets its own SVG board (`src/starboard.js`): the star of holes in theme
  colors, the two points tinted, and marbles in the two piece colors. Tap a marble, then tap each
  hole of the hop chain, then tap the marble again (or a "Done" button) to end the turn early. The
  holes you can reach are marked. Keyboard play moves a cursor between holes.
- Sounds reuse the app's own move and capture sounds. All art is original.

### New game, save and load

- **New game** gets a first choice: Chess, Checkers or Chinese checkers. The rest of the dialog
  (computer or friend, your color) stays the same, except that the twin is chess-only and the
  level comes from a five-level picker per game.
- The current game is kept in localStorage as now, with the game type saved alongside, so a
  reload continues it.
- **Save and load** stay PGN for chess. For checkers and Chinese checkers, v1 has no file save;
  the menu hides those buttons while one of them is open. (Checkers has a standard file format,
  PDN, which we can add later if wanted.)

### Live games

- Creating a room adds one field, the game type. Codes, seat tokens, reconnect, rate limits,
  message limits, expiry and the no-chat, no-names rules are unchanged.
- `worker/rooms.js` keeps one referee per game type: chess.js for chess, and the new rules modules
  for the other two. Each checks every move, rejects illegal or out-of-turn moves and decides how
  the game ended, as now.
- Clocks work the same for all three games.
- The join box shows which game the room is for before you join.

### Coach

- **Hints:** the on-device engine marks the best move when you tap Hint, as chess does. Free and
  instant. Hints are off in live rooms, as now.
- **Review:** after the game, the engine lists the 3 moves where you lost the most, each with the
  better move shown on the board and one templated sentence ("this let White jump two pieces";
  "a longer hop chain was here"). Labelled as engine notes, not AI.
- **No Claude in v1** (decision 3). Nothing new reaches the Worker's coach route, so the spend
  controls, allowlist and structured-only input stay exactly as they are.

### Privacy

No change: no accounts for these games, no analytics, nothing new stored on the server except
the game type in a live room, which is deleted with the room.

## Files

```
src/checkers.js      checkers rules (shared with the Worker)
src/halma.js         Chinese checkers rules (shared with the Worker)
src/draughts-ai.js   checkers search, in a Web Worker
src/halma-ai.js      Chinese checkers search, in a Web Worker
src/starboard.js     the star board
src/pieces.js        adds the checker and crown drawings
src/board.js         small changes so the 8x8 board can show checkers pieces
src/main.js          game picker, levels, hiding chess-only menu items
worker/rooms.js      game type per room, one referee per type
test/                checkers rules, Chinese checkers rules, both searches, rooms per game type
```

## Build plan

Two PRs, after the build that is active now is finished:

1. **Checkers:** rules, engine, board pieces, game picker, vs computer, live rooms, hints and
   engine review.
2. **Chinese checkers:** rules, engine, star board, vs computer, live rooms, hints and review.

Each PR runs `node tools/sw-version.mjs` and `node --test`, and is played on a phone through the
installed app before it merges.

## Not in v1

Claude reviews for the new games, ratings and a twin for them, Chinese checkers with 3 to 6
players, international (10x10) checkers and other rule variants, and checkers file save and load.
