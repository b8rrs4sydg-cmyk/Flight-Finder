// GET /api/me — who is signed in (null when nobody).
import { currentUser, json } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  const user = await currentUser(request, env);
  return json({ user: user ? { email: user.email } : null });
}

// DELETE /api/me — delete the account and everything stored for it.
export async function onRequestDelete({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'not signed in' }, 401);
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'forbidden' }, 403);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('DELETE FROM user_state WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(user.id),
  ]);
  return json({ ok: true });
}
