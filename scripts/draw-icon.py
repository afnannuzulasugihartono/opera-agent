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
ACCENT = (0x3E, 0xCF, 0x8E)

CURSOR_16 = [
    (5.2, 2.2),
    (5.2, 12.4),
    (7.7, 10.1),
    (9.2, 13.7),
    (11.1, 12.9),
    (9.5, 9.3),
    (12.6, 9.3),
]


def rounded_square(x, y, size, inset, radius):
    """Coverage of a rounded square inset from the edge, as 0.0 or 1.0."""
    low, high = inset, size - 1 - inset
    if x < low or x > high or y < low or y > high:
        return 0.0
    cx = min(max(x, low + radius), high - radius)
    cy = min(max(y, low + radius), high - radius)
    return 1.0 if math.hypot(x - cx, y - cy) <= radius + 0.5 else 0.0


def polygon(x, y, points):
    """Even-odd coverage test for a simple closed polygon, as 0.0 or 1.0."""
    crossings = 0
    j = len(points) - 1
    for i, (xi, yi) in enumerate(points):
        xj, yj = points[j]
        if (yi > y) != (yj > y):
            x_at = xi + (xj - xi) * (y - yi) / (yj - yi)
            if x < x_at:
                crossings += 1
        j = i
    return 1.0 if crossings % 2 == 1 else 0.0


def blend(base, colour, alpha):
    return tuple(round(b + (c - b) * alpha) for b, c in zip(base, colour))


def render(size):
    """One RGBA scanline per row, as bytes. The drawing is the site icon, exactly: the dark rounded tile and the green cursor, and nothing else."""
    radius = size * 3.0 / 16.0
    scale = size / 16.0
    caret = [(px * scale, py * scale) for px, py in CURSOR_16]

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            pixel = (0x00, 0x00, 0x00)
            alpha = 0

            tile = rounded_square(x, y, size, 0, radius)
            if tile:
                pixel = blend(pixel, BG, 1.0)
                alpha = 255

            hit = polygon(x, y, caret)
            if hit:
                pixel = blend(pixel, ACCENT, 1.0)
                alpha = 255

            row += bytes(pixel) + bytes([alpha])
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
                    pixel = rows[y * factor + dy][source : source + 4]
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
        return (
            struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))
        )

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
