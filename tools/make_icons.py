#!/usr/bin/env python3
"""Genera los iconos PNG de la PWA sin dependencias (zlib + struct).

Dibuja "</>" con segmentos antialiasados sobre un cuadrado redondeado.
Uso: python3 tools/make_icons.py frontend/public/icons
"""
import math, struct, sys, zlib
from pathlib import Path

BG = (14, 21, 37)
ORANGE = ((242, 98, 7), (255, 179, 71))
BLUE = ((0, 121, 242), (86, 182, 255))


def png(path, size, pixels):
    raw = b''.join(b'\0' + bytes(pixels[y * size * 4:(y + 1) * size * 4]) for y in range(size))
    chunk = lambda tag, data: struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    Path(path).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
                           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def rounded_rect_dist(px, py, half, radius):
    qx, qy = abs(px) - half + radius, abs(py) - half + radius
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - radius


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def render(size, maskable=False):
    pixels = bytearray(size * size * 4)
    s = size / 100.0
    # Glifo en coordenadas 0..100; en el icono "maskable" se reduce para la zona segura.
    scale = 0.72 if maskable else 1.0
    def glyph(x, y):
        return (50 + (x - 50) * scale) * s, (50 + (y - 50) * scale) * s
    left = [(glyph(36, 30), glyph(20, 50)), (glyph(20, 50), glyph(36, 70))]
    right = [(glyph(64, 30), glyph(80, 50)), (glyph(80, 50), glyph(64, 70))]
    slash = [(glyph(56, 24), glyph(44, 76))]
    width = 7.5 * s * scale
    for y in range(size):
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            if maskable:
                inside = 1.0
            else:
                d = rounded_rect_dist(px - size / 2, py - size / 2, size / 2, size * 0.22)
                inside = max(0.0, min(1.0, 0.5 - d))
            if inside <= 0:
                continue
            color = BG
            t = py / size
            for segments, (c1, c2) in ((left + right, ORANGE), (slash, BLUE)):
                d = min(seg_dist(px, py, *a, *b) for a, b in segments) - width / 2
                cover = max(0.0, min(1.0, 0.5 - d))
                if cover > 0:
                    color = mix(color, mix(c1, c2, t), cover)
            i = (y * size + x) * 4
            pixels[i:i + 4] = bytes((*color, int(255 * inside)))
    return pixels


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else 'frontend/public/icons')
    out.mkdir(parents=True, exist_ok=True)
    for name, size, maskable in (('icon-192.png', 192, False), ('icon-512.png', 512, False), ('maskable-512.png', 512, True),
                                 ('apple-touch-icon.png', 180, True), ('favicon-32.png', 32, False)):
        png(out / name, size, render(size, maskable))
        print('ok', name)


if __name__ == '__main__':
    main()
