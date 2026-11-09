// Run with: node --test
// Live rooms: the room's rules (worker/rooms.js) and the page's connection (src/live.js). The
// Durable Object and the Worker's routes are checked against a local server (docs/DEPLOY.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkTime, CODE, CODE_CHARS, expiresAt, flagAt, GONE_MS, handle, join, LAG_MS, makeCode, newRoom, nextAlarm, seatFor, view } from '../worker/rooms.js';
import { cleanCode, LiveRoom, validCode } from '../src/live.js';

const T0 = Date.parse('2026-11-09T12:00:00Z');

function room({ clock = null, color = 'w' } = {}) {
  const s = newRoom({ code: 'ABC234', color, clock, token: 'tok-a', now: T0, coin: 'b' });
  return join(s, 'tok-b', T0 + 1000).state;
}

function play(state, moves, start, step = 1000) {
  let s = state;
  moves.forEach((uci, i) => {
    const color = s.moves.length % 2 ? 'b' : 'w';
    const r = handle(s, color, { type: 'move', uci }, start + i * step);
    assert.ok(r.state, `${uci}: ${r.error}`);
    s = r.state;
  });
  return s;
}

test('codes use 31 characters that can\'t be mixed up, evenly', () => {
  assert.equal(CODE_CHARS.length, 31);
  assert.doesNotMatch(CODE_CHARS, /[01ILO]/);
  for (let i = 0; i < 200; i++) assert.match(makeCode(), CODE);
  // Bytes from 248 up are skipped, so no character comes up more often than the others.
  assert.equal(makeCode(() => Uint8Array.from([255, 248, 0, 30, 31, 247, 62, 1, 2, 3, 4, 5])), '2Z2Z23');
  assert.equal(cleanCode(' abc-234 '), 'ABC234');
  assert.ok(validCode('ABC234'));
  assert.ok(!validCode('ABCO34'));
});

test('two seats: the creator\'s color, then the friend; a third person is turned away', () => {
  const lone = newRoom({ code: 'ABC234', color: 'random', clock: null, token: 'tok-a', now: T0, coin: 'b' });
  assert.equal(seatFor(lone, 'tok-a'), 'b');
  assert.equal(view(lone, 'b', T0).waiting, true);
  assert.equal(handle(lone, 'b', { type: 'resign' }, T0).error, 'waiting');
  const { state, color } = join(lone, 'tok-b', T0);
  assert.equal(color, 'w');
  assert.equal(seatFor(state, 'tok-b'), 'w');
  assert.equal(seatFor(state, 'nope'), null);
  assert.equal(seatFor(state, null), null);
  assert.deepEqual(join(state, 'tok-c', T0), { error: 'full' });
  assert.throws(() => newRoom({ code: 'ABC234', color: 'green', clock: null, token: 't', now: T0 }));
  assert.throws(() => newRoom({ code: 'ABC234', color: 'w', clock: '1+0', token: 't', now: T0 }));
});

test('the room is the referee: turn order, legal moves only, and how games end', () => {
  const s = room();
  assert.equal(handle(s, 'b', { type: 'move', uci: 'e7e5' }, T0).error, 'not-your-turn');
  assert.equal(handle(s, 'w', { type: 'move', uci: 'e2e5' }, T0).error, 'bad-move');
  assert.equal(handle(s, 'w', { type: 'move', uci: 'e2e4; drop table' }, T0).error, 'bad-move');
  assert.equal(handle(s, 'w', { type: 'chat', text: 'hi' }, T0).error, 'bad-request');
  const mate = play(s, ['f2f3', 'e7e5', 'g2g4', 'd8h4'], T0 + 2000);
  assert.deepEqual([mate.result, mate.reason], ['0-1', 'checkmate']);
  assert.equal(handle(mate, 'w', { type: 'move', uci: 'a2a3' }, T0).error, 'over');
  const resigned = handle(s, 'b', { type: 'resign' }, T0).state;
  assert.deepEqual([resigned.result, resigned.reason], ['1-0', 'resigned']);
});

test('draw offers: the other player accepts or declines, and a move withdraws it', () => {
  let s = handle(room(), 'w', { type: 'draw' }, T0).state;
  assert.equal(view(s, 'b', T0).draw, 'w');
  assert.equal(handle(s, 'w', { type: 'decline' }, T0).error, 'no-offer');
  assert.equal(handle(s, 'b', { type: 'decline' }, T0).state.draw, null);
  assert.equal(handle(s, 'w', { type: 'move', uci: 'e2e4' }, T0).state.draw, null);
  s = handle(s, 'b', { type: 'draw' }, T0).state;
  assert.deepEqual([s.result, s.reason], ['1/2-1/2', 'agreed']);
});

test('clocks: first moves are free, time runs from timestamps, with increment and lag allowance', () => {
  let s = play(room({ clock: '5+3' }), ['e2e4', 'e7e5'], T0 + 60000); // a minute to make the first move costs nothing
  assert.equal(s.clock.w, 300000);
  assert.equal(flagAt(s), T0 + 61000 + 300000 + LAG_MS);
  // White thinks 10 seconds: loses 10s minus the lag allowance, gains 3.
  s = handle(s, 'w', { type: 'move', uci: 'g1f3' }, T0 + 71000).state;
  assert.equal(s.clock.w, 300000 - (10000 - LAG_MS) + 3000);
  assert.equal(view(s, 'w', T0 + 81000).clock.b, 300000 - 10000);
  assert.equal(view(s, 'w', T0 + 81000).clock.running, 'b');
  // Black lets the flag fall: the alarm (or the late move) ends the game.
  const late = T0 + 71000 + 300000 + LAG_MS;
  assert.equal(nextAlarm(s), late);
  assert.equal(checkTime(s, late - 1), s);
  const flagged = checkTime(s, late);
  assert.deepEqual([flagged.result, flagged.reason, flagged.clock.b], ['1-0', 'time', 0]);
  assert.equal(handle(s, 'b', { type: 'move', uci: 'b8c6' }, late + 5).state.reason, 'time');
  assert.equal(flagAt(flagged), null);
});

test('a player gone 3 minutes can be claimed; rooms close when idle or unjoined', () => {
  const s = structuredClone(room());
  s.gone.b = T0 + 5000;
  assert.equal(view(s, 'w', T0 + 65000).goneFor, 60000);
  assert.equal(handle(s, 'w', { type: 'claim' }, T0 + 5000 + GONE_MS - 1).error, 'not-gone');
  assert.equal(handle(s, 'b', { type: 'claim' }, T0 + 5000 + GONE_MS).error, 'not-gone');
  const claimed = handle(s, 'w', { type: 'claim' }, T0 + 5000 + GONE_MS).state;
  assert.deepEqual([claimed.result, claimed.reason], ['1-0', 'abandoned']);
  const lone = newRoom({ code: 'ABC234', color: 'w', clock: null, token: 't', now: T0 });
  assert.equal(expiresAt(lone), T0 + 3600000);
  assert.equal(expiresAt(play(room(), ['e2e4'], T0 + 7200000)), T0 + 7200000 + 86400000);
  assert.equal(nextAlarm(room()), T0 + 1000 + 86400000);
});

// A stand-in for the browser's WebSocket.
class FakeSocket {
  static all = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.readyState = 0;
    FakeSocket.all.push(this);
  }
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
  }
  // Test helpers.
  connect() {
    this.readyState = 1;
    this.onopen();
  }
  receive(msg) {
    this.onmessage({ data: JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose({ code });
  }
}

test('the page\'s connection says hello with its seat, keeps the new token, and stops when the room closes', async () => {
  FakeSocket.all = [];
  const events = [];
  const r = new LiveRoom('ABC234', null, (e) => events.push(e), { WebSocketClass: FakeSocket, origin: 'https://app.example', fetcher: async () => ({ ok: false, json: async () => ({ error: 'no-room' }) }) });
  const ws = FakeSocket.all[0];
  assert.equal(ws.url, 'wss://app.example/api/rooms/ABC234/ws');
  assert.equal(r.send({ type: 'move', uci: 'e2e4' }), false); // not open yet
  ws.connect();
  assert.deepEqual(ws.sent, [{ type: 'hello', token: null }]);
  ws.receive({ type: 'seat', token: 'tok-new', color: 'b' });
  assert.equal(r.token, 'tok-new');
  assert.ok(r.send({ type: 'resign' }));
  ws.drop(4003);
  assert.deepEqual(events.at(-1), { type: 'closed', reason: 'full' });
  assert.equal(FakeSocket.all.length, 1);

  // A drop with no reason checks the room is still there before reconnecting with the token.
  const events2 = [];
  let lookups = 0;
  const r2 = new LiveRoom('ABC234', 'tok-a', (e) => events2.push(e), { WebSocketClass: FakeSocket, origin: 'http://localhost:8787', fetcher: async () => (lookups++, { ok: true, json: async () => ({ ok: true }) }) });
  const first = FakeSocket.all[1];
  assert.equal(first.url, 'ws://localhost:8787/api/rooms/ABC234/ws');
  first.connect();
  first.drop();
  await new Promise((done) => setTimeout(done, 1100));
  assert.equal(lookups, 1);
  const second = FakeSocket.all[2];
  second.connect();
  assert.deepEqual(second.sent, [{ type: 'hello', token: 'tok-a' }]);
  assert.deepEqual(events2.filter((e) => e.type === 'connection').map((e) => e.online), [true, false, true]);
  r2.stop();
});
