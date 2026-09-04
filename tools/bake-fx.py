# -*- coding: utf-8 -*-
"""
Cut the effect sprites down to what the game draws them at.

Every one of these is a MASK, not a picture: the game multiplies it by the
colour of whatever made the effect - the player's own accent for a muzzle
flash, the arena's dust colour for a puff - so the file carries shape and
nothing else. That is the same contract the procedural rounds already used,
which is why these drop straight in.

Downloads live beside this script, in dl/. See tools/README.md.
"""
import io
import os
import sys
import zipfile

import numpy as np
from PIL import Image

DL = os.path.join(os.path.dirname(__file__), 'dl')
OUT = sys.argv[1]
SIZE = 128

# name in the game -> file in Kenney's pack
PARTICLES = {
    # A gun going off: a hard starburst with a plume coming off the front.
    'muzzle': 'muzzle_01',
    # What a hit throws back out. Not lightning, which is what the sprite
    # called "spark" in this pack actually is.
    'spark': 'scorch_01',
    # The vernier plume: bright at the plate, tapering away from it.
    'flame': 'muzzle_05',
    # Kicked-up floor, and the grit that comes with it.
    'smoke': 'smoke_08',
    'dirt': 'dirt_02',
    # The core of a round in flight, and the streak behind it.
    'flare': 'flare_01',
    'trace': 'trace_02',
    # A soft blot, for the shadow under a machine and the air round a planet.
    'blob': 'circle_05',
    # What a hit leaves behind on the wall.
    'scorch': 'scorch_03',

    # Ninety-six sprites came in this pack and nine were being used. These
    # three were picked the way the others were — by MEASURING the shape
    # rather than reading the filename, which is how `spark` turned out to
    # be lightning:
    #
    #   slash_03   5.2x longer than it is wide — an arc, not a blob
    #   circle_03  375x more ink at its edge than at its middle — a ring
    #   smoke_09   dense and soft, and not the one the floor already uses
    #
    # A blade had NO visual of its own until now: swinging it drew the same
    # spray as a bullet landing.
    'slash': 'slash_03',
    'ring': 'circle_03',
    'plume': 'smoke_09',
}


def bake(img):
    """Greyscale in the colour channels, shape in the alpha.

    Kenney's sprites are white with an alpha shape. Additive blending
    multiplies by alpha and adds, so white-times-alpha is exactly right; and
    for the few things drawn with ordinary transparency the alpha is doing
    the same job. One file serves both.
    """
    im = img.convert('RGBA').resize((SIZE, SIZE), Image.LANCZOS)
    a = np.asarray(im, dtype=np.float32)
    # Flatten any colour the sprite happened to carry. The game supplies the
    # colour; a sprite that brings its own would tint every player's rounds
    # the same and there would be no way to tell two machines apart.
    lum = a[..., :3].mean(axis=2)
    a[..., 0] = a[..., 1] = a[..., 2] = lum
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


os.makedirs(OUT, exist_ok=True)
zf = zipfile.ZipFile(os.path.join(DL, 'kenney_particlePack.zip'))
total = 0
for name, member in PARTICLES.items():
    src = Image.open(io.BytesIO(zf.read('PNG/%s.png' % member)))
    path = os.path.join(OUT, name + '.png')
    bake(src).save(path, optimize=True)
    size = os.path.getsize(path)
    total += size
    print('  %-8s <- %-12s %d KB' % (name, member, size // 1024))

print('total %d KB' % (total // 1024))
