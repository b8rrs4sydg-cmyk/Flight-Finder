// The look-up queue (migrations/0002_queue.sql).
//   POST /api/queue            page    {keys:[…]} → keys the crawlers should price (same origin, max 1000 per request)
//   GET  /api/queue            page    {pending, claimed} counts, so a returning page can say how far the crawlers are
//   POST /api/queue?claim=N    crawler Bearer INGEST_TOKEN → {keys:[…]} the next N keys; /api/ingest removes them when priced
import { bad, json, safeEqual, sameOrigin, validKey } from './_lib.js';

const MAX_ENQUEUE = 1000;
const MAX_PENDING = 30000;      // a cap so nobody can fill the table
const MAX_CLAIM = 200;
const CLAIM_TTL_MS = 10 * 60 * 1000;   // an unanswered claim goes back to the queue
const MAX_TRIES = 3;                   // …at most this many times, then the key is dropped (a later search asks again)
const IN_CHUNK = 90;

export async function onRequestGet({ env }) {
  const rows = (await env.DB.prepare('SELECT state, COUNT(*) AS n FROM queue GROUP BY state').all()).results;
  const n = Object.fromEntries(rows.map(r => [r.state, r.n]));
  return json({ pending: n.pending || 0, claimed: n.claimed || 0 });
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.has('claim')) return claim(request, env, url);

  if (!sameOrigin(request)) return bad('cross-origin request refused', 403);
  let body;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  const keys = [...new Set(Array.isArray(body?.keys) ? body.keys : [])].filter(validKey);
  if (!keys.length) return json({ queued: 0, pending: 0 });
  if (keys.length > MAX_ENQUEUE) return bad(`at most ${MAX_ENQUEUE} keys per request`, 413);

  const total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM queue').first())?.n || 0;
  if (total + keys.length > MAX_PENDING) return json({ queued: 0, pending: total, full: true });
  const base = Date.now() * 1000;
  const statements = keys.map((key, i) =>
    env.DB.prepare('INSERT OR IGNORE INTO queue (key, prio) VALUES (?1, ?2)').bind(key, base + i));
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
  const after = (await env.DB.prepare('SELECT COUNT(*) AS n FROM queue').first())?.n || 0;
  return json({ queued: keys.length, pending: after });
}

async function claim(request, env, url) {
  const auth = request.headers.get('authorization') || '';
  if (!env.INGEST_TOKEN || !safeEqual(auth, `Bearer ${env.INGEST_TOKEN}`)) return bad('unauthorized', 401);
  const n = Math.max(1, Math.min(MAX_CLAIM, parseInt(url.searchParams.get('claim'), 10) || 1));
  const now = Date.now();
  await env.DB.prepare('DELETE FROM queue WHERE tries >= ?1 AND claimed_at < ?2').bind(MAX_TRIES, now - CLAIM_TTL_MS).run();
  // one statement, so two crawlers never receive the same key
  const rows = (await env.DB.prepare(
    `UPDATE queue SET state = 'claimed', claimed_at = ?1, tries = tries + 1
     WHERE key IN (SELECT key FROM queue
                   WHERE tries < ?2 AND (state = 'pending' OR claimed_at < ?3)
                   ORDER BY prio LIMIT ?4)
     RETURNING key`,
  ).bind(now, MAX_TRIES, now - CLAIM_TTL_MS, n).all()).results;
  return json({ keys: rows.map(r => r.key) });
}

/** Drop answered keys from the queue (called by ingest). */
export async function dequeue(env, keys) {
  const statements = [];
  for (let i = 0; i < keys.length; i += IN_CHUNK) {
    const part = keys.slice(i, i + IN_CHUNK);
    statements.push(env.DB.prepare(`DELETE FROM queue WHERE key IN (${part.map((_, j) => `?${j + 1}`).join(',')})`).bind(...part));
  }
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
}
