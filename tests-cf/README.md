# Cloudflare Functions smoke test

`smoke.mjs` drives the API in `functions/api/` (fare ingest + read, e-mail one-time-code login, per-user state) against a
local Pages dev server with a local D1 database:

```sh
npx wrangler@4 d1 migrations apply DB --local
npx wrangler@4 pages dev public --port 8801 --binding AUTH_SECRET=x INGEST_TOKEN=tok DEV_ECHO_CODE=1 &
BASE=http://localhost:8801 INGEST_TOKEN=tok node tests-cf/smoke.mjs
```

`DEV_ECHO_CODE=1` makes `/api/auth/request` return the code instead of mailing it. Never set it in production.
CI runs the same steps (job `cloudflare-functions`).
