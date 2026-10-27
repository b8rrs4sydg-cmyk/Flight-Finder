# Running on Cloudflare

```
GitHub Actions crawlers ──POST /api/ingest──▶ Cloudflare D1 ◀── Worker (/api/*) ◀── the page (static assets, same Worker)
        │                                       public fares        /api/fares            /api/me  /api/me/state
        └─ git commits (backup, unchanged)      users / sessions / favourites / recent searches
```

* The page (`public/`) and the API (`functions/api/*`) are one Cloudflare Worker, `flight-finder` (static assets + `/api/*`).
* **Public database** (D1 tables `fares`, `flags`, `meta`): every crawler also posts what it priced to `/api/ingest`
  (`backend/app/providers/cloud_sync.py`; the git commits stay as the backup). The page reads `/api/fares` (full read in
  pages of 4,000 keys, then `?since=` every 5 minutes); on any other host it falls back to the repository files.
* **Accounts**: e-mail one-time code (`/api/auth/request`, `/api/auth/verify`), a 90-day session cookie. Favourites, the
  price when starred, recent searches and the form's last settings are kept in `user_state`; the browser's `localStorage`
  stays the working copy and is merged with the account on sign-in (`acctPull` / `acctPush` in the page).
* `functions/api/_lib.js` has the merge rule for fares (newest `at` wins, histories joined: same as `merge_fare_files.py`).

## Setup: the "Deploy to Cloudflare" button

The README button copies the repository to your GitHub account, creates the D1 database (by the name `flight-finder`, or reuses
it) and deploys the Worker with Workers Builds. `package.json` supplies the commands (`npm run build`: sanity check;
`npm run deploy`: `scripts/deploy.mjs` = D1 migrations, a generated private `GENERATED_AUTH_SECRET` once, `wrangler deploy`), `.dev.vars.example` the
first-deploy form (`AUTH_SECRET=auto`, `INGEST_TOKEN`, `RESEND_API_KEY=optional`) and `wrangler.toml` the bindings
(`DB`, `ASSETS`; no `database_id`, it is provisioned).

After the first deploy:

1. **Build watch paths** (Worker → Settings → Builds): exclude `public/fares.json,public/fares-live*.json,public/daemon*.json,public/live-request.json,public/*.lock`,
   otherwise every crawler data commit starts a build. (They are also kept out of the static assets by `public/.assetsignore`.)
2. **Login mail**: either uncomment `[[send_email]]` in `wrangler.toml` (Cloudflare Email Sending: Workers Paid, a domain on Cloudflare DNS, `MAIL_FROM` on it)
   or set the secret `RESEND_API_KEY` (Resend, verified domain). Without either, `/api/auth/request` answers 503 and the page works without accounts.
3. **Crawlers**: GitHub secret `CF_INGEST_TOKEN` (= the `INGEST_TOKEN` you typed). The workflows default `CF_INGEST_URL` to this deployment's `/api/ingest`; a fork sets its own `CF_INGEST_URL` secret (`https://<worker>.workers.dev/api/ingest`);
   then run the *Seed the Cloudflare fare database* workflow once.
4. The repository must be public for the crawlers (free Actions minutes) and for the raw-GitHub fallback of the page.

Manual alternative from GitHub: secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, then run *Deploy to Cloudflare (manual)*.
Local: `npm install`, `npx wrangler d1 migrations apply DB --local`, `npx wrangler dev` (add `--var DEV_ECHO_CODE:1 --var AUTH_SECRET:x --var INGEST_TOKEN:t` to try the login without mail), `npm run test:cf`.

## Deploying this repository directly (instead of the button's copy)

The button creates a *copy* of the repository (`<you>/<new name>`) that never receives later changes. To deploy from this repository itself:

1. `wrangler.toml` `name` must equal the Worker's name (Workers Builds refuses a mismatch). It is `flight-finder-app`, the name of the existing Worker, so the URL and its secrets are kept.
2. Cloudflare → Workers & Pages → the Worker → **Settings → Builds → Git repository**: disconnect the copy, connect **this** repository, branch `main`, root `/`,
   **Build command** `npm run build`, **Deploy command** `npm run deploy`; turn **Preview builds** off.
3. **Build watch paths → Exclude**: `public/fares.json,public/fares-live*.json,public/daemon*.json,public/live-request.json,public/*.lock`
   (the crawlers commit these every few minutes; only code, `index.html` and docs should start a build).
4. Runtime secrets (`INGEST_TOKEN`, the generated `GENERATED_AUTH_SECRET`) stay on the Worker; `npm run deploy` only creates a secret that is missing.

## Limits to keep in mind

* D1 free plan: 5 M rows read / day, 100 k rows written / day. The page reads each key once per browser session
  (a full read is ~23 k rows; the full pages are cached 5 minutes at the edge) and then only changed rows; the
  crawlers push only what they just priced, and `/api/ingest` skips entries that did not change.
* Login codes: one per address per minute, five per hour, five wrong tries per code.
* Account data is personal data: `DELETE /api/me` (the 刪除帳號 button) removes the user, sessions and saved state.
* Cloudflare Browser Run identifies itself as a bot, so the crawlers stay on GitHub Actions (see the notes in CLAUDE.md).

## Look-up queue (background search)

`POST /api/queue {keys}` (page, same origin) puts fare keys in the `queue` table; crawlers claim them with
`POST /api/queue?claim=N` (Bearer `INGEST_TOKEN`) and `/api/ingest` removes the keys it receives. `GET /api/queue` returns
`{pending, claimed}`. A claim not answered within 10 minutes is handed out again (3 tries, then dropped); the table is capped at
30,000 keys. This is what lets a search continue while a phone has frozen the tab.
