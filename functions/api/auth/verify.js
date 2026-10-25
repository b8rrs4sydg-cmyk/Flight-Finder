// POST /api/auth/verify {email, code} — trade the one-time code for a session cookie.
import { SESSION_DAYS, bad, json, normEmail, randomHex, sameOrigin, sessionCookie, sha256, safeEqual, validEmail } from '../_lib.js';

const MAX_TRIES = 5;

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return bad('forbidden', 403);
  let body;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  const email = normEmail(body?.email);
  const code = String(body?.code || '').replace(/\s/g, '');
  if (!validEmail(email) || !/^\d{6}$/.test(code)) return bad('驗證碼格式不正確');

  const now = Date.now();
  const row = await env.DB.prepare('SELECT code_hash, expires, tries FROM login_codes WHERE email = ?1').bind(email).first();
  if (!row || row.expires < now) return bad('驗證碼已過期，請重新寄送', 401);
  if (row.tries >= MAX_TRIES) return bad('錯誤次數過多，請重新寄送驗證碼', 429);
  await env.DB.prepare('UPDATE login_codes SET tries = tries + 1 WHERE email = ?1').bind(email).run();
  if (!safeEqual(row.code_hash, await sha256(`${email}:${code}:${env.AUTH_SECRET}`))) return bad('驗證碼不正確', 401);

  await env.DB.prepare('DELETE FROM login_codes WHERE email = ?1').bind(email).run();
  let user = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first();
  if (!user) {
    user = { id: randomHex(12) };
    await env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?1, ?2, ?3)').bind(user.id, email, now).run();
  }
  const token = randomHex(32);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?1').bind(now),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?1, ?2, ?3)').bind(await sha256(token), user.id, now + SESSION_DAYS * 86_400_000),
  ]);
  return json({ ok: true, email }, 200, { 'set-cookie': sessionCookie(token, SESSION_DAYS * 86_400) });
}
