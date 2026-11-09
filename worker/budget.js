// One Durable Object holds the spend and usage counters for the whole app. Durable Objects run
// one request at a time, so two coach calls can't both slip under the cap. See limits.js.

import { DurableObject } from 'cloudflare:workers';
import { forget, remaining, reserve, settle } from './limits.js';

export class Budget extends DurableObject {
  async load() {
    return (await this.ctx.storage.get('state')) ?? {};
  }

  async reserve(user, kind, worst) {
    const result = reserve(await this.load(), user, kind, worst);
    if (result.ok) await this.ctx.storage.put('state', result.state);
    return { ok: result.ok, reason: result.reason };
  }

  async settle(user, kind, worst, actual, failed) {
    await this.ctx.storage.put('state', settle(await this.load(), user, kind, worst, actual, failed));
  }

  async remaining(user) {
    return remaining(await this.load(), user);
  }

  async forget(user) {
    await this.ctx.storage.put('state', forget(await this.load(), user));
  }
}
