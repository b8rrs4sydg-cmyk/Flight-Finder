// POST /api/auth/logout — end this browser's session.
import { SESSION_COOKIE, bad, json, sameOrigin, sessionCookie, sha256 } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return bad('forbidden', 403);
  const m = (request.headers.get('cookie') || '').match(new RegExp(`${SESSION_COOKIE}=([0-9a-f]{64})`));
  if (m) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256(m[1])).run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}
