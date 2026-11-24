"""Static file server + reverse proxy for the ArchiMate Browser.

Serves the browser app (the folder above this script) and forwards
``/api/*`` and ``/health`` to the ArchiMate API, so the browser talks to a
single origin and the API does not need CORS. Optionally injects the
``X-API-Key`` header so the key never has to be typed into the browser.

Python standard library only. Usage::

    python server/serve.py [--port 8090] [--api http://127.0.0.1:8000]
                           [--api-key KEY | --env-file ../ArchiMateAPI/.env]
                           [--csp-allow ORIGIN ...] [--no-csp] [--open]
                           [--exit-with-stdin]

The API key can also be given via the ARCHIXMI_API_KEY environment variable.
The browser only reads, so give it a key with the role ``reader`` (see "API
keys and roles" in the API's README); *Import XMI* and *Delete model* are
then hidden. The API's own ``API_KEY`` (its admin key, read with --env-file
from the API's .env) is added only when the server listens on a loopback
address (2.13.0); on a shared machine people sign in with their own keys.

EN-3: the app's own files are served with a Content-Security-Policy that only
allows scripts from this server (no inline or injected script can run), so
model content that ends up in the page cannot read the API key or send data
elsewhere. Besides this server, the page may contact the public PlantUML
server and the origins given with ``--csp-allow`` (or ARCHIXMI_CSP_ALLOW,
space-separated): a self-hosted PlantUML server, or the API when it is used
directly instead of through this proxy.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
PROXY_PREFIXES = ("/api/", "/health")
# Hop-by-hop headers must not be forwarded (RFC 7230 §6.1).
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
}


DEFAULT_CSP_ALLOW = ("https://www.plantuml.com",)  # the default PlantUML server of the app's Settings


def origin_of(url: str) -> str | None:
    """'https://host:8088/plantuml' -> 'https://host:8088'; None if it is not an http(s) URL."""
    parts = urllib.parse.urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}"


def build_csp(allow: list[str] | tuple[str, ...]) -> str:
    """Content-Security-Policy of the app (EN-3). `allow`: extra origins for fetch() and images."""
    extra = " ".join(dict.fromkeys(o for o in (origin_of(a) for a in allow) if o))
    ext = f" {extra}" if extra else ""
    return "; ".join([
        "default-src 'self'",
        "script-src 'self'",  # no inline scripts, no eval: injected markup cannot run code
        "worker-src 'self'",  # the ELK layout worker
        "style-src 'self' 'unsafe-inline'",  # inline styles of generated / PlantUML SVG
        f"img-src 'self' data: blob:{ext}",  # sprites, PNG export, PlantUML images
        f"connect-src 'self'{ext}",  # API (via this proxy), PlantUML SVG, a directly used API
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'self'",  # no framing by other sites (the tests frame the app from this origin)
    ])


# The API's folder, next to this app's folder: its name, then its earlier names.
API_DIR_NAMES = ("ArchiMateAPI", "ArchimateXMIAPI", "ArchiXMIAPI")


def find_api_dir() -> Path | None:
    """The API's folder: $ARCHIXMI_API_DIR, or a folder next to this app under one of its usual names."""
    if os.environ.get("ARCHIXMI_API_DIR"):
        return Path(os.environ["ARCHIXMI_API_DIR"])
    for name in API_DIR_NAMES:
        if (APP_DIR.parent / name).is_dir():
            return APP_DIR.parent / name
    return None


def read_env_key(env_file: Path) -> tuple[str | None, str | None]:
    """
    Return (the API key, the variable it came from) from a dotenv-style file (read-only), or (None, None):
    the value of ARCHIXMI_API_KEY (this app's own .env) or else of API_KEY (the API's .env, its admin key).
    """
    found = {}
    try:
        for line in env_file.read_text(encoding="utf-8").splitlines():
            name, sep, value = line.strip().partition("=")
            if sep and name in ("ARCHIXMI_API_KEY", "API_KEY"):
                found.setdefault(name, value.strip().strip('"').strip("'"))
    except OSError:
        pass
    if found.get("ARCHIXMI_API_KEY"):
        return found["ARCHIXMI_API_KEY"], "ARCHIXMI_API_KEY"
    if found.get("API_KEY"):
        return found["API_KEY"], "API_KEY"
    return None, None


class Handler(SimpleHTTPRequestHandler):
    # keep-alive: every response below sets Content-Length, so HTTP/1.1 is safe
    protocol_version = "HTTP/1.1"
    api_base: str = "http://127.0.0.1:8000"
    api_key: str | None = None
    csp_allow: tuple[str, ...] = DEFAULT_CSP_ALLOW  # EN-3; None = no CSP header (--no-csp)

    # ---------------------------------------------------------------- routing
    def _is_proxy(self) -> bool:
        return self.path.startswith(PROXY_PREFIXES)

    def do_GET(self):  # noqa: N802
        if self.path == "/__proxy/info":
            csp = None if self.csp_allow is None else {"allow": [o for o in map(origin_of, self.csp_allow) if o]}
            return self._json(200, {"api": self.api_base, "apiKeyInjected": bool(self.api_key), "csp": csp})
        if self._is_proxy():
            return self._proxy()
        # Always send the current file: the base class answers If-Modified-Since with
        # 304 using one-second timestamps, which serves stale JS after quick edits.
        for h in ("If-Modified-Since", "If-None-Match"):
            if h in self.headers:
                del self.headers[h]
        return super().do_GET()

    def do_HEAD(self):  # noqa: N802
        return self._proxy() if self._is_proxy() else super().do_HEAD()

    def do_POST(self):  # noqa: N802
        return self._proxy() if self._is_proxy() else self.send_error(405)

    do_PUT = do_POST
    do_DELETE = do_POST

    # ---------------------------------------------------------------- helpers
    def _json(self, status: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _proxy(self):
        url = self.api_base.rstrip("/") + self.path
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP}
        if self.api_key and not self.headers.get("X-API-Key"):
            headers["X-API-Key"] = self.api_key
        req = urllib.request.Request(url, data=body, headers=headers, method=self.command)
        # imports of large XMI files can take a while
        timeout = 600 if self.command in ("POST", "PUT") else 120
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.headers.get_content_type() == "text/event-stream":
                    return self._stream(resp)  # change events (API 3.17.0): passed on as they come
                answer = resp.status, resp.headers.items(), resp.read()
        except urllib.error.HTTPError as e:
            answer = e.code, e.headers.items(), e.read()
        except (urllib.error.URLError, OSError) as e:
            return self._json(502, {"code": "BAD_GATEWAY", "message": f"API not reachable at {self.api_base}: {e}"})
        # outside the try: a browser that has gone away meanwhile is not an unreachable API
        self._relay(*answer)

    def _relay(self, status: int, headers, data: bytes):
        self.send_response(status)
        for k, v in headers:
            if k.lower() not in HOP_BY_HOP:
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _stream(self, resp):
        """
        2.26.0: an answer that stays open (the API's change events, a text/event-stream) is passed on piece by
        piece, without Content-Length; the connection closes when either side ends it.
        """
        self.send_response(resp.status)
        for k, v in resp.headers.items():
            if k.lower() not in HOP_BY_HOP:
                self.send_header(k, v)
        self.send_header("Connection", "close")
        self.close_connection = True
        self.end_headers()
        try:
            while chunk := resp.read1(65536):
                self.wfile.write(chunk)
                self.wfile.flush()
        except OSError:
            pass  # the page went away, or the API stopped

    def end_headers(self):
        if not self._is_proxy():
            # Always serve the latest JS/CSS while the prototype is being developed.
            self.send_header("Cache-Control", "no-store")
            # EN-3: the app's own responses (proxied API answers are relayed unchanged)
            if self.csp_allow is not None:
                self.send_header("Content-Security-Policy", build_csp(self.csp_allow))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")  # the PlantUML server does not learn the page URL
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


Handler.extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript"}


LOOPBACK = ("127.0.0.1", "localhost", "::1")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=8090)
    p.add_argument("--bind", default="127.0.0.1", help="interface to listen on (default: localhost only)")
    # 127.0.0.1 rather than "localhost": on Windows "localhost" tries IPv6 (::1)
    # first, and uvicorn's default IPv4-only bind makes every request ~2 s slower.
    p.add_argument("--api", default=os.environ.get("ARCHIXMI_API", "http://127.0.0.1:8000"), help="root URL of the API (without /api/v2)")
    p.add_argument("--api-key", default=os.environ.get("ARCHIXMI_API_KEY"), help="X-API-Key to inject into proxied requests")
    p.add_argument("--env-file", type=Path, help="read the key from this .env file: ARCHIXMI_API_KEY, or else API_KEY (e.g. ../ArchiMateAPI/.env)")
    p.add_argument("--csp-allow", action="append", default=(os.environ.get("ARCHIXMI_CSP_ALLOW") or "").split(), metavar="ORIGIN",
                   help="extra origin the page may contact, e.g. a self-hosted PlantUML server http://127.0.0.1:8088 (repeatable)")
    p.add_argument("--no-csp", action="store_true", help="send no Content-Security-Policy header")
    p.add_argument("--open", action="store_true", help="open the app in the default web browser once the server listens")
    # RN-1 (2.29.0): the MCP server starts one of its own for images of diagrams, --port 0 (any free port; the
    # first line printed names it) and this, so that it ends with the MCP server however that ends
    p.add_argument("--exit-with-stdin", action="store_true", help="stop when standard input is closed (for a parent process)")
    args = p.parse_args()

    bad = [a for a in args.csp_allow if not origin_of(a)]
    if bad:
        p.error(f"--csp-allow needs http(s) URLs, got: {', '.join(bad)}")
    key, source = (args.api_key, "ARCHIXMI_API_KEY") if args.api_key else (
        read_env_key(args.env_file) if args.env_file else (None, None))
    if source == "API_KEY" and args.bind not in LOOPBACK:
        # MU-4 (2.13.0): the API's admin key only for one person on their own machine; on a shared one
        # everyone signs in with a key of their own, or the proxy adds a reader key (ARCHIXMI_API_KEY).
        print(f"Not adding the API's admin key (API_KEY of {args.env_file}): the browser listens on {args.bind}. "
              "Set ARCHIXMI_API_KEY to a reader key, or let everyone sign in.")
        key = None
    csp_allow = None if args.no_csp else (*DEFAULT_CSP_ALLOW, *args.csp_allow)
    handler = type("ConfiguredHandler", (Handler,), {"api_base": args.api, "api_key": key, "csp_allow": csp_allow})
    server = ThreadingHTTPServer((args.bind, args.port), partial(handler, directory=str(APP_DIR)))
    port = server.server_address[1]  # the one chosen with --port 0
    url = f"http://{'127.0.0.1' if args.bind in ('0.0.0.0', '') else args.bind}:{port}/"
    print(f"ArchiMate Browser: {url}  (proxy -> {args.api}, API key {'injected' if key else 'not injected'})", flush=True)
    print("Content-Security-Policy: " + ("off (--no-csp)" if csp_allow is None
          else "on, page may also contact " + ", ".join(dict.fromkeys(filter(None, map(origin_of, csp_allow))))), flush=True)
    if args.exit_with_stdin:
        def watch_stdin():
            try:
                while sys.stdin.buffer.read(4096):
                    pass
            except (OSError, ValueError):
                pass
            os._exit(0)  # the parent is gone: serve_forever() would not return by itself
        threading.Thread(target=watch_stdin, daemon=True).start()
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
