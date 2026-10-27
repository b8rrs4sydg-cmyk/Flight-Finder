-- Look-up queue: the page drops the fare keys it still misses here, the crawlers (GitHub Actions) claim them in the
-- background, so a search keeps going when the phone browser freezes the tab. A key leaves the queue when ingest receives
-- its price (or a "no such flight" flag); a claim that is never answered returns after CLAIM_TTL (functions/api/queue.js).
CREATE TABLE IF NOT EXISTS queue (
  key        TEXT PRIMARY KEY,
  state      TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'claimed')),
  prio       INTEGER NOT NULL,          -- enqueue order (ms * 1000 + position): first asked, first priced
  tries      INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS queue_prio ON queue (state, prio);
