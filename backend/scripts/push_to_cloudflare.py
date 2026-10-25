"""Upload fare files to the public database on Cloudflare (seed it, or push a crawl's result).

    CF_INGEST_URL=https://<site>/api/ingest CF_INGEST_TOKEN=... \
        python -m scripts.push_to_cloudflare --public ../public            # fares.json + every fares-live*.json
    python -m scripts.push_to_cloudflare --file ../public/fares.json       # one file

The endpoint merges entry by entry (newest ``at`` wins, price histories joined), so running this twice is harmless.
"""

from __future__ import annotations

import argparse
import glob
import sys
from pathlib import Path

from app.providers.cloud_sync import CloudSink
from app.providers.fare_db import FareDatabase


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--public", type=Path, help="a public/ directory: fares.json and fares-live*.json"
    )
    ap.add_argument(
        "--file", type=Path, action="append", default=[], help="one fare file (repeatable)"
    )
    args = ap.parse_args()

    files = list(args.file)
    if args.public:
        files += [Path(p) for p in sorted(glob.glob(str(args.public / "fares*.json")))]
    sink = CloudSink.from_env()
    if not sink:
        print("CF_INGEST_URL / CF_INGEST_TOKEN are not set: nothing to do", file=sys.stderr)
        return 0
    if not files:
        print("no fare files given", file=sys.stderr)
        return 2

    failed = 0
    for path in files:
        db = FareDatabase.load(path)
        ok = sink.push(
            db.fares, db.missing, db.unavailable, db.generated_at or "", db.coverage or None
        )
        print(
            f"{path.name}: {len(db.fares)} fares, {len(db.missing)} missing, {len(db.unavailable)} unavailable -> {'ok' if ok else 'FAILED'}"
        )
        failed += not ok
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
