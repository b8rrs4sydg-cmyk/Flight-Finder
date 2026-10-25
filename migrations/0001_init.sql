-- Public fare database: one row per query key, the entry kept exactly as the crawlers write it (JSON).
CREATE TABLE IF NOT EXISTS fares (
  key     TEXT PRIMARY KEY,
  entry   TEXT NOT NULL,
  at      TEXT NOT NULL DEFAULT '',   -- entry.at, to merge "newest wins" without parsing the JSON
  updated INTEGER NOT NULL            -- ms since epoch of the last write, for ?since= refreshes
);
CREATE INDEX IF NOT EXISTS fares_updated ON fares (updated);

-- Keys the crawlers could not price ("missing") or confirmed as no such flight ("unavailable").
CREATE TABLE IF NOT EXISTS flags (
  key     TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('missing', 'unavailable')),
  updated INTEGER NOT NULL,
  PRIMARY KEY (key, kind)
);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);

-- Accounts: an email address is the only identity.
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- One-time login codes (stored hashed, 10 minutes, 5 tries).
CREATE TABLE IF NOT EXISTS login_codes (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires    INTEGER NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0,
  sent_at    INTEGER NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 1,
  window_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

-- Per-user state: favourites, the price when starred, recent searches, form preferences.
CREATE TABLE IF NOT EXISTS user_state (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('favorites', 'favprices', 'history', 'prefs')),
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);
