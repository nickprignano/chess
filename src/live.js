// Live games with a friend: making a room, checking a code, and the connection to the room.
// The room on the server is the referee; this side just sends moves and shows what it says.

const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
const RETRY_MS = [1000, 2000, 4000, 8000, 15000];

// What someone typed, as a code: capitals, no spaces or dashes. O and I read as 0 and 1 aren't in
// codes, so they're left for the check to reject.
export const cleanCode = (text) => String(text).toUpperCase().replace(/[\s-]/g, '');
export const validCode = (code) => CODE.test(code);

async function call(url, init, fetcher) {
  let res;
  try {
    res = await fetcher(url, init);
  } catch {
    return { error: 'offline' };
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    // Not JSON: treated as unavailable.
  }
  return res.ok ? data : { error: data.error ?? 'unavailable' };
}

// Makes a room. Returns { code, token } or { error }.
export const createRoom = (color, clock, fetcher = fetch) =>
  call('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ color, clock }) }, fetcher);

// { ok } if the room exists, or { error: 'no-room' | 'slow-down' | 'offline' | ... }.
export const findRoom = (code, fetcher = fetch) => call(`/api/rooms/${code}`, {}, fetcher);

// The connection to a room. It reconnects by itself after a drop, with the seat token, until
// the room says it's closed or full. `onEvent` gets the room's messages ({ type: 'seat' },
// { type: 'state' }, { type: 'error' }) plus { type: 'connection', online } and
// { type: 'closed', reason } when it stops for good.
export class LiveRoom {
  constructor(code, token, onEvent, { WebSocketClass = WebSocket, origin = location.origin, fetcher = fetch } = {}) {
    Object.assign(this, { code, token, onEvent, WebSocketClass, fetcher });
    this.url = `${origin.replace(/^http/, 'ws')}/api/rooms/${code}/ws`;
    this.tries = 0;
    this.stopped = false;
    this.open();
  }

  open() {
    const ws = new this.WebSocketClass(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      ws.send(JSON.stringify({ type: 'hello', token: this.token ?? null }));
      this.onEvent({ type: 'connection', online: true });
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'seat') this.token = msg.token;
      this.onEvent(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws || this.stopped) return;
      this.onEvent({ type: 'connection', online: false });
      // 4001: this seat opened somewhere newer. 4003: full. 4004: the room is gone.
      if (e.code === 4001) return this.stop('replaced');
      if (e.code === 4003) return this.stop('full');
      if (e.code === 4004) return this.stop('no-room');
      this.retry();
    };
  }

  // A socket that fails without a reason might be a room that no longer exists, so ask first.
  async retry() {
    const wait = RETRY_MS[Math.min(this.tries++, RETRY_MS.length - 1)];
    await new Promise((r) => setTimeout(r, wait));
    if (this.stopped) return;
    const found = await findRoom(this.code, this.fetcher);
    if (this.stopped) return;
    if (found.error === 'no-room') return this.stop('no-room');
    this.open();
  }

  send(msg) {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  stop(reason) {
    if (this.stopped) return;
    this.stopped = true;
    try {
      this.ws?.close(1000);
    } catch {
      // Already closed.
    }
    if (reason) this.onEvent({ type: 'closed', reason });
  }
}
