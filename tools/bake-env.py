# -*- coding: utf-8 -*-
"""
Shrink a Radiance .hdr down to what an environment map actually needs.

The sky is only ever seen here as a reflection in metal, run through a
prefilter that blurs it into roughness mips. A 1k source is four times more
picture than survives that, and four times the download.
"""
import os
import sys

import numpy as np

# Downloads live beside this script, in dl/. See tools/README.md.
DL = os.path.join(os.path.dirname(__file__), 'dl')
OUT = sys.argv[1]
W, H = 512, 256
# Every sky is levelled to the same average brightness. They were shot at
# different times of night and one of them is fifty times brighter than
# another, so without this each arena would need its own exposure number
# chosen by eye - and swapping one sky for another would break it again.
MEAN = 0.10


def read_hdr(path):
    """Radiance RGBE, both flat and run-length scanlines."""
    with open(path, 'rb') as fh:
        data = fh.read()

    # ---- header, terminated by a blank line, then the resolution line
    i = 0
    while True:
        j = data.index(b'\n', i)
        line = data[i:j]
        i = j + 1
        if line.strip() == b'':
            break
    j = data.index(b'\n', i)
    res = data[i:j].split()
    i = j + 1
    assert res[0] == b'-Y' and res[2] == b'+X', res
    h, w = int(res[1]), int(res[3])

    out = np.zeros((h, w, 4), dtype=np.uint8)
    p = i
    for y in range(h):
        if (w >= 8 and w < 0x8000 and data[p] == 2 and data[p + 1] == 2
                and (data[p + 2] << 8 | data[p + 3]) == w):
            p += 4
            for c in range(4):
                x = 0
                while x < w:
                    n = data[p]
                    p += 1
                    if n > 128:                       # a run of one value
                        out[y, x:x + n - 128, c] = data[p]
                        p += 1
                        x += n - 128
                    else:                             # n literal bytes
                        out[y, x:x + n, c] = np.frombuffer(data[p:p + n], dtype=np.uint8)
                        p += n
                        x += n
        else:
            out[y] = np.frombuffer(data[p:p + w * 4], dtype=np.uint8).reshape(w, 4)
            p += w * 4

    e = out[..., 3].astype(np.int32)
    scale = np.where(e == 0, 0.0, np.ldexp(1.0, e - 136))
    return out[..., :3].astype(np.float32) * scale[..., None]


def write_hdr(path, rgb):
    """Flat scanlines. Bigger than run-length on paper, smaller in practice
    once the picture is this small, and a great deal less code to get wrong."""
    h, w, _ = rgb.shape
    peak = rgb.max(axis=2)
    e = np.zeros_like(peak, dtype=np.int32)
    nz = peak > 1e-32
    m, ex = np.frexp(peak[nz])
    e[nz] = ex + 128
    scale = np.zeros_like(peak)
    scale[nz] = m * 256.0 / peak[nz]
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., :3] = np.clip(rgb * scale[..., None], 0, 255).astype(np.uint8)
    out[..., 3] = np.clip(e, 0, 255).astype(np.uint8)
    with open(path, 'wb') as fh:
        fh.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n')
        fh.write(('-Y %d +X %d\n' % (h, w)).encode())
        fh.write(out.tobytes())


def box_down(a, w, h):
    """Average down by whole blocks. Averaging in LINEAR light is the whole
    point: an environment resized in gamma space loses its highlights, and
    the highlights are what a reflection is made of."""
    sh, sw = a.shape[0] // h, a.shape[1] // w
    return a[:h * sh, :w * sw].reshape(h, sh, w, sw, 3).mean(axis=(1, 3))


os.makedirs(OUT, exist_ok=True)
total = 0
for name in sys.argv[2:]:
    src = os.path.join(DL, name + '_1k.hdr')
    rgb = read_hdr(src)
    small = box_down(rgb, W, H)
    small *= MEAN / max(small.mean(), 1e-6)
    dst = os.path.join(OUT, name + '.hdr')
    write_hdr(dst, small.astype(np.float32))
    size = os.path.getsize(dst)
    total += size
    print('  %-24s %dx%d -> %dx%d  %d KB (was %d KB)  mean %.4f -> %.4f'
          % (name, rgb.shape[1], rgb.shape[0], W, H, size // 1024,
             os.path.getsize(src) // 1024, rgb.mean(), small.mean()))
print('total %d KB' % (total // 1024))
