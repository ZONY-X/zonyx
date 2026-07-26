import os
import zlib
import struct

OUTPUT_DIR = 'public'
SIZES = [16, 32, 48, 180, 192, 512]

POLY = [
    (0.48, 0.05),
    (0.22, 0.35),
    (0.45, 0.35),
    (0.22, 0.95),
    (0.58, 0.54),
    (0.40, 0.54),
    (0.70, 0.05),
]

BG_COLOR = (8, 12, 16, 255)
BOLT_COLOR = (0, 255, 134, 255)
HIGHLIGHT_COLOR = (160, 255, 200, 255)


def inside_polygon(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi):
            inside = not inside
        j = i
    return inside


def write_png(path, width, height, pixels):
    def chunk(c_type, data):
        return struct.pack('>I', len(data)) + c_type + data + struct.pack('>I', zlib.crc32(c_type + data) & 0xffffffff)

    raw = b''.join(b'\x00' + pixels[y*width*4:(y+1)*width*4] for y in range(height))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def create_icon(size):
    width = height = size
    pixels = bytearray(width * height * 4)
    for y in range(height):
        for x in range(width):
            idx = (y * width + x) * 4
            pixels[idx:idx+4] = bytes(BG_COLOR)

    for y in range(height):
        for x in range(width):
            nx = (x + 0.5) / width
            ny = (y + 0.5) / height
            if inside_polygon(nx, ny, POLY):
                blend = 1.0
                if size >= 64:
                    min_dist = 1.0
                    for i in range(len(POLY)):
                        x1, y1 = POLY[i]
                        x2, y2 = POLY[(i + 1) % len(POLY)]
                        px = nx - x1
                        py = ny - y1
                        dx = x2 - x1
                        dy = y2 - y1
                        t = max(0.0, min(1.0, (px * dx + py * dy) / (dx*dx + dy*dy + 1e-9)))
                        projx = x1 + t * dx
                        projy = y1 + t * dy
                        dist = ((nx - projx)**2 + (ny - projy)**2)**0.5
                        min_dist = min(min_dist, dist)
                    if min_dist < 0.04:
                        blend = 0.5 + 0.5 * (min_dist / 0.04)
                r = int(BOLT_COLOR[0] * blend + HIGHLIGHT_COLOR[0] * (1 - blend))
                g = int(BOLT_COLOR[1] * blend + HIGHLIGHT_COLOR[1] * (1 - blend))
                b = int(BOLT_COLOR[2] * blend + HIGHLIGHT_COLOR[2] * (1 - blend))
                idx = (y * width + x) * 4
                pixels[idx:idx+4] = bytes((r, g, b, 255))
    return pixels


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUTPUT_DIR, f'favicon-{size}x{size}.png')
        write_png(path, size, size, create_icon(size))
    write_png(os.path.join(OUTPUT_DIR, 'favicon-v2.png'), 32, 32, create_icon(32))
    write_png(os.path.join(OUTPUT_DIR, 'favicon.png'), 32, 32, create_icon(32))
    write_png(os.path.join(OUTPUT_DIR, 'apple-touch-icon.png'), 180, 180, create_icon(180))
    manifest = {
        "name": "ZONYX",
        "short_name": "ZONYX",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#06100a",
        "theme_color": "#00ff99",
        "icons": [
            {"src": "/favicon-192x192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/favicon-512x512.png", "sizes": "512x512", "type": "image/png"}
        ]
    }
    with open(os.path.join(OUTPUT_DIR, 'site.webmanifest'), 'w') as f:
        import json
        json.dump(manifest, f, indent=2)

if __name__ == '__main__':
    main()
