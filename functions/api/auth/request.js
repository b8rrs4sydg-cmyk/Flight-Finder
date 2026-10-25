// POST /api/auth/request {email} — mail a 6-digit one-time code (valid 10 minutes).
import { CODE_MINUTES, bad, json, normEmail, sameOrigin, sha256, validEmail } from '../_lib.js';

const MIN_GAP_MS = 60_000;          // one code per address per minute
const MAX_PER_HOUR = 5;

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return bad('forbidden', 403);
  let body;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  const email = normEmail(body?.email);
  if (!validEmail(email)) return bad('請輸入有效的 Email');
  if (!env.AUTH_SECRET) return bad('登入尚未設定', 503);

  const now = Date.now();
  const prev = await env.DB.prepare('SELECT sent_at, sent_count, window_at FROM login_codes WHERE email = ?1').bind(email).first();
  let count = 1, windowAt = now;
  if (prev) {
    if (now - prev.sent_at < MIN_GAP_MS) return bad('請稍候一分鐘再重新寄送', 429);
    if (now - prev.window_at < 3_600_000) {
      if (prev.sent_count >= MAX_PER_HOUR) return bad('寄送次數過多，請一小時後再試', 429);
      count = prev.sent_count + 1; windowAt = prev.window_at;
    }
  }

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  const hash = await sha256(`${email}:${code}:${env.AUTH_SECRET}`);
  await env.DB.prepare(
    `INSERT INTO login_codes (email, code_hash, expires, tries, sent_at, sent_count, window_at) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)
     ON CONFLICT(email) DO UPDATE SET code_hash = ?2, expires = ?3, tries = 0, sent_at = ?4, sent_count = ?5, window_at = ?6`,
  ).bind(email, hash, now + CODE_MINUTES * 60_000, now, count, windowAt).run();

  if (env.DEV_ECHO_CODE === '1') return json({ ok: true, dev_code: code });   // local development only, never set in production
  const subject = `Smart Flight Finder 登入碼 ${code}`;
  const text = `你的登入碼是 ${code}，${CODE_MINUTES} 分鐘內有效。\n如果不是你本人操作，請忽略這封信。`;
  const html = `<p>你的登入碼是</p><p style="font-size:28px;letter-spacing:6px"><b>${code}</b></p><p>${CODE_MINUTES} 分鐘內有效。如果不是你本人操作，請忽略這封信。</p>`;
  try {
    if (env.EMAIL) {                       // Cloudflare Email Sending binding
      await env.EMAIL.send({ from: env.MAIL_FROM, to: email, subject, text, html });
    } else if (env.RESEND_API_KEY) {       // Resend (https://resend.com)
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject, text, html }),
      });
      if (!r.ok) throw new Error(`Resend HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    } else {
      return bad('登入尚未設定寄信方式', 503);
    }
  } catch (e) {
    console.error('mail failed', e?.message || e);
    return bad('寄信失敗，請稍後再試', 502);
  }
  return json({ ok: true });
}
