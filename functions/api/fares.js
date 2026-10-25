// GET /api/fares — the public fare database, in the shape of the fares*.json files.
//   ?after=<key>&limit=N   full read, ordered by key (the first page also carries missing / unavailable)
//   ?since=<ms>            only rows written after that moment (cheap 5-minute refresh)
import { json } from './_lib.js';

const PAGE = 4000;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const now = Date.now();
  const meta = Object.fromEntries((await env.DB.prepare('SELECT k, v FROM meta').all()).results.map(r => [r.k, r.v]));
  const base = { schema: 2, source: 'cloudflare-d1', currency: 'TWD', adults: 1, generated_at: meta.generated_at || '', now };

  if (url.searchParams.has('since')) {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const rows = (await env.DB.prepare('SELECT key, entry FROM fares WHERE updated > ?1 ORDER BY updated LIMIT 20001').bind(since).all()).results;
    const truncated = rows.length > 20000;
    const flags = (await env.DB.prepare('SELECT key, kind FROM flags WHERE updated > ?1').bind(since).all()).results;
    return json({
      ...base,
      coverage: meta.coverage ? JSON.parse(meta.coverage) : undefined,
      fares: Object.fromEntries(rows.slice(0, 20000).map(r => [r.key, JSON.parse(r.entry)])),
      missing: flags.filter(f => f.kind === 'missing').map(f => f.key),
      unavailable: flags.filter(f => f.kind === 'unavailable').map(f => f.key),
      truncated,
    });
  }

  const after = url.searchParams.get('after') || '';
  const limit = Math.min(PAGE, Math.max(1, Number(url.searchParams.get('limit')) || PAGE));
  const cacheKey = new Request(`${url.origin}/api/fares?after=${encodeURIComponent(after)}&limit=${limit}&g=${meta.generated_at || ''}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const rows = (await env.DB.prepare('SELECT key, entry FROM fares WHERE key > ?1 ORDER BY key LIMIT ?2').bind(after, limit + 1).all()).results;
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const body = { ...base, fares: Object.fromEntries(page.map(r => [r.key, JSON.parse(r.entry)])), next: more ? page[page.length - 1].key : null };
  if (!after) {
    const flags = (await env.DB.prepare('SELECT key, kind FROM flags').all()).results;
    body.coverage = meta.coverage ? JSON.parse(meta.coverage) : {};
    body.missing = flags.filter(f => f.kind === 'missing').map(f => f.key);
    body.unavailable = flags.filter(f => f.kind === 'unavailable').map(f => f.key);
  }
  const res = json(body, 200, { 'cache-control': 'public, max-age=300' });
  await cache.put(cacheKey, res.clone());
  return res;
}
