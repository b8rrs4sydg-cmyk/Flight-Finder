# Running on Cloudflare

```
GitHub Actions crawlers ──POST /api/ingest──▶ Cloudflare D1 ◀── Pages Functions ◀── the page (Cloudflare Pages)
        │                                       public fares        /api/fares            /api/me  /api/me/state
        └─ git commits (backup, unchanged)      users / sessions / favourites / recent searches
```

* The page (`public/`) and the API (`functions/api/*`) are one Cloudflare Pages project, `flight-finder`.
* **Public database** (D1 tables `fares`, `flags`, `meta`): every crawler also posts what it priced to `/api/ingest`
  (`backend/app/providers/cloud_sync.py`; the git commits stay as the backup). The page reads `/api/fares` (full read in
  pages of 4,000 keys, then `?since=` every 5 minutes); on any other host it falls back to the repository files.
* **Accounts**: e-mail one-time code (`/api/auth/request`, `/api/auth/verify`), a 90-day session cookie. Favourites, the
  price when starred, recent searches and the form's last settings are kept in `user_state`; the browser's `localStorage`
  stays the working copy and is merged with the account on sign-in (`acctPull` / `acctPush` in the page).
* `functions/api/_lib.js` has the merge rule for fares (newest `at` wins, histories joined: same as `merge_fare_files.py`).

## One-time setup (needs your Cloudflare account)

1. **D1**: `npx wrangler d1 create flight-finder`, then put the printed `database_id` into `wrangler.toml`.
2. **Secrets for the Pages project** (`npx wrangler pages secret put NAME --project-name flight-finder`):
   `INGEST_TOKEN` (a long random string) and `AUTH_SECRET` (another one; it salts the login-code hashes).
3. **E-mail**: onboard a domain under *Email Service → Email Sending* (Workers Paid plan; the domain must use Cloudflare DNS),
   then set `MAIL_FROM` in `wrangler.toml` to an address on it (`login@your-domain`).
4. **GitHub repository secrets**: `CLOUDFLARE_API_TOKEN` (Pages: Edit, D1: Edit) and `CLOUDFLARE_ACCOUNT_ID` (deploy workflow
   `cloudflare.yml`); `CF_INGEST_URL` (`https://<project>.pages.dev/api/ingest`) and `CF_INGEST_TOKEN` (= `INGEST_TOKEN`) for the crawlers.
5. Push to `main` (or run the *Deploy to Cloudflare Pages* workflow). It applies `migrations/` and deploys.
6. **Seed the database** once from the committed files:
   `cd backend && CF_INGEST_URL=… CF_INGEST_TOKEN=… python -m scripts.push_to_cloudflare --public ../public`.

Without the secrets nothing changes: the crawlers keep committing to git and the page keeps reading raw GitHub.

## Limits to keep in mind

* D1 free plan: 5 M rows read / day, 100 k rows written / day. The page reads each key once per browser session
  (a full read is ~23 k rows; the full pages are cached 5 minutes at the edge) and then only changed rows; the
  crawlers push only what they just priced, and `/api/ingest` skips entries that did not change.
* Login codes: one per address per minute, five per hour, five wrong tries per code.
* Account data is personal data: `DELETE /api/me` (the 刪除帳號 button) removes the user, sessions and saved state.
* Cloudflare Browser Run identifies itself as a bot, so the crawlers stay on GitHub Actions (see the notes in CLAUDE.md).
