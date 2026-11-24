"""Test server for the ArchiMate Browser tests (EN-1, UP-2).

Serves the app like ``server/serve.py`` and proxies ``/api/*`` and ``/health``
to a **real ArchiMate API**, which it starts itself on a temporary SQLite
database and fills with two models:

* the browser's fixture, ``tests/fixture/model.json`` (as an exchange file,
  see ``fixture_xml.py``): the model most tests use;
* the API's own synthetic test model, ``tests/fixtures/Synthetic_Model.xml``
  in the API folder: views in folders, connections that end on connections,
  properties with languages.

So the tests need the API folder next to this one (``..\\ArchiMateAPI``, or an
earlier name of it, or ``ARCHIXMI_API_DIR``) and the API's Python packages.
The API is run with ``.venv`` of that folder when there is one, else with the
Python that runs this script (``ARCHIXMI_API_PYTHON`` overrides both). The
API's own database and ``.env`` are not touched.

Extra routes:

* ``GET /__test/ids.json``   the ids the API gave the two models and their items, by XMI identifier
* ``GET /__test/oas.json``   the API's ``xmi_oas.json``, for the type-mapping check
* ``GET /__test/api``        the state set below, and ``v1Requests``: how many requests asked for ``/api/v1``
* ``POST /__test/results``   the test page reports its results here (see run_tests.py)
* ``POST /__test/linked-file?name=X.archimate``  writes the body to the folder whose files the API may
  link (linked models, the API's BL-42). The API converts such files with ``fake_archi.py``, which
  copies them: they hold exchange XML. ``ids.json`` names the folder as ``linkedDir``.
* ``POST /__test/offline-copy?name=X.html``  writes the body, an offline copy of a model (2.20.0), to a
  folder of its own; ``ids.json`` names it as ``offlineDir``. ``GET /__test/offline/X.html`` serves it
  (the smoke tests load it in their frame); run_tests.py also opens it from disk.
* ``POST /__test/api``       ``{"down": bool, "delay": ms, "role": "admin"|"reader"|"none", "old": bool,
  "version": "2.0.0"}``: simulate an unreachable (502) or slow API (EN-2), let the proxy use the
  reader key (API-8), answer like an API older than 2.0.0, which has no ``/api/v2``, or let
  ``/health`` report another version (UP-1)

Python standard library only (the API it starts has its own requirements).
Usually started by ``run_tests.py``; on its own::

    python tests/test_server.py [--port 8093]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

TESTS_DIR = Path(__file__).resolve().parent
APP_DIR = TESTS_DIR.parent
sys.path.insert(0, str(APP_DIR / "server"))
sys.path.insert(0, str(TESTS_DIR))
from fixture_xml import fixture_xml  # noqa: E402
from serve import Handler as AppHandler, find_api_dir  # noqa: E402  (static serving, proxy, security headers)

ADMIN_KEY = "browser-tests-admin-key"
READER_KEY = "browser-tests-reader-key"
SYNTHETIC_MODEL = Path("tests") / "fixtures" / "Synthetic_Model.xml"


class ApiNotAvailable(RuntimeError):
    """The API cannot be started: the message says what is missing."""


# ---------------------------------------------------------------- the API under test

def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _api_python(api_dir: Path) -> str:
    if os.environ.get("ARCHIXMI_API_PYTHON"):
        return os.environ["ARCHIXMI_API_PYTHON"]
    for candidate in (api_dir / ".venv" / "Scripts" / "python.exe", api_dir / ".venv" / "bin" / "python"):
        if candidate.is_file():
            return str(candidate)
    return sys.executable


class TestApi:
    """A real API on a temporary database, holding the fixture and the synthetic model."""

    def __init__(self, api_dir: Path | None = None, require_if_match: bool | None = None):
        # REQUIRE_IF_MATCH of the test API (2.29.0): as given, else ARCHIMATE_TEST_REQUIRE_IF_MATCH, else true.
        # On, the API refuses a change that says no version, so the tests show that every write of the app
        # sends one; ARCHIMATE_TEST_REQUIRE_IF_MATCH=false runs them against an API that does not ask
        if require_if_match is None:
            require_if_match = os.environ.get("ARCHIMATE_TEST_REQUIRE_IF_MATCH", "true").lower() not in ("0", "false", "no")
        self.require_if_match = require_if_match
        self.api_dir = api_dir or find_api_dir()
        if not self.api_dir or not (self.api_dir / "app" / "main.py").is_file():
            raise ApiNotAvailable(
                "The tests run against the real API and did not find its folder. Put it next to this one as "
                "ArchiMateAPI, or set ARCHIXMI_API_DIR.")
        self.tmp = Path(tempfile.mkdtemp(prefix="archixmi-api-"))
        self.log_path = self.tmp / "api.log"
        self.proc: subprocess.Popen | None = None
        self.base = ""
        self.ids: dict = {}

    def start(self) -> "TestApi":
        port = _free_port()
        self.base = f"http://127.0.0.1:{port}"
        self.linked_dir = self.tmp / "linked"
        self.linked_dir.mkdir()
        self.offline_dir = self.tmp / "offline"
        self.offline_dir.mkdir()
        # A stand-in for Archi (fake_archi.py), so that no test needs Archi installed.
        fake_archi = self.tmp / "fake-archi.cmd"
        fake_archi.write_text(f'@"{sys.executable}" "{Path(__file__).with_name("fake_archi.py")}" %*\r\n', encoding="utf-8")
        keys = self.tmp / "keys.json"
        keys.write_text(json.dumps([{"name": "browser-tests-reader", "role": "reader",
                                     "sha256": hashlib.sha256(READER_KEY.encode()).hexdigest()}]), encoding="utf-8")
        env = {
            **os.environ,
            "DB_URL": f"sqlite:///{(self.tmp / 'test.db').as_posix()}",
            "API_KEY": ADMIN_KEY, "API_KEYS_FILE": str(keys),
            "HOST": "127.0.0.1", "PORT": str(port),
            "XSD_DIR": str(self.api_dir / "xsd"),
            "CORS_ORIGINS": "", "V1_SUNSET": "", "MAX_PAGE_SIZE": "1000",
            "ARCHI_PATH": str(fake_archi), "LINKED_FILES_DIRS": str(self.linked_dir), "LINK_SCHEDULER": "false",
            # the API's own .env (read from its folder) must not change how it answers (2.29.0)
            "REQUIRE_IF_MATCH": "true" if self.require_if_match else "false",
        }
        python = _api_python(self.api_dir)
        try:
            migrate = subprocess.run([python, "-m", "alembic", "upgrade", "head"], cwd=self.api_dir, env=env,
                                     capture_output=True, text=True, errors="replace")
        except OSError as e:
            raise ApiNotAvailable(f"Cannot run {python}: {e}") from e
        if migrate.returncode:
            raise ApiNotAvailable(f"Creating the API's test database failed ({python} -m alembic upgrade head in "
                                  f"{self.api_dir}). Are the API's packages installed?\n{migrate.stderr[-1500:]}")
        with open(self.log_path, "w", encoding="utf-8") as log:
            self.proc = subprocess.Popen([python, "-m", "app"], cwd=self.api_dir, env=env, stdout=log, stderr=subprocess.STDOUT)
        for _ in range(120):
            if self.proc.poll() is not None:
                raise ApiNotAvailable(f"The API stopped while starting:\n{self.log_tail()}")
            try:
                with urllib.request.urlopen(self.base + "/health", timeout=2):
                    break
            except (urllib.error.URLError, OSError):
                time.sleep(0.25)
        else:
            raise ApiNotAvailable(f"The API did not answer /health within 30 s:\n{self.log_tail()}")
        self.ids = {
            "fixture": self._import("fixture.xml", fixture_xml()),
            "synthetic": self._import("synthetic.xml", (self.api_dir / SYNTHETIC_MODEL).read_bytes()),
            "linkedDir": str(self.linked_dir),
            "offlineDir": str(self.offline_dir),
        }
        return self

    def log_tail(self, lines: int = 25) -> str:
        try:
            return "\n".join(self.log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:])
        except OSError:
            return ""

    def call(self, method: str, path: str, *, data: bytes | None = None, content_type: str | None = None):
        request = urllib.request.Request(self.base + path, data=data, method=method, headers={"X-API-Key": ADMIN_KEY})
        if method in ("PUT", "DELETE"):  # the tests' own writes: whatever the item is now (2.29.0)
            request.add_header("If-Match", "*")
        if content_type:
            request.add_header("Content-Type", content_type)
        with urllib.request.urlopen(request, timeout=120) as response:
            body = response.read()
        return json.loads(body) if body else None

    def _all(self, path: str) -> list:
        items, offset = [], 0
        while True:
            page = self.call("GET", f"{path}?limit=1000&offset={offset}")
            items += page["items"]
            offset += len(page["items"])
            if offset >= page["total"] or not page["items"]:
                return items

    def _import(self, name: str, xml: bytes) -> dict:
        """Import a file; return the ids of the model and its items by XMI identifier (folders by label)."""
        boundary = uuid.uuid4().hex
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
                f"Content-Type: application/xml\r\n\r\n").encode() + xml + f"\r\n--{boundary}--\r\n".encode()
        try:
            result = self.call("POST", "/api/v2/models/import", data=body, content_type=f"multipart/form-data; boundary={boundary}")
        except urllib.error.HTTPError as e:
            raise ApiNotAvailable(f"The API refused {name}: {e.code} {e.read().decode(errors='replace')[:1500]}") from e
        # API 3.8.0 warns about relationships ArchiMate does not allow; the synthetic model has one on purpose
        unexpected = [w for w in result["warnings"] if "is not allowed by ArchiMate" not in w]
        if unexpected:
            raise ApiNotAvailable(f"The API imported {name} with warnings: {unexpected[:10]}")
        mid = result["model"]["id"]
        by_xmi = lambda items: {x["xmiIdentifier"]: x["id"] for x in items}  # noqa: E731
        folders: dict = {}

        def walk(items):
            for o in items:
                if o.get("refElementId") is None and o.get("refRelationshipId") is None and o.get("refViewId") is None:
                    folders[o.get("label") or ""] = o["id"]
                    walk(o.get("children") or [])
        walk(self.call("GET", f"/api/v2/models/{mid}/organizations"))
        return {
            "model": mid,
            "elements": by_xmi(self._all(f"/api/v2/models/{mid}/elements")),
            "relationships": by_xmi(self._all(f"/api/v2/models/{mid}/relationships")),
            "views": by_xmi(self._all(f"/api/v2/models/{mid}/views")),
            "folders": folders,
        }

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        shutil.rmtree(self.tmp, ignore_errors=True)


# ---------------------------------------------------------------- handler

class TestHandler(AppHandler):
    ids: bytes = b"{}"
    linked_dir: Path | None = None
    offline_dir: Path | None = None
    oas_path: Path = Path()
    results: dict | None = None
    results_ready: threading.Event | None = None
    counters: dict = {"v1": 0}
    api_state: dict = {}  # {"down": bool, "delay": ms, "role": "admin" | "reader", "old": bool}, set with POST /__test/api

    @property
    def api_key(self):  # the proxy injects it; a test can ask for the reader key (API-8), or none (MU-4)
        role = self.api_state.get("role")
        return READER_KEY if role == "reader" else None if role == "none" else ADMIN_KEY

    def end_headers(self):
        # an offline copy runs without the app's security headers, as when it is opened from disk:
        # its own start script is inline and its modules are Blob URLs, which the app's CSP forbids
        if urlsplit(self.path).path.startswith("/__test/offline/"):
            return super(AppHandler, self).end_headers()
        return super().end_headers()

    def do_GET(self):  # noqa: N802
        path = urlsplit(self.path).path
        if path == "/__test/api":
            return self._json(200, {**self.api_state, "v1Requests": self.counters["v1"],
                                    "requireIfMatch": self.require_if_match})
        if path == "/__test/ids.json":
            return self._bytes(200, self.ids, "application/json")
        if path == "/__test/oas.json":
            if not self.oas_path.is_file():
                return self._json(404, {"message": f"{self.oas_path} not found"})
            return self._bytes(200, self.oas_path.read_bytes(), "application/json")
        if path.startswith("/__test/offline/"):
            # an offline copy saved by POST /__test/offline-copy, served like any page of the app
            name = Path(path).name
            file = self.offline_dir / name if self.offline_dir else None
            if not file or not file.is_file():
                return self._json(404, {"message": f"no offline copy {name}"})
            return self._bytes(200, file.read_bytes(), "text/html; charset=utf-8")
        return super().do_GET()

    def do_POST(self):  # noqa: N802
        path = urlsplit(self.path).path
        if path == "/__test/api":
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            self.api_state.clear()
            self.api_state.update(down=bool(body.get("down")), delay=max(0, int(body.get("delay") or 0)),
                                  role=body.get("role") if body.get("role") in ("reader", "none") else "admin",
                                  old=bool(body.get("old")),
                                  version=str(body.get("version") or ""))
            return self._json(200, self.api_state)
        if path == "/__test/linked-file":
            name = Path(parse_qs(urlsplit(self.path).query).get("name", [""])[0]).name
            if not self.linked_dir or not name.endswith(".archimate"):
                return self._json(400, {"message": "name must be a file name ending with .archimate"})
            length = int(self.headers.get("Content-Length") or 0)
            (self.linked_dir / name).write_bytes(self.rfile.read(length))
            return self._json(200, {"path": str(self.linked_dir / name)})
        if path == "/__test/offline-copy":
            name = Path(parse_qs(urlsplit(self.path).query).get("name", [""])[0]).name
            if not self.offline_dir or not name.endswith(".html"):
                return self._json(400, {"message": "name must be a file name ending with .html"})
            length = int(self.headers.get("Content-Length") or 0)
            (self.offline_dir / name).write_bytes(self.rfile.read(length))
            return self._json(200, {"path": str(self.offline_dir / name)})
        if path == "/__test/results":
            length = int(self.headers.get("Content-Length") or 0)
            type(self).results = json.loads(self.rfile.read(length) or b"{}")
            self._bytes(204, b"", "text/plain")
            if self.results_ready:
                self.results_ready.set()
            return None
        return super().do_POST()

    def _bytes(self, status: int, data: bytes, ctype: str):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if data:
            self.wfile.write(data)

    def _proxy(self):
        if self.path.startswith("/api/v1"):
            self.counters["v1"] += 1
        if self.api_state.get("delay"):
            time.sleep(self.api_state["delay"] / 1000)
        if self.api_state.get("down"):  # like serve.py when the API does not answer
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                self.rfile.read(length)
            return self._json(502, {"code": "BAD_GATEWAY", "message": "API not reachable (simulated by the test server)."})
        if self.api_state.get("version") and urlsplit(self.path).path == "/health":
            return self._json(200, {"status": "ok", "version": self.api_state["version"], "apiVersions": ["v1", "v2"]})
        if self.api_state.get("old"):  # like API 1.x: /health without a version, no /api/v2
            if urlsplit(self.path).path == "/health":
                return self._json(200, {"status": "ok"})
            if self.path.startswith("/api/v2"):
                return self._json(404, {"detail": "Not Found"})
        return super()._proxy()

    def log_message(self, fmt, *args):  # quiet: only errors (not the 502s of a simulated outage)
        if self.api_state.get("down") or self.api_state.get("old"):
            return
        if args and str(args[1] if len(args) > 1 else "").startswith(("4", "5")) and "/favicon" not in str(args[0]):
            sys.stderr.write("[test-server] %s\n" % (fmt % args))


class QuietServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # the browser drops keep-alive connections when it closes: not an error worth a traceback
        if isinstance(sys.exc_info()[1], (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def make_server(port: int = 0, api_dir: Path | None = None):
    """
    A ThreadingHTTPServer on 127.0.0.1:<port> (0 = any free port) serving the app, with a
    freshly started API behind it. Call ``server.api.stop()`` when done. Raises ApiNotAvailable.
    """
    api = TestApi(api_dir)
    try:
        api.start()
    except BaseException:
        api.stop()
        raise
    handler = type("ProxyHandler", (TestHandler,), {
        "api_base": api.base, "ids": json.dumps(api.ids).encode(), "oas_path": api.api_dir / "xmi_oas.json",
        "linked_dir": api.linked_dir, "offline_dir": api.offline_dir, "require_if_match": api.require_if_match,
        "results": None, "results_ready": threading.Event(), "counters": {"v1": 0}, "api_state": {"down": False, "delay": 0, "role": "admin"},
    })
    server = QuietServer(("127.0.0.1", port), partial(handler, directory=str(APP_DIR)))
    server.handler_class = handler
    server.api = api
    return server


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=8093)
    p.add_argument("--api-dir", type=Path, default=None, help="the API folder (default: next to this one)")
    args = p.parse_args()
    try:
        server = make_server(args.port, args.api_dir)
    except ApiNotAvailable as e:
        sys.exit(str(e))
    print(f"Tests: http://127.0.0.1:{server.server_port}/tests/   App with the fixture: "
          f"http://127.0.0.1:{server.server_port}/#model={server.api.ids['fixture']['model']}   API: {server.api.base}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.api.stop()


if __name__ == "__main__":
    main()
