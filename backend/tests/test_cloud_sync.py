import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from app.providers.cloud_sync import CHUNK_FARES, CloudSink


class _Server:
    def __init__(self, status=200):
        outer = self
        outer.posts, outer.status = [], status

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["content-length"]))
                outer.posts.append((self.headers["authorization"], json.loads(body)))
                self.send_response(outer.status)
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *a):
                pass

        self.httpd = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}/api/ingest"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()


def test_from_env_needs_both_settings(monkeypatch):
    monkeypatch.delenv("CF_INGEST_URL", raising=False)
    monkeypatch.setenv("CF_INGEST_TOKEN", "t")
    assert CloudSink.from_env() is None
    monkeypatch.setenv("CF_INGEST_URL", "https://x.example/api/ingest")
    assert CloudSink.from_env() is not None


def test_push_chunks_fares_and_sends_flags_separately():
    srv = _Server()
    try:
        fares = {f"ow|TPE|NRT|{i}": {"price": 1000 + i} for i in range(CHUNK_FARES + 3)}
        ok = CloudSink(srv.url, "tok").push(
            fares, missing=["ow|A|B|1"], generated_at="2026-10-25T00:00:00+00:00"
        )
    finally:
        srv.close()
    assert ok
    assert all(auth == "Bearer tok" for auth, _ in srv.posts)
    sent = [p for _, p in srv.posts]
    assert sum(len(p["fares"]) for p in sent) == CHUNK_FARES + 3
    assert sent[0]["generated_at"].startswith("2026-10-25") and "generated_at" not in sent[1]
    assert sent[-1] == {"fares": {}, "missing": ["ow|A|B|1"]}


def test_a_refused_push_is_reported_not_raised():
    srv = _Server(status=401)
    try:
        assert CloudSink(srv.url, "bad").push({"ow|A|B|1": {"price": 5}}) is False
    finally:
        srv.close()
