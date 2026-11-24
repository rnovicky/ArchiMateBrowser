"""A minimal client of the Chrome DevTools protocol, Python standard library only (2.20.0).

run_tests.py uses it to open an offline copy of a model from disk (file://) in headless Chrome or Edge
and to ask the page, in real time, what it shows: `--dump-dom` with a virtual time budget does not wait
for web workers, and the offline copy lays out its diagrams in one (ELK).

    with Browser(exe) as browser:
        page = browser.open("file:///…/copy.html#…")
        page.wait_for("document.querySelectorAll('.v-node').length > 0", timeout=30)
        print(page.evaluate("document.title"))
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _WebSocket:
    """Just enough of RFC 6455 for the DevTools protocol: text frames, client masking, no extensions."""

    def __init__(self, url: str):
        host_port, path = url.removeprefix("ws://").split("/", 1)
        host, port = host_port.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=60)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET /{path} HTTP/1.1\r\nHost: {host_port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        response = b""
        while b"\r\n\r\n" not in response:
            response += self.sock.recv(4096)
        if b" 101 " not in response.split(b"\r\n", 1)[0]:
            raise ConnectionError(response.decode(errors="replace"))
        self.buffer = response.split(b"\r\n\r\n", 1)[1]

    def send(self, text: str) -> None:
        data = text.encode()
        mask = os.urandom(4)
        n = len(data)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536
                                else bytes([0x80 | 127]) + struct.pack(">Q", n))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _read(self, n: int) -> bytes:
        while len(self.buffer) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("the browser closed the connection")
            self.buffer += chunk
        data, self.buffer = self.buffer[:n], self.buffer[n:]
        return data

    def receive(self) -> str:
        message = b""
        while True:
            first, second = self._read(2)
            n = second & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(n)
            opcode = first & 0x0F
            if opcode == 8:
                raise ConnectionError("the browser closed the connection")
            if opcode in (0, 1, 2):
                message += payload
                if first & 0x80:
                    return message.decode(errors="replace")

    def close(self) -> None:
        self.sock.close()


class Page:
    def __init__(self, ws_url: str):
        self.ws = _WebSocket(ws_url)
        self.next_id = 0

    def call(self, method: str, **params):
        self.next_id += 1
        mine = self.next_id
        self.ws.send(json.dumps({"id": mine, "method": method, "params": params}))
        while True:
            message = json.loads(self.ws.receive())
            if message.get("id") == mine:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result", {})

    def evaluate(self, expression: str):
        """The value of a JavaScript expression in the page (a promise is awaited)."""
        result = self.call("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"].get("exception", {}).get("description") or result["exceptionDetails"])
        return result["result"].get("value")

    def wait_for(self, expression: str, timeout: float = 30) -> bool:
        """Poll until the expression is truthy; False when `timeout` seconds pass first."""
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                if self.evaluate(expression):
                    return True
            except RuntimeError:
                pass  # the page is still starting
            time.sleep(0.25)
        return False


class Browser:
    """A headless Chrome or Edge with a fresh profile; a context manager that removes it afterwards."""

    def __init__(self, exe: str):
        self.exe = exe

    def __enter__(self) -> "Browser":
        self.profile = tempfile.mkdtemp(prefix="archixmi-cdp-")
        self.port = _free_port()
        self.process = subprocess.Popen(
            [self.exe, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
             f"--user-data-dir={self.profile}", f"--remote-debugging-port={self.port}", "--window-size=1400,900", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        end = time.monotonic() + 30
        while time.monotonic() < end:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/version", timeout=2):
                    return self
            except OSError:
                time.sleep(0.2)
        self.__exit__(None, None, None)
        raise RuntimeError(f"{self.exe} did not open its DevTools port")

    def open(self, url: str) -> Page:
        # encoded: a "#" would end the request's own URL, and the page would lose its hash
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}/json/new?{urllib.parse.quote(url, safe='')}", method="PUT")
        with urllib.request.urlopen(request, timeout=10) as res:
            target = json.load(res)
        return Page(target["webSocketDebuggerUrl"])

    def __exit__(self, *exc) -> None:
        self.process.terminate()
        try:
            self.process.wait(10)
        except subprocess.TimeoutExpired:
            self.process.kill()
        shutil.rmtree(self.profile, ignore_errors=True)
