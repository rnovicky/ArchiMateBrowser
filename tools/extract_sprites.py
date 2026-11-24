"""Split PlantUML's ArchiMate sprite sheet into one file per sprite.

Input : inputs/archi_sprites.svg  (output of PlantUML `listsprites` for the
        archimate stdlib: each sprite is one <path> (vector) or one 15x15
        <image> (embedded PNG), followed by a "<name> (svg|png)" label)
Output: img/sprites/<name>.svg | <name>.png   one file per sprite
        img/sprites/sprites.json               manifest + inline data for diagrams
        img/sprites/index.html                 gallery for reviewing the result

Processing:
* Vector sprites: the path keeps its coordinates; the file gets a square
  viewBox centred on the path's exact bounding box (computed by sampling
  lines, Béziers and elliptical arcs), so all icons render at the same scale.
  Fill stays black on a transparent background.
* PNG sprites already have transparent backgrounds. Three of them
  (business-activity, business-meaning, business-value) are drawn in Archi's
  business yellow with an olive outline; they are converted to black ink with
  alpha derived from darkness, so they match the neutral set and work on any
  background colour.

Python standard library only. Usage:  python tools/extract_sprites.py
"""

from __future__ import annotations

import base64
import html
import json
import math
import re
import struct
import sys
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "inputs" / "archi_sprites.svg"
OUT = ROOT / "img" / "sprites"
NS = {"svg": "http://www.w3.org/2000/svg", "xlink": "http://www.w3.org/1999/xlink"}
XLINK_HREF = "{http://www.w3.org/1999/xlink}href"
LABEL_RE = re.compile(r"^\s*(?P<name>.+?)\s*\((?P<kind>png|svg)\)\s*$")


# ---------------------------------------------------------------- path bbox

def _tokens(d: str):
    for m in re.finditer(r"[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?", d):
        yield m.group(0)


def path_points(d: str):
    """Sample points along an SVG path (absolute and relative commands)."""
    toks = list(_tokens(d))
    i, cmd = 0, None
    x = y = sx = sy = 0.0
    last_ctrl = None
    pts = []

    def num():
        nonlocal i
        v = float(toks[i]); i += 1
        return v

    while i < len(toks):
        if re.fullmatch(r"[A-Za-z]", toks[i]):
            cmd = toks[i]; i += 1
            if cmd in "Zz":
                x, y = sx, sy; pts.append((x, y)); continue
        rel = cmd.islower()
        c = cmd.upper()
        ox, oy = (x, y) if rel else (0.0, 0.0)
        if c == "M":
            x, y = ox + num(), oy + num(); sx, sy = x, y; pts.append((x, y))
            cmd = "l" if rel else "L"  # implicit lineto after moveto
        elif c == "L":
            x, y = ox + num(), oy + num(); pts.append((x, y))
        elif c == "H":
            x = ox + num(); pts.append((x, y))
        elif c == "V":
            y = (y if rel else 0.0) + num(); pts.append((x, y))
        elif c in "CS":
            if c == "C":
                x1, y1 = ox + num(), oy + num()
            else:
                x1, y1 = (2 * x - last_ctrl[0], 2 * y - last_ctrl[1]) if last_ctrl else (x, y)
            x2, y2, ex, ey = ox + num(), oy + num(), ox + num(), oy + num()
            for k in range(1, 17):
                t = k / 16; mt = 1 - t
                pts.append((mt**3 * x + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t**3 * ex,
                            mt**3 * y + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t**3 * ey))
            last_ctrl = (x2, y2); x, y = ex, ey
            continue
        elif c in "QT":
            if c == "Q":
                x1, y1 = ox + num(), oy + num()
            else:
                x1, y1 = (2 * x - last_ctrl[0], 2 * y - last_ctrl[1]) if last_ctrl else (x, y)
            ex, ey = ox + num(), oy + num()
            for k in range(1, 17):
                t = k / 16; mt = 1 - t
                pts.append((mt * mt * x + 2 * mt * t * x1 + t * t * ex, mt * mt * y + 2 * mt * t * y1 + t * t * ey))
            last_ctrl = (x1, y1); x, y = ex, ey
            continue
        elif c == "A":
            rx, ry, rot, large, sweep = num(), num(), num(), num(), num()
            ex, ey = ox + num(), oy + num()
            pts.extend(_arc_points(x, y, rx, ry, rot, int(large), int(sweep), ex, ey))
            x, y = ex, ey
        last_ctrl = None
    return pts


def _arc_points(x1, y1, rx, ry, phi_deg, fa, fs, x2, y2, n=24):
    """Endpoint → centre parametrisation (SVG spec F.6.5), then sample."""
    if rx == 0 or ry == 0:
        return [(x2, y2)]
    phi = math.radians(phi_deg)
    cp, sp = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p, y1p = cp * dx + sp * dy, -sp * dx + cp * dy
    rx, ry = abs(rx), abs(ry)
    lam = x1p**2 / rx**2 + y1p**2 / ry**2
    if lam > 1:
        rx, ry = rx * math.sqrt(lam), ry * math.sqrt(lam)
    num = rx**2 * ry**2 - rx**2 * y1p**2 - ry**2 * x1p**2
    den = rx**2 * y1p**2 + ry**2 * x1p**2
    co = math.sqrt(max(0.0, num / den)) if den else 0.0
    if fa == fs:
        co = -co
    cxp, cyp = co * rx * y1p / ry, -co * ry * x1p / rx
    cx = cp * cxp - sp * cyp + (x1 + x2) / 2
    cy = sp * cxp + cp * cyp + (y1 + y2) / 2

    def ang(ux, uy, vx, vy):
        a = math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
        return a

    t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not fs and dt > 0:
        dt -= 2 * math.pi
    elif fs and dt < 0:
        dt += 2 * math.pi
    out = []
    for k in range(1, n + 1):
        t = t1 + dt * k / n
        out.append((cx + rx * math.cos(t) * cp - ry * math.sin(t) * sp, cy + rx * math.cos(t) * sp + ry * math.sin(t) * cp))
    return out


def bbox(points):
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


# ---------------------------------------------------------------- PNG codec (RGBA)

def png_decode(data: bytes):
    """Minimal PNG decoder: 8-bit, non-interlaced, colour types 0/2/3/4/6 → (w, h, rgba rows)."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, idat, plte, trns = 8, b"", None, None
    while pos < len(data):
        length, ctype = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            w, h, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
            if depth != 8 or interlace:
                raise ValueError(f"unsupported PNG (depth {depth}, interlace {interlace})")
        elif ctype == b"PLTE":
            plte = chunk
        elif ctype == b"tRNS":
            trns = chunk
        elif ctype == b"IDAT":
            idat += chunk
    bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows, prev = [], bytearray(stride)
    for r in range(h):
        f = raw[r * (stride + 1)]
        line = bytearray(raw[r * (stride + 1) + 1:(r + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + b) & 255
            elif f == 3: line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        prev = line
        px = []
        for i in range(w):
            s = line[i * bpp:(i + 1) * bpp]
            if color == 6: px.append(tuple(s))
            elif color == 2: px.append((*s, 255))
            elif color == 4: px.append((s[0], s[0], s[0], s[1]))
            elif color == 0: px.append((s[0], s[0], s[0], 255))
            else:  # palette
                k = s[0]
                alpha = trns[k] if trns and k < len(trns) else 255
                px.append((plte[3 * k], plte[3 * k + 1], plte[3 * k + 2], alpha))
        rows.append(px)
    return w, h, rows


def png_encode(w: int, h: int, rows) -> bytes:
    raw = b"".join(b"\x00" + bytes(v for p in row for v in p) for row in rows)
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def lum(r, g, b):
    return 0.299 * r + 0.587 * g + 0.114 * b


def to_neutral_ink(rows, fill=(255, 255, 181)):
    """Coloured sprite → black ink: alpha from darkness relative to the fill colour."""
    lf = lum(*fill)
    out = []
    for row in rows:
        out.append([(0, 0, 0, round(a * max(0.0, min(1.0, 1 - lum(r, g, b) / lf)))) for r, g, b, a in row])
    return out


def is_coloured(rows):
    return sum(1 for row in rows for r, g, b, a in row if a and max(r, g, b) - min(r, g, b) > 30) > 5


# ---------------------------------------------------------------- main

def main() -> int:
    tree = ET.parse(SRC)
    g = tree.getroot().find("svg:g", NS)
    if g is None:
        print("no <g> in sprite sheet", file=sys.stderr); return 1

    labels, graphics = [], []
    for el in g:
        tag = el.tag.split("}")[1]
        if tag == "text":
            m = LABEL_RE.match(el.text or "")
            if m:
                labels.append({"name": m["name"], "kind": m["kind"], "x": float(el.get("x")), "y": float(el.get("y")), "els": []})
        elif tag in ("path", "image"):
            if tag == "path":
                b = bbox(path_points(el.get("d")))
            else:
                x, y = float(el.get("x")), float(el.get("y"))
                b = (x, y, x + float(el.get("width")), y + float(el.get("height")))
            graphics.append((el, tag, b))

    # assign each graphic to the label just to its right on the same row
    for el, tag, b in graphics:
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        best, bd = None, math.inf
        for lab in labels:
            dx, dy = lab["x"] - cx, (lab["y"] - 4) - cy
            if 0 <= dx <= 30 and abs(dy) <= 10 and abs(dy) * 3 + dx < bd:
                best, bd = lab, abs(dy) * 3 + dx
        if best is None:
            print(f"warning: unassigned {tag} at {b}", file=sys.stderr)
        else:
            best["els"].append((el, tag, b))

    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"source": "inputs/archi_sprites.svg (PlantUML listsprites, archimate stdlib; credit: archimatetool.com)", "sprites": {}}
    for lab in labels:
        if len(lab["els"]) != 1:
            print(f"warning: {lab['name']} has {len(lab['els'])} graphics; skipped", file=sys.stderr)
            continue
        el, tag, b = lab["els"][0]
        name = lab["name"]
        entry = {"kind": tag if tag == "path" else "png"}
        if tag == "path":
            d = el.get("d")
            w, h = b[2] - b[0], b[3] - b[1]
            size = max(w, h) + 1.0  # square box + 0.5 margin each side
            vx, vy = b[0] - (size - w) / 2, b[1] - (size - h) / 2
            vb = f"{vx:.3f} {vy:.3f} {size:.3f} {size:.3f}"
            (OUT / f"{name}.svg").write_text(
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="16" height="16">'
                f'<path fill="#000" d="{d}"/></svg>\n', encoding="utf-8")
            entry.update(file=f"{name}.svg", viewBox=vb, d=d)
        else:
            href = el.get(XLINK_HREF) or el.get("href")
            png = base64.b64decode(href.split(",", 1)[1])
            w, h, rows = png_decode(png)
            if is_coloured(rows):
                rows = to_neutral_ink(rows)
                png = png_encode(w, h, rows)
                entry["processed"] = "coloured fill converted to black ink on transparent"
            (OUT / f"{name}.png").write_bytes(png)
            entry.update(file=f"{name}.png", width=w, height=h, dataUri="data:image/png;base64," + base64.b64encode(png).decode())
        manifest["sprites"][name] = entry

    (OUT / "sprites.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")

    cells = "\n".join(
        f'<figure><div class="ic"><img src="{html.escape(e["file"])}" alt=""></div>'
        f'<div class="ic dark"><img src="{html.escape(e["file"])}" alt=""></div>'
        f'<figcaption>{html.escape(n)}<small>{e["kind"]}{" · processed" if e.get("processed") else ""}</small></figcaption></figure>'
        for n, e in sorted(manifest["sprites"].items()))
    (OUT / "index.html").write_text(f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArchiMate Sprites</title>
<style>
:root {{ font: 13px/1.4 "Segoe UI", system-ui, sans-serif; color: #1d2330; }}
body {{ margin: 16px; background: #f6f7f9; }}
main {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }}
figure {{ margin: 0; background: #fff; border: 1px solid #d9dde3; border-radius: 6px; padding: 8px; display: grid; grid-template-columns: auto auto 1fr; gap: 6px; align-items: center; }}
.ic {{ width: 28px; height: 28px; display: grid; place-items: center; background: #fff; border: 1px solid #eee; border-radius: 4px; }}
.ic.dark {{ background: #ffffb5; }}
.ic img {{ width: 20px; height: 20px; image-rendering: auto; }}
figcaption {{ font-size: 11px; word-break: break-all; }}
small {{ display: block; color: #69717f; }}
</style></head><body>
<h1 style="font-size:16px">ArchiMate sprites ({len(manifest["sprites"])})</h1>
<p>Extracted from <code>inputs/archi_sprites.svg</code> by <code>tools/extract_sprites.py</code>. Each sprite on white and on a layer colour.</p>
<main>
{cells}
</main></body></html>
""", encoding="utf-8")
    print(f"{len(manifest['sprites'])} sprites written to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
