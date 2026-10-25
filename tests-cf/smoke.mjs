// Smoke test of the Pages Functions against `wrangler pages dev` (see tests-cf/README.md).
//   BASE=http://localhost:8799 INGEST_TOKEN=tok123 node tests-cf/smoke.mjs
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8799';
const TOKEN = process.env.INGEST_TOKEN || 'tok123';
let cookie = '';
const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
  return { status: r.status, json: await r.json().catch(() => null) };
};
const ingest = (payload, token = TOKEN) => call('/api/ingest', { method: 'POST', body: payload, headers: { authorization: `Bearer ${token}` } });
const tag = Date.now().toString(36);
const k1 = `ow|TPE|NRT|2027-01-${10 + (Date.now() % 10)}-${tag}`, k2 = `rt|TPE|KIX|2027-02-01|2027-02-05|${tag}`, k3 = `ow|TPE|SIN|2027-03-01|${tag}`;

// --- ingest ---
assert.equal((await ingest({ fares: {} }, 'wrong')).status, 401);
assert.equal((await call('/api/ingest', { method: 'POST', body: {} })).status, 401);
let r = await ingest({ fares: { [k1]: { price: 5000, at: '2026-10-20', hist: [['2026-10-20', 5000]] }, [k2]: { price: 9000, at: '2026-10-20' }, bogus: { price: 1 }, [`ow|X|Y|${tag}`]: { price: -3 } }, missing: [k3] });
assert.equal(r.status, 200); assert.equal(r.json.changed, 2); assert.equal(r.json.rejected, 2);
r = await ingest({ fares: { [k1]: { price: 4500, at: '2026-10-22', hist: [['2026-10-22', 4500]] } } });
assert.equal(r.json.changed, 1);
r = await ingest({ fares: { [k1]: { price: 5000, at: '2026-10-20', hist: [['2026-10-20', 5000]] } } });   // older: merged entry is unchanged
assert.equal(r.json.changed, 0);
r = await ingest({ fares: { [k3]: { price: 7000, at: '2026-10-23' } } });                                    // priced now: no longer missing

// --- read ---
const since = Date.now() - 60_000;
r = await call(`/api/fares?since=${since}`);
assert.equal(r.status, 200);
assert.equal(r.json.fares[k1].price, 4500);
assert.deepEqual(r.json.fares[k1].hist, [['2026-10-20', 5000], ['2026-10-22', 4500]]);
assert.equal(r.json.fares[k1].prev, 5000);
assert.ok(!r.json.missing.includes(k3) && r.json.fares[k3].price === 7000);
let all = {}, after = '', pages = 0;
do {
  const p = (await call(`/api/fares?after=${encodeURIComponent(after)}&limit=2`)).json;
  Object.assign(all, p.fares); after = p.next || ''; pages++;
} while (after);
assert.ok(pages >= 2 && all[k2].price === 9000);

// --- accounts ---
assert.equal((await call('/api/me')).json.user, null);
assert.equal((await call('/api/me/state')).status, 401);
const email = `Tester.${tag}@Example.com`;
assert.equal((await call('/api/auth/request', { method: 'POST', body: { email: 'nope' } })).status, 400);
r = await call('/api/auth/request', { method: 'POST', body: { email } });
assert.equal(r.status, 200); assert.match(r.json.dev_code, /^\d{6}$/);
assert.equal((await call('/api/auth/request', { method: 'POST', body: { email } })).status, 429);   // one a minute
assert.equal((await call('/api/auth/verify', { method: 'POST', body: { email, code: r.json.dev_code === '000000' ? '111111' : '000000' } })).status, 401);
r = await call('/api/auth/verify', { method: 'POST', body: { email: email.toUpperCase(), code: r.json.dev_code } });
assert.equal(r.status, 200); assert.ok(cookie.startsWith('sff_session='));
assert.equal((await call('/api/me')).json.user.email, email.toLowerCase());
assert.equal((await call('/api/me/state', { method: 'PUT', body: { kind: 'favorites', data: ['a|b', 'c|d'] } })).status, 200);
assert.equal((await call('/api/me/state', { method: 'PUT', body: { kind: 'nope', data: [] } })).status, 400);
assert.equal((await call('/api/me/state', { method: 'PUT', body: { kind: 'prefs', data: 'str' } })).status, 400);
assert.equal((await call('/api/me/state', { method: 'PUT', body: { kind: 'prefs', data: {} }, headers: { origin: 'https://evil.example' } })).status, 403);
r = await call('/api/me/state');
assert.deepEqual(r.json.state.favorites.data, ['a|b', 'c|d']);
const session = cookie;
assert.equal((await call('/api/auth/logout', { method: 'POST' })).status, 200);
assert.equal((await call('/api/me')).json.user, null);
cookie = session;                                                   // the old cookie must be dead
assert.equal((await call('/api/me')).json.user, null);
console.log('smoke: all checks passed');
