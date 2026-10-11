# @last-edited: 2026-10-06 08:41 UTC+7.
# @title: draw-icon — writes the four PNG icon sizes with a hand-rolled encoder.
# @state: 16/32/48/128 written from one 128px master; verified by decoding the output back.
# @dependencies: none; zlib is stdlib and Pillow is not installed.

"""Draw the extension icons without an image library.

Pillow is not installed and this repository has no dependencies, so both the
PNG encoder and the rasteriser are here. Shapes are decided per pixel by a
coverage test, which is slow and exact, and the small sizes are box-filtered
down from the 128px master so a 16px icon is a real reduction rather than a
separate drawing that could drift.

Run: py scripts/draw-icon.py
"""

import math
import os
import struct
import zlib

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZES = (16, 32, 48, 128)

BG = (0x0B, 0x0D, 0x10)
SURFACE = (0x14, 0x18, 0x1D)
LINE = (0x26, 0x2C, 0x34)
ACCENT = (0x14, 0xB8, 0xA6)

def rounded_square(x, y, size, inset, radius):
    """Coverage of a rounded square inset from the edge, as 0.0 or 1.0."""
    low, high = inset, size - 1 - inset
    if x < low or x > high or y < low or y > high:
        return 0.0
    cx = min(max(x, low + radius), high - radius)
    cy = min(max(y, low + radius), high - radius)
    return 1.0 if math.hypot(x - cx, y - cy) <= radius + 0.5 else 0.0

def disc(x, y, cx, cy, radius):
    return 1.0 if math.hypot(x - cx, y - cy) <= radius + 0.5 else 0.0

def triangle(x, y, points):
    def edge(a, b):
        ax, ay = a
        bx, by = b
        return (bx - ax) * (y - ay) - (by - ay) * (x - ax)

    signs = [edge(points[0], points[1]), edge(points[1], points[2]), edge(points[2], points[0])]
    straddles = any(v < 0 for v in signs) and any(v > 0 for v in signs)
    return 0.0 if straddles else 1.0

def blend(base, colour, alpha):
    return tuple(round(b + (c - b) * alpha) for b, c in zip(base, colour))

def render(size):
    """One RGBA scanline per row, as bytes."""
    centre = (size - 1) / 2.0
    inset = size * 0.031
    radius = size * 0.172
    dot = size * 0.039
    halo = size * 0.102
    caret = [
        (size * 0.359, size * 0.484),
        (size * 0.469, size * 0.594),
        (size * 0.469, size * 0.484),
    ]

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            pixel = BG

            card = rounded_square(x, y, size, inset, radius)
            if card:
                pixel = blend(pixel, SURFACE, card)
                edge = rounded_square(x, y, size, inset + 2, radius + 2) - card
                if 0 < edge < 1:
                    pixel = blend(pixel, LINE, edge * 0.9)

            hit = triangle(x, y, caret)
            if hit:
                pixel = blend(pixel, ACCENT, 0.92)

            ring = disc(x, y, centre, centre, halo) - disc(
                x, y, centre, centre, halo - size * 0.026
            )
            if ring > 0:
                pixel = blend(pixel, ACCENT, 0.30 * ring)

            core = disc(x, y, centre, centre, dot)
            if core:
                pixel = blend(pixel, ACCENT, core)

            row += bytes(pixel) + b"\xff"
        rows.append(bytes(row))
    return rows

def box_filter(rows, size):
    """Average the master down, so a small icon is a reduction of the real thing."""
    if size == 128:
        return rows
    factor = 128 // size
    out = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            totals = [0, 0, 0, 0]
            for dy in range(factor):
                for dx in range(factor):
                    source = (x * factor + dx) * 4
                    pixel = rows[y * factor + dy][source:source + 4]
                    for channel in range(4):
                        totals[channel] += pixel[channel]
            count = factor * factor
            row += bytes(v // count for v in totals)
        out.append(bytes(row))
    return out

def write_png(path, rows):
    size = len(rows)

    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, payload):
        body = tag + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(png)

def main():
    master = render(128)
    for size in SIZES:

        targets = [os.path.join(REPO, "extension", "icons", f"icon{size}.png")]
        if size == 128:
            targets.append(os.path.join(REPO, "store", "icon128.png"))
        for path in targets:
            write_png(path, box_filter(master, size))
            print(
                f"  {os.path.relpath(path, REPO)}"
                f"  {size}px  {os.path.getsize(path)} bytes"
            )

if __name__ == "__main__":
    main()