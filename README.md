# Chess

Open-source chess in the browser, for `chess.prignano.ai`. Plain JavaScript and SVG, with no
build step: the repo is the site. It installs as an app on phones and computers and works
offline.

What works now: play the computer at your level (Stockfish, on your device), a twin that opens
the way you do, or a friend on the same device. Your rating starts from a level you pick or
your chess.com rating and adjusts after every game (Glicko-2). Every rule, undo, flip, and
saving or loading games as PGN. Coming next, in order: a coach, and live games with a friend
over a room code. The plan is in [docs/SPEC.md](docs/SPEC.md).

## Run it locally

Serve the folder with any static server, for example `npx http-server -c-1 .`, and open the
address it prints. Opening `index.html` as a file doesn't work, because browsers block ES
modules from `file://`.

## Checks

```bash
node --test
```

After changing any file the app serves, run `node tools/sw-version.mjs` so the installed app
picks up the new version (a test fails if you forget). After changing `icons/icon.svg`, run
`node tools/make-icons.mjs` (needs Playwright).

## License

GPL-3.0-or-later (see [LICENSE](LICENSE)). The rules come from
[chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause, [vendor/chess.LICENSE](vendor/chess.LICENSE)).
The computer player is [Stockfish](https://github.com/official-stockfish/Stockfish) (GPL-3.0),
from [Stockfish.js 19.0.1](https://github.com/nmrugg/stockfish.js/tree/v19.0.1), the lite
single-threaded build, unchanged ([vendor/stockfish/COPYING.txt](vendor/stockfish/COPYING.txt)).
The chess.com rating conversion uses the [ChessGoals rating comparison](https://chessgoals.com/rating-comparison/).
The pieces, board, icon and sounds are original to this app.
