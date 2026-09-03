# -*- coding: utf-8 -*-
"""
Turn an ambientCG 1K PBR set into the three small maps the game needs.

The arena's ground colour is a deliberate choice - each of the seven places
has its own - so a photographic colour map cannot simply replace it. The
colour map is flattened to a DETAIL map instead: greyscale, normalised to a
known mean, so the material can multiply it by whatever colour the arena
says and come out at the brightness it had when it was a flat fill.
"""
import io
import os
import sys
import zipfile

import numpy as np
from PIL import Image

# Downloads live beside this script, in dl/. See tools/README.md.
DL = os.path.join(os.path.dirname(__file__), 'dl')
OUT = sys.argv[1]
SIZE = 512
# What the detail map averages out to. The material scales its tint by the
# reciprocal, so swapping a flat fill for a photograph does not darken a
# whole arena by a third.
MEAN = 0.75
# How much variation a surface carries, once levelled.
TARGET_SD = 0.09

SETS = {
    'concrete': 'Concrete034',
    'asphalt': 'Asphalt031',
    'stone': 'Rock051',
    'deckplate': 'DiamondPlate009',
    'saltpan': 'Ground093B',
    'regolith': 'Ground093C',
    'rust': 'Metal041B',
    'strata': 'Rock064',
}


def member(z, asset, suffix):
    want = asset + '_1K-JPG_' + suffix + '.jpg'
    if want in z.namelist():
        return Image.open(io.BytesIO(z.read(want)))
    return None


def detail(img):
    """Greyscale, evenly lit, normalised to a known mean."""
    a = np.asarray(img.convert('L').resize((SIZE, SIZE), Image.LANCZOS), dtype=np.float32) / 255
    # Flatten the overall level without flattening the texture: divide by a
    # heavily blurred copy of itself, so a photograph lit from one side does
    # not paint a gradient across every floor in the game.
    small = Image.fromarray((a * 255).astype(np.uint8)).resize((8, 8), Image.LANCZOS)
    blur = np.asarray(small.resize((SIZE, SIZE), Image.BICUBIC), dtype=np.float32) / 255
    a = a / np.maximum(blur, 1e-3)
    a *= MEAN / max(a.mean(), 1e-3)

    # Levelled for CONTRAST as well as for brightness.
    #
    # Measured across the eight: rock came out at sd 0.138 and a salt pan at
    # 0.0094, fifteen times flatter. That is not the bake, it is the
    # photographs — a dry lake bed genuinely has less going on in it than a
    # cliff face. But the game tiles both across a two-hundred-metre arena,
    # and at that size 0.0094 is a plain grey plane with nothing in it to
    # say how big anything is, which is the whole reason for having a
    # surface at all.
    #
    # Both directions: the loud ones come down as well, or a rock floor
    # reads as gravel next to a salt flat that reads as fog.
    sd = max(a.std(), 1e-4)
    a = MEAN + (a - a.mean()) * min(max(TARGET_SD / sd, 0.6), 6.0)
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))


def plain(img, mode='L'):
    return img.convert(mode).resize((SIZE, SIZE), Image.LANCZOS)


# What a roughness map averages out to after the remap below.
ROUGH_MEAN = 0.92
# How much of its own variation it keeps.
ROUGH_SPREAD = 0.35


def roughness(img):
    """Variation around the feel the game already had, not a replacement for it.

    A photographed roughness map averages about 0.55, and the material
    multiplies its own roughness by it - so bolting one straight on took
    stone from 0.94 to 0.53 and turned a dry canyon floor into wet slate.
    These numbers were tuned against a painted map that was never a
    roughness map at all; the photograph's job is to say WHERE the surface
    is shinier, not how shiny the surface is.
    """
    a = np.asarray(img.convert('L').resize((SIZE, SIZE), Image.LANCZOS), dtype=np.float32) / 255
    a = ROUGH_MEAN + (a - a.mean()) * ROUGH_SPREAD
    return Image.fromarray((np.clip(a, 0.55, 1.0) * 255).astype(np.uint8))


os.makedirs(OUT, exist_ok=True)
total = 0
for kind, asset in SETS.items():
    path = os.path.join(DL, asset + '_1K-JPG.zip')
    if not os.path.exists(path):
        print('  ' + kind + ': no download, skipped')
        continue
    z = zipfile.ZipFile(path)

    wrote = []
    colour = member(z, asset, 'Color')
    if colour:
        p = os.path.join(OUT, kind + '_detail.jpg')
        detail(colour).save(p, quality=82, optimize=True)
        wrote.append(p)
    rough = member(z, asset, 'Roughness')
    if rough:
        p = os.path.join(OUT, kind + '_rough.jpg')
        roughness(rough).save(p, quality=80, optimize=True)
        wrote.append(p)
    normal = member(z, asset, 'NormalGL')
    if normal:
        p = os.path.join(OUT, kind + '_normal.jpg')
        plain(normal, 'RGB').save(p, quality=88, optimize=True)
        wrote.append(p)

    size = sum(os.path.getsize(p) for p in wrote)
    total += size
    print('  %-10s %-16s %d maps, %d KB' % (kind, asset, len(wrote), size // 1024))

print('total %d KB' % (total // 1024))
