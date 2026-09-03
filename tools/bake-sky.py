# -*- coding: utf-8 -*-
"""
The sky the five weather arenas are seen against.

Each of them was a four-stop vertical gradient — which was chosen to agree
with the fog, and does, and has nothing in it. Standing on a salt flat under
one, the whole upper half of the screen is a wash of one colour with a
visible band across it where two stops meet. No amount of tuning the stops
fixes that: a gradient cannot have clouds in it.

"Pure sky" panoramas: no ground in them, so the arena's own floor and its
ridge silhouettes keep the bottom of the picture and nothing fights.

Levelled to a common average, because they were shot at very different
times and the game tints each one to its arena's palette afterwards — that
tint is a multiply, so the thing being multiplied has to be a known
quantity or every arena needs its own exposure guessed by eye.

Downloads live beside this script, in dl/. See tools/README.md.
"""
import os
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

DL = os.path.join(os.path.dirname(__file__), 'dl')
OUT = sys.argv[1]
W, H = 2048, 1024

# What every sky averages out to once baked, in sRGB. The game divides its
# arena's own average by this to get the tint, so the two have to agree.
MEAN = 0.32

SKIES = [
    'kloppenheim_02_puresky',      # clear night
    'kloppenheim_07_puresky',      # overcast night, lit from below
    'qwantani_dusk_1_puresky',     # dusk, broken cloud
    'qwantani_moon_noon_puresky',  # moonlit, wide and open
]


os.makedirs(OUT, exist_ok=True)
total = 0
for name in SKIES:
    path = os.path.join(DL, name + '.jpg')
    if not os.path.exists(path):
        print('  %s: no download, skipped' % name)
        continue

    im = Image.open(path).convert('RGB')
    src = im.size
    im = im.resize((W, H), Image.LANCZOS)

    a = np.asarray(im, dtype=np.float32) / 255
    before = a.mean()
    # Scaled, not levelled per channel: the colour of the sky is what makes
    # one of these a dusk and another a clear night, and flattening that
    # would leave four copies of the same grey.
    a = np.clip(a * (MEAN / max(before, 1e-4)), 0, 1)

    dst = os.path.join(OUT, name + '.jpg')
    Image.fromarray((a * 255).astype(np.uint8), 'RGB').save(
        dst, quality=84, optimize=True, progressive=True)
    size = os.path.getsize(dst)
    total += size
    print('  %-30s %dx%d -> %dx%d  %d KB  mean %.3f -> %.3f'
          % (name, src[0], src[1], W, H, size // 1024, before, a.mean()))

print('total %d KB' % (total // 1024))
