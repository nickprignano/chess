// One Durable Object per live room. It keeps the room (worker/rooms.js) in storage, because
// memory is lost when an idle room hibernates, and talks to the two browsers over WebSockets
// with the Hibernation API, so a room waiting for a move costs nothing.

import { DurableObject } from 'cloudflare:workers';
import { checkTime, expiresAt, handle, join, newRoom, nextAlarm, seatFor, view } from './rooms.js';

const MAX_MESSAGES = 1000; // a socket that sends more than this is closed
const PER_SECOND = 5;
const MAX_MESSAGE = 200; // characters

export class Room extends DurableObject {
  load() {
    return this.ctx.storage.get('room');
  }

  async save(state) {
    await this.ctx.storage.put('room', state);
    await this.ctx.storage.setAlarm(nextAlarm(state));
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const { color } = ws.deserializeAttachment() ?? {};
      if (color) send(ws, view(state, color, now));
    }
  }

  // Called by the Worker: POST /create makes the room, anything else is a browser's WebSocket.
  async fetch(request) {
    if (new URL(request.url).pathname === '/create') {
      if (await this.load()) return Response.json({ error: 'taken' }, { status: 409 });
      const { code, color, clock, token, coin } = await request.json();
      await this.save(newRoom({ code, color, clock, token, coin, now: Date.now() }));
      return Response.json({ ok: true });
    }
    if (request.headers.get('upgrade') !== 'websocket') return new Response(null, { status: 426 });
    if (!(await this.load())) return new Response(null, { status: 404 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ color: null, sent: 0, second: 0, inSecond: 0 });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    const a = ws.deserializeAttachment();
    const now = Date.now();
    const second = Math.floor(now / 1000);
    a.inSecond = a.second === second ? a.inSecond + 1 : 1;
    a.second = second;
    a.sent++;
    if (a.sent > MAX_MESSAGES || a.inSecond > PER_SECOND || typeof data !== 'string' || data.length > MAX_MESSAGE) {
      ws.close(4008, 'too many messages');
      return;
    }
    ws.serializeAttachment(a);
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      ws.close(4000, 'bad message');
      return;
    }
    let state = await this.load();
    if (!state) {
      ws.close(4004, 'no room');
      return;
    }

    // The first message names the seat: a token this browser kept, or none to take the empty seat.
    if (!a.color) {
      if (msg?.type !== 'hello') return ws.close(4000, 'bad message');
      let token = msg.token;
      let color = seatFor(state, token);
      if (!color) {
        token = crypto.randomUUID();
        const joined = join(state, token, now);
        if (joined.error) {
          send(ws, { type: 'error', error: 'full' });
          ws.close(4003, 'full');
          return;
        }
        ({ state, color } = joined);
      }
      // The same seat from another tab or after a dropped connection: the newest socket wins.
      for (const old of this.ctx.getWebSockets()) {
        if (old !== ws && old.deserializeAttachment()?.color === color) old.close(4001, 'replaced');
      }
      ws.serializeAttachment({ ...a, color });
      send(ws, { type: 'seat', token, color });
      state = structuredClone(state);
      state.gone[color] = null;
      await this.save(checkTime(state, now));
      return;
    }

    const result = handle(checkTime(state, now), a.color, msg, now);
    if (result.error) send(ws, { type: 'error', error: result.error });
    else await this.save(result.state);
  }

  async webSocketClose(ws) {
    const { color } = ws.deserializeAttachment() ?? {};
    if (!color) return;
    const still = this.ctx.getWebSockets().some((s) => s !== ws && s.readyState === WebSocket.OPEN && s.deserializeAttachment()?.color === color);
    const state = await this.load();
    if (still || !state) return;
    state.gone[color] = Date.now();
    await this.save(state);
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  // A flag falling, or the room's time being up. A closed room leaves nothing behind.
  async alarm() {
    const state = await this.load();
    if (!state) return;
    const now = Date.now();
    if (now >= expiresAt(state)) {
      for (const ws of this.ctx.getWebSockets()) ws.close(4004, 'room closed');
      await this.env.ROOMS?.delete(`room:${state.code}`);
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.save(checkTime(state, now));
  }
}

function send(ws, data) {
  try {
    ws.send(JSON.stringify(data));
  } catch {
    // The socket is closing; it gets the state again when it reconnects.
  }
}
