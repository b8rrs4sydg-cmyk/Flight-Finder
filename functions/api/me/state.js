// GET /api/me/state — everything stored for the signed-in user.
// PUT /api/me/state {kind, data} — replace one piece (favorites, favprices, history, prefs).
// The page merges before it writes, so the server just keeps the latest.
import { bad, currentUser, json, sameOrigin } from '../_lib.js';

const KINDS = ['favorites', 'favprices', 'history', 'prefs'];
const MAX_BYTES = 200_000;

export async function onRequestGet({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return bad('not signed in', 401);
  const rows = (await env.DB.prepare('SELECT kind, data, updated_at FROM user_state WHERE user_id = ?1').bind(user.id).all()).results;
  return json({ email: user.email, state: Object.fromEntries(rows.map(r => [r.kind, { data: JSON.parse(r.data), updated_at: r.updated_at }])) });
}

export async function onRequestPut({ request, env }) {
  if (!sameOrigin(request)) return bad('forbidden', 403);
  const user = await currentUser(request, env);
  if (!user) return bad('not signed in', 401);
  const text = await request.text();
  if (text.length > MAX_BYTES) return bad('too large', 413);
  let body;
  try { body = JSON.parse(text); } catch { return bad('invalid JSON'); }
  if (!KINDS.includes(body?.kind)) return bad('unknown kind');
  if (body.data === null || typeof body.data !== 'object') return bad('data must be an array or an object');
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO user_state (user_id, kind, data, updated_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(user_id, kind) DO UPDATE SET data = ?3, updated_at = ?4`,
  ).bind(user.id, body.kind, JSON.stringify(body.data), now).run();
  return json({ ok: true, updated_at: now });
}
