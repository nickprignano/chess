// The spend and usage limits, as plain functions over a stored state so the tests can run them.
// The Budget Durable Object (budget.js) keeps the state and runs one call at a time, so a
// reservation can't race another.
//
// Before each Claude call the Worker reserves the worst case (max_tokens and the input size at
// list price). After the call it settles the real cost from the response's usage. A day stops
// at $0.33 and a month at $9; each account gets 2 reviews and 5 explains a day.

export const LIMITS = { day: 0.33, month: 9, review: 2, explain: 5 };

const today = (now) => new Date(now).toISOString().slice(0, 10);

// A fresh copy of the state, rolled over to `now`'s day and month. Counters from earlier days
// are dropped, so an account's key is only kept for the day it was used.
function current(state, now) {
  const day = today(now);
  const month = day.slice(0, 7);
  const s = structuredClone(state ?? {});
  if (s.month !== month) Object.assign(s, { month, monthSpent: 0 });
  if (s.day !== day) Object.assign(s, { day, daySpent: 0, users: {} });
  return s;
}

// Tries to reserve `worst` dollars for one call of `kind` ('review' or 'explain') by `user`.
// Returns { ok, state } or { ok: false, reason: 'user-limit' | 'budget' }.
export function reserve(state, user, kind, worst, now = Date.now()) {
  const s = current(state, now);
  const u = s.users[user] ?? { review: 0, explain: 0 };
  if (u[kind] >= LIMITS[kind]) return { ok: false, reason: 'user-limit' };
  if (s.daySpent + worst > LIMITS.day || s.monthSpent + worst > LIMITS.month) return { ok: false, reason: 'budget' };
  u[kind]++;
  s.users[user] = u;
  s.daySpent += worst;
  s.monthSpent += worst;
  return { ok: true, state: s };
}

// Replaces a reservation with what the call really cost. A call that failed before Claude
// answered (actual 0, failed true) also gives the account its use back.
export function settle(state, user, kind, worst, actual, failed = false, now = Date.now()) {
  const s = current(state, now);
  s.daySpent = Math.max(0, s.daySpent - worst + actual);
  s.monthSpent = Math.max(0, s.monthSpent - worst + actual);
  if (failed && s.users[user]) s.users[user][kind] = Math.max(0, s.users[user][kind] - 1);
  return s;
}

// What an account has left today, and whether the coach is open at all.
export function remaining(state, user, now = Date.now()) {
  const s = current(state, now);
  const u = s.users[user] ?? { review: 0, explain: 0 };
  return {
    reviews: LIMITS.review - u.review,
    explains: LIMITS.explain - u.explain,
    open: s.daySpent < LIMITS.day && s.monthSpent < LIMITS.month,
  };
}

// "Delete my data": drops the account's counters.
export function forget(state, user, now = Date.now()) {
  const s = current(state, now);
  delete s.users[user];
  return s;
}
