// Checks the sign-in token Cloudflare Access adds to requests on the coach paths. Access does the
// Google or email-code sign-in and the family allowlist; this check makes sure a request really
// came through Access for this app, so nothing reaches Claude if Access is ever misconfigured.
// Settings (Worker variables, set in the dashboard, never in the repo): ACCESS_TEAM_DOMAIN and
// ACCESS_AUD.

let keyCache = { url: null, at: 0, keys: [] };
const KEY_CACHE_MS = 10 * 60 * 1000;

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const json = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

async function signingKeys(teamDomain, fetcher) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (keyCache.url !== url || Date.now() - keyCache.at > KEY_CACHE_MS) {
    const res = await fetcher(url);
    if (!res.ok) throw new Error('Access keys unavailable');
    keyCache = { url, at: Date.now(), keys: (await res.json()).keys ?? [] };
  }
  return keyCache.keys;
}

// The signed-in email in lower case, or null if the token is missing or doesn't check out.
export async function accessEmail(request, env, fetcher = fetch, now = Date.now()) {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = json(parts[0]);
    const claims = json(parts[1]);
    if (header.alg !== 'RS256') return null;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(env.ACCESS_AUD) || claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return null;
    const jwk = (await signingKeys(env.ACCESS_TEAM_DOMAIN, fetcher)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return ok && typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

// The key the usage counters are stored under: the email hashed with a secret salt (USER_SALT).
export async function userKey(email, salt) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${email}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
