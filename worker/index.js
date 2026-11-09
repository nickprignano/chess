// The Worker: everything under /coach and /api/coach. All other paths are the static app,
// served by Cloudflare without running this code (see run_worker_first in wrangler.jsonc).
//
// Cloudflare Access guards both paths with Google or email-code sign-in and the family
// allowlist. Settings, all in the dashboard and never in the repo: the secrets
// ANTHROPIC_API_KEY and USER_SALT, and the variables ACCESS_TEAM_DOMAIN and ACCESS_AUD.
// If any is missing the coach answers "unavailable" and the app uses its free on-device notes.

import { accessEmail, userKey } from './auth.js';
import { Budget } from './budget.js';
import { askClaude, cost, describe, validate, worstCost } from './coach.js';

export { Budget };

const MAX_BODY = 64 * 1024;
const MAX_IDEA = 500;
const IDEA_DAYS = 365;

const reply = (status, data) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error('too big');
  return JSON.parse(text);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Access sends people here after they sign in; back to the app.
    if (url.pathname === '/coach' || url.pathname.startsWith('/coach/')) return Response.redirect(`${url.origin}/?signed-in`, 302);
    if (!url.pathname.startsWith('/api/coach/')) return reply(404, { error: 'not-found' });

    const email = await accessEmail(request, env);
    if (!email) return reply(401, { error: 'signed-out' });
    if (!env.USER_SALT) return reply(503, { error: 'unavailable' });
    const user = await userKey(email, env.USER_SALT);
    if (env.COACH_LIMIT && !(await env.COACH_LIMIT.limit({ key: user })).success) return reply(429, { error: 'slow-down' });
    const budget = env.BUDGET.get(env.BUDGET.idFromName('app'));
    const action = url.pathname.slice('/api/coach/'.length);

    if (action === 'status' && request.method === 'GET') {
      return reply(200, { ...(await budget.remaining(user)), ready: Boolean(env.ANTHROPIC_API_KEY) });
    }

    if (request.method !== 'POST') return reply(405, { error: 'method' });

    if (action === 'forget') {
      await budget.forget(user);
      return reply(200, { ok: true });
    }

    // Ideas for the app, kept for the owner to read. Never sent to Claude, and stored without
    // the sender's email.
    if (action === 'idea') {
      let text;
      try {
        text = String((await readJson(request)).text ?? '').trim();
      } catch {
        return reply(400, { error: 'bad-request' });
      }
      if (!text || text.length > MAX_IDEA) return reply(400, { error: 'bad-request' });
      const key = `idea:${new Date().toISOString()}:${crypto.randomUUID().slice(0, 8)}`;
      if (!env.IDEAS) return reply(503, { error: 'unavailable' });
      await env.IDEAS.put(key, JSON.stringify({ text, at: new Date().toISOString() }), { expirationTtl: IDEA_DAYS * 86400 });
      return reply(200, { ok: true });
    }

    if (action !== 'review' && action !== 'explain') return reply(404, { error: 'not-found' });
    if (!env.ANTHROPIC_API_KEY) return reply(503, { error: 'unavailable' });
    let game;
    try {
      game = validate(action, await readJson(request));
    } catch {
      return reply(400, { error: 'bad-request' });
    }
    const userText = describe(game);
    const worst = worstCost(action, userText);
    // The budget fails closed: if it can't be reached, the coach is off.
    let reserved;
    try {
      reserved = await budget.reserve(user, action, worst);
    } catch {
      return reply(503, { error: 'unavailable' });
    }
    if (!reserved.ok) return reply(429, { error: reserved.reason });
    try {
      const { answer, usage } = await askClaude(action, userText, env.ANTHROPIC_API_KEY, game.sans.length);
      await budget.settle(user, action, worst, cost(usage), false);
      return reply(200, answer);
    } catch (error) {
      // A call that ran is paid for and keeps its use; one that never ran gives both back.
      // If settling fails, the full reservation stays counted, which errs on the safe side.
      await budget.settle(user, action, worst, error.usage ? cost(error.usage) : 0, !error.usage).catch(() => {});
      return reply(502, { error: 'unavailable' });
    }
  },
};
