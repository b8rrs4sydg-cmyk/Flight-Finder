// Shared helpers of the Pages Functions (no dependencies).

export const HISTORY_POINTS = 14;          // same as backend/app/providers/fare_db.py
export const SESSION_DAYS = 90;
export const CODE_MINUTES = 10;

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export const bad = (message, status = 400) => json({ error: message }, status);

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
export const randomHex = bytes => hex(crypto.getRandomValues(new Uint8Array(bytes)));

export function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/** The more recently fetched of two entries for one key, with both price histories folded in
 *  (port of scripts/merge_fare_files.merge_entries). */
export function mergeEntries(a, b) {
  const [nw, old] = (a.at || '') >= (b.at || '') ? [a, b] : [b, a];
  const hist = new Map();
  for (const h of [...(old.hist || []), ...(nw.hist || [])]) hist.set(h[0], h[1]);
  const out = { ...nw };
  if (hist.size) {
    const points = [...hist.entries()].sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0)).slice(-HISTORY_POINTS);
    out.hist = points.map(([d, p]) => [d, p]);
    if (points.length >= 2) { out.prev = points[points.length - 2][1]; out.prev_at = points[points.length - 2][0]; }
  }
  return out;
}

export const validKey = key => typeof key === 'string' && key.length > 3 && key.length < 400 && /^(ow|rt|mc)\|/.test(key);

export function validEntry(e) {
  return e && typeof e === 'object' && !Array.isArray(e) && Number.isFinite(e.price) && e.price > 0 && e.price < 10_000_000;
}

export const normEmail = s => String(s || '').trim().toLowerCase();
export const validEmail = s => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

function cookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

export const SESSION_COOKIE = 'sff_session';

export const sessionCookie = (token, maxAge) =>
  `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

/** The signed-in user of a request ({id, email}) or null. */
export async function currentUser(request, env) {
  const token = cookie(request, SESSION_COOKIE);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1 AND s.expires > ?2',
  ).bind(await sha256(token), Date.now()).first();
  return row || null;
}

/** Same-origin check for requests that change state (cookies are SameSite=Lax; this closes the rest). */
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}
