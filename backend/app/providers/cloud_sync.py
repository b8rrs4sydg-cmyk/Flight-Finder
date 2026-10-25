"""Push priced fares to the public database on Cloudflare (``functions/api/ingest.js``).

Optional: with ``CF_INGEST_URL`` and ``CF_INGEST_TOKEN`` set, the crawlers also post what they priced, so the live page sees
it within a minute and without a git deploy. Git stays the backup. A failed push is logged and dropped: the next flush
sends the same keys again from the overlay file, and the crawl itself never depends on it.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request
from collections.abc import Iterable

log = logging.getLogger(__name__)

CHUNK_FARES = 500  # the endpoint accepts up to 1000 per request
CHUNK_KEYS = 4000  # and up to 5000 flagged keys
RETRIES = 3


class CloudSink:
    def __init__(self, url: str, token: str, timeout: float = 25.0) -> None:
        self.url, self.token, self.timeout = url, token, timeout

    @classmethod
    def from_env(cls) -> CloudSink | None:
        url, token = (
            os.getenv("CF_INGEST_URL", "").strip(),
            os.getenv("CF_INGEST_TOKEN", "").strip(),
        )
        return cls(url, token) if url and token else None

    def _post(self, payload: dict) -> bool:
        data = json.dumps(payload, separators=(",", ":")).encode()
        for attempt in range(RETRIES):
            req = urllib.request.Request(
                self.url,
                data=data,
                headers={
                    "content-type": "application/json",
                    "authorization": f"Bearer {self.token}",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    return r.status == 200
            except urllib.error.HTTPError as e:
                if e.code in (400, 401, 403, 413):  # retrying cannot help
                    log.warning("cloud ingest refused: HTTP %s", e.code)
                    return False
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                log.warning("cloud ingest failed: %s", e)
            time.sleep(1 + attempt * 2)
        return False

    def push(
        self,
        fares: dict[str, dict],
        missing: Iterable[str] = (),
        unavailable: Iterable[str] = (),
        generated_at: str = "",
        coverage: dict | None = None,
    ) -> bool:
        """Send everything; True when every request was accepted."""

        ok = True
        items = list(fares.items())
        first = {k: v for k, v in (("generated_at", generated_at), ("coverage", coverage)) if v}
        for i in range(0, len(items), CHUNK_FARES):
            payload: dict = {"fares": dict(items[i : i + CHUNK_FARES])}
            if i == 0:
                payload.update(first)
            ok &= self._post(payload)
        if not items and first:
            ok &= self._post({"fares": {}, **first})
        for kind, keys in (
            ("missing", sorted(set(missing))),
            ("unavailable", sorted(set(unavailable))),
        ):
            for i in range(0, len(keys), CHUNK_KEYS):
                ok &= self._post({"fares": {}, kind: keys[i : i + CHUNK_KEYS]})
        return ok
