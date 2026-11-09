// Talks to Stockfish over UCI. The engine runs in a Web Worker in the browser and as a child
// process in the tests; this class only needs a way to send a line and to be handed each line
// the engine prints.

export const ENGINE_FILE = 'vendor/stockfish/stockfish-19-lite-single.js';

export class Engine {
  constructor(send) {
    this.send = send;
    this.waiting = null; // { until, resolve, reject } for the line we're waiting for
    this.info = new Map(); // latest line for each MultiPV slot during a search
  }

  // Call with every line the engine prints.
  receive(line) {
    const m = line.match(/^info .*\bmultipv (\d+) .*\bscore (cp|mate) (-?\d+).* pv (\S+)/);
    if (m) this.info.set(Number(m[1]), { move: m[4], score: m[2] === 'mate' ? mateScore(Number(m[3])) : Number(m[3]) });
    if (this.waiting && line.startsWith(this.waiting.until)) {
      const { resolve } = this.waiting;
      this.waiting = null;
      resolve(line);
    }
  }

  wait(until, command) {
    return new Promise((resolve, reject) => {
      this.waiting = { until, resolve, reject };
      this.send(command);
    });
  }

  // The engine broke (for example its file didn't load): whatever is waiting gets the error.
  fail(error) {
    const w = this.waiting;
    this.waiting = null;
    w?.reject(error);
  }

  async start() {
    await this.wait('uciok', 'uci');
    this.send('ucinewgame');
    await this.wait('readyok', 'isready');
  }

  // Searches the position. With `elo` set, Stockfish weakens itself to that rating and returns
  // one move; otherwise it returns its top `multipv` moves with scores from the mover's side.
  async search(fen, { multipv = 1, depth, elo, movetime }) {
    this.send(`setoption name UCI_LimitStrength value ${elo ? 'true' : 'false'}`);
    if (elo) this.send(`setoption name UCI_Elo value ${elo}`);
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`position fen ${fen}`);
    this.info.clear();
    const done = await this.wait('bestmove', movetime ? `go movetime ${movetime}` : `go depth ${depth}`);
    const best = done.split(' ')[1];
    const lines = [...this.info.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
    return { best: best === '(none)' ? null : best, lines };
  }
}

// Mate in n counts as a huge score, sooner mates higher.
function mateScore(n) {
  return n > 0 ? 100000 - n * 100 : -100000 - n * 100;
}

// A browser engine in its own worker. Call quit() to free its memory between games.
export function browserEngine() {
  const worker = new Worker(ENGINE_FILE);
  const engine = new Engine((line) => worker.postMessage(line));
  worker.addEventListener('message', (e) => engine.receive(String(e.data)));
  worker.addEventListener('error', () => engine.fail(new Error('The computer player couldn’t start.')));
  engine.quit = () => worker.terminate();
  return engine;
}
