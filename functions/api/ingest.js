// POST /api/ingest — the crawlers (GitHub Actions) push what they priced.
//   Authorization: Bearer <INGEST_TOKEN>
//   body: { fares: {key: entry}, missing: [key], unavailable: [key], generated_at?, coverage? }
// An entry is merged with the stored one (newest `at` wins, price histories joined).
import { bad, json, mergeEntries, safeEqual, validEntry, validKey } from './_lib.js';

const MAX_FARES = 1000;
const IN_CHUNK = 90;   // D1 allows 100 bound parameters per statement

export async function onRequestPost({ request, env }) {
  const auth = request.headers.get('authorization') || '';
  if (!env.INGEST_TOKEN || !safeEqual(auth, `Bearer ${env.INGEST_TOKEN}`)) return bad('unauthorized', 401);

  let body;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  const incoming = Object.entries(body?.fares || {});
  if (incoming.length > MAX_FARES) return bad(`at most ${MAX_FARES} fares per request`, 413);
  const flagged = ['missing', 'unavailable'].flatMap(kind => (Array.isArray(body?.[kind]) ? body[kind] : []).map(key => [kind, key]));
  if (flagged.length > 5000) return bad('too many flagged keys per request', 413);

  const good = incoming.filter(([k, v]) => validKey(k) && validEntry(v));
  const keys = good.map(([k]) => k);
  const stored = new Map();
  for (let i = 0; i < keys.length; i += IN_CHUNK) {
    const part = keys.slice(i, i + IN_CHUNK);
    const rows = (await env.DB.prepare(`SELECT key, entry FROM fares WHERE key IN (${part.map((_, j) => `?${j + 1}`).join(',')})`).bind(...part).all()).results;
    for (const r of rows) stored.set(r.key, JSON.parse(r.entry));
  }

  const now = Date.now();
  const statements = [];
  let changed = 0;
  for (const [key, entry] of good) {
    const old = stored.get(key);
    const merged = old ? mergeEntries(entry, old) : entry;
    const text = JSON.stringify(merged);
    if (old && JSON.stringify(old) === text) continue;      // nothing new: keep `updated` so refreshes stay small
    changed++;
    statements.push(env.DB.prepare(
      'INSERT INTO fares (key, entry, at, updated) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(key) DO UPDATE SET entry = ?2, at = ?3, updated = ?4',
    ).bind(key, text, merged.at || '', now));
    // a priced key is no longer missing / unavailable
    statements.push(env.DB.prepare('DELETE FROM flags WHERE key = ?1').bind(key));
  }
  const pricedNow = new Set(keys);
  for (const [kind, key] of flagged) {
    if (!validKey(key) || pricedNow.has(key)) continue;
    statements.push(env.DB.prepare(
      'INSERT INTO flags (key, kind, updated) VALUES (?1, ?2, ?3) ON CONFLICT(key, kind) DO UPDATE SET updated = ?3',
    ).bind(key, kind, now));
  }
  if (typeof body.generated_at === 'string' && body.generated_at.length < 40) {
    statements.push(env.DB.prepare(
      "INSERT INTO meta (k, v) VALUES ('generated_at', ?1) ON CONFLICT(k) DO UPDATE SET v = MAX(v, ?1)",
    ).bind(body.generated_at));
  }
  if (body.coverage && typeof body.coverage === 'object' && Object.keys(body.coverage).length) {
    statements.push(env.DB.prepare(
      "INSERT INTO meta (k, v) VALUES ('coverage', ?1) ON CONFLICT(k) DO UPDATE SET v = ?1",
    ).bind(JSON.stringify(body.coverage)));
  }
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
  return json({ ok: true, received: incoming.length, rejected: incoming.length - good.length, changed });
}
