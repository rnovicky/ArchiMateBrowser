"""Run the ArchiMate Browser tests headless (EN-1) and report the result.

Starts tests/test_server.py on a free port (the app, and behind it the real
API on a temporary database: see that file), opens tests/index.html in
headless Chrome or Edge, waits for the page to POST its results, prints them
and exits with 0 (all passed), 1 (failures) or 2 (the tests could not run).
This script uses the Python standard library only; it needs a browser, and
the API folder next to this one with the API's packages installed.

    python tests/run_tests.py                 # all tests
    python tests/run_tests.py --filter store  # tests whose "suite › name" contains "store"
    python tests/run_tests.py --headed        # watch them run in a visible window
    python tests/run_tests.py --serve         # just serve; open the printed URL in any browser

The browser is found via $BROWSER_BIN, then Chrome / Chromium / Edge in the usual places.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_server import ApiNotAvailable, make_server  # noqa: E402
from cdp import Browser  # noqa: E402

CANDIDATES = [
    r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
    r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
    r"%LocalAppData%\Google\Chrome\Application\chrome.exe",
    r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
    r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]
ON_PATH = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "microsoft-edge", "msedge"]


def find_browser() -> str | None:
    if os.environ.get("BROWSER_BIN"):
        return os.environ["BROWSER_BIN"]
    for c in CANDIDATES:
        p = os.path.expandvars(c)
        if "%" not in p and Path(p).is_file():
            return p
    for name in ON_PATH:
        if shutil.which(name):
            return shutil.which(name)
    return None


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--filter", default="", help="run only tests whose 'suite › name' contains this text")
    p.add_argument("--headed", action="store_true", help="show the browser window")
    p.add_argument("--serve", action="store_true", help="only start the test server (Ctrl+C to stop)")
    p.add_argument("--port", type=int, default=0, help="test server port (default: any free port)")
    p.add_argument("--timeout", type=int, default=600, help="seconds to wait for the results (the suite takes about 5 minutes)")
    p.add_argument("--api-dir", type=Path, default=None, help="the API folder (default: ../ArchiMateAPI, or the API under an earlier name next to this folder)")
    p.add_argument("--verbose", action="store_true", help="list passed tests too")
    args = p.parse_args()
    for stream in (sys.stdout, sys.stderr):  # test names contain "›" and Czech text; never crash on a narrow console code page
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")

    print("Starting the API on a temporary database ...", flush=True)
    try:
        server = make_server(args.port, args.api_dir)
    except ApiNotAvailable as e:
        print(e, file=sys.stderr)
        return 2
    try:
        return run(args, server)
    finally:
        server.api.stop()


def run(args, server) -> int:
    port = server.server_port
    threading.Thread(target=server.serve_forever, daemon=True).start()
    query = {k: v for k, v in {"filter": args.filter, "report": "" if args.serve else "1"}.items() if v}
    url = f"http://127.0.0.1:{port}/tests/" + (f"?{urlencode(query)}" if query else "")

    if args.serve:
        print(f"Tests:            {url}\nApp with fixture: http://127.0.0.1:{port}/#model={server.api.ids['fixture']['model']}\n"
              f"API:              {server.api.base}\n(Ctrl+C to stop)")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return 0

    browser = find_browser()
    if not browser:
        print("No Chrome/Chromium/Edge found. Set BROWSER_BIN, or run with --serve and open the URL yourself.", file=sys.stderr)
        return 2
    profile = tempfile.mkdtemp(prefix="archixmi-tests-")
    cmd = [browser, f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
           "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--window-size=1500,1100"]
    if not args.headed:
        cmd += ["--headless=new", "--disable-gpu"]
    cmd.append(url)
    print(f"Running tests in {Path(browser).name} against http://127.0.0.1:{port}/ ...", flush=True)
    t0 = time.time()
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    handler = server.handler_class
    try:
        if not handler.results_ready.wait(args.timeout):
            print(f"No results after {args.timeout} s (run with --serve and open the test page in a browser to see why).", file=sys.stderr)
            return 1
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)

    res = handler.results
    marks = {"pass": "PASS", "fail": "FAIL", "skip": "SKIP"}
    for t in res["tests"]:
        if t["status"] != "pass" or args.verbose:
            print(f"{marks[t['status']]}  {t['suite']} › {t['name']}  ({t['ms']} ms)")
            if t.get("error"):
                print("      " + str(t["error"]).strip().replace("\n", "\n      "))
    passed, failed = res["passed"], res["failed"]
    for ok, name, error in offline_from_disk(browser, server.api):
        passed, failed = passed + ok, failed + (not ok)
        if not ok or args.verbose:
            print(f"{'PASS' if ok else 'FAIL'}  offline copy from disk › {name}")
            if error:
                print("      " + error)
    total = passed + failed + res["skipped"]
    print(f"\n{passed} passed, {failed} failed, {res['skipped']} skipped ({total} tests, {time.time() - t0:.1f} s)")
    return 1 if failed or not total else 0


# What an offline copy (2.20.0) shows when it is opened from disk, as a colleague opens it. The smoke tests
# save the copies (tests/smoke/app.test.js, offlineCopy). (name, file, hash, the condition waited for)
FROM_DISK = [
    ("the model, the banner and a neighbourhood diagram", "fixture.html", "#model=id-fixture-model&element=id-e6&d=nb~1~id-e6",
     "location.protocol === 'file:' && !document.querySelector('#offline-banner').hidden"
     " && document.querySelectorAll('#tab-layout .v-node[data-element]').length === 6"
     " && document.querySelector('#details h2')?.textContent === 'ERP'"),
    ("a stored view", "fixture.html", "#model=id-fixture-model&view=id-v1",
     "document.querySelector('#diagram-title').textContent.includes('Overview')"
     " && document.querySelectorAll('#tab-layout .v-node').length > 0"),
    ("the synthetic model and its folders", "synthetic.html", "",
     "[...document.querySelectorAll('#tree .tree-label')].some(l => l.textContent === 'Folders')"
     " && /elements/.test(document.querySelector('#status').textContent)"),
]


def offline_from_disk(browser: str, api) -> list[tuple[bool, str, str]]:
    """Open the offline copies the smoke tests saved, from disk, and check what they show; none saved: none."""
    checks = [c for c in FROM_DISK if (api.offline_dir / c[1]).is_file()]
    results: list[tuple[bool, str, str]] = []
    if not checks:
        return results
    with Browser(browser) as b:
        for name, file, hash_, condition in checks:
            page = b.open((api.offline_dir / file).as_uri() + hash_)
            ok = page.wait_for(condition, timeout=30)
            error = "" if ok else ("not shown within 30 s; status: "
                                   + str(page.evaluate("document.querySelector('#status')?.textContent || ''"))
                                   + "; " + str(page.evaluate("document.querySelector('.offline-failed')?.textContent || ''")))
            results.append((ok, name, error))
    return results


if __name__ == "__main__":
    sys.exit(main())
