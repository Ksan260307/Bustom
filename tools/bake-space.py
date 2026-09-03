# -*- coding: utf-8 -*-
"""
The two places with no weather: the Moon, and orbit.

Both were lit by the same painted gradient as everywhere else, with a
handful of drawn dots for stars and a flat coloured circle for a planet.
That reads as "dark arena" rather than as "space", and no amount of tuning
the gradient fixes it, because what is missing is not colour - it is that
there is nothing up there to look AT.

Three real pictures fix it, and all three are equirectangular already:

  milkyway  the whole sky, so the black has structure in it
  earth     the thing worth looking at from either of them
  moon      seen from orbit, and again as the ground you are standing on

Downloads live beside this script, in dl/. See tools/README.md.
"""
import os
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

DL = os.path.join(os.path.dirname(__file__), 'dl')
OUT = sys.argv[1]

# name -> (file, width, quality, exposure)
#
# The sky is wider than the bodies because it is the one always filling the
# screen; a planet is a few hundred pixels across however big its map is.
SETS = {
    'milkyway': ('eso0932a.jpg', 2048, 86, 1.0),
    'earth': ('world.topo.bathy.200412.3x5400x2700.jpg', 1536, 88, 1.0),
    'moon': ('lroc_color_poles_2k.tif', 1024, 88, 1.0),
}


def resize(im, width):
    return im.convert('RGB').resize((width, width // 2), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
total = 0
for name, (src, width, quality, exposure) in SETS.items():
    path = os.path.join(DL, src)
    if not os.path.exists(path):
        print('  %s: no download, skipped' % name)
        continue

    im = resize(Image.open(path), width)
    if exposure != 1.0:
        a = np.asarray(im, dtype=np.float32) * exposure
        im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGB')

    dst = os.path.join(OUT, name + '.jpg')
    im.save(dst, quality=quality, optimize=True, progressive=True)
    size = os.path.getsize(dst)
    total += size

    a = np.asarray(im, dtype=np.float32) / 255
    print('  %-9s %-42s %dx%d  %d KB  mean %.3f'
          % (name, src, im.size[0], im.size[1], size // 1024, a.mean()))

print('total %d KB' % (total // 1024))
