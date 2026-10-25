// Worker entry: /api/* is handled here (the same handlers that were written as Pages Functions), everything else is
// served from the static assets (public/). Deployed by the "Deploy to Cloudflare" button, see docs/cloudflare.md.
import * as fares from '../functions/api/fares.js';
import * as ingest from '../functions/api/ingest.js';
import * as authRequest from '../functions/api/auth/request.js';
import * as authVerify from '../functions/api/auth/verify.js';
import * as authLogout from '../functions/api/auth/logout.js';
import * as me from '../functions/api/me/index.js';
import * as meState from '../functions/api/me/state.js';

const ROUTES = {
  '/api/fares': fares,
  '/api/ingest': ingest,
  '/api/auth/request': authRequest,
  '/api/auth/verify': authVerify,
  '/api/auth/logout': authLogout,
  '/api/me': me,
  '/api/me/state': meState,
};
const METHODS = { GET: 'onRequestGet', POST: 'onRequestPost', PUT: 'onRequestPut', DELETE: 'onRequestDelete' };

const PLACEHOLDERS = new Set(['', 'auto', 'optional', 'change-me']);
const usable = v => typeof v === 'string' && !PLACEHOLDERS.has(v.trim());

/** The secrets as the handlers want them: a value typed into the deploy form wins, otherwise the one the deploy script generated. */
export function normalizeEnv(env) {
  return {
    ...env,
    AUTH_SECRET: usable(env.AUTH_SECRET) ? env.AUTH_SECRET : env.GENERATED_AUTH_SECRET,
    INGEST_TOKEN: usable(env.INGEST_TOKEN) ? env.INGEST_TOKEN : '',
    RESEND_API_KEY: usable(env.RESEND_API_KEY) ? env.RESEND_API_KEY : '',
  };
}

const notFound = () => new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const route = ROUTES[url.pathname.replace(/\/+$/, '')];
    if (!route) return notFound();
    const handler = route[METHODS[request.method]];
    if (!handler) return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { 'content-type': 'application/json' } });
    try {
      return await handler({ request, env: normalizeEnv(env), ctx });
    } catch (e) {
      console.error('api error', url.pathname, e?.stack || e);
      return new Response(JSON.stringify({ error: 'server error' }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  },
};
