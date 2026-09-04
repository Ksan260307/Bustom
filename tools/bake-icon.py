# -*- coding: utf-8 -*-
"""
The application icon.

The game had none. `index.html` carried no favicon and `electron-builder`
carried no `icon`, which means the shipped executable, the taskbar button
and the Steam library entry would all have used the default Electron
diamond — the first thing anybody sees, and it would have said "an Electron
app" rather than "BLOSTOM".

Drawn rather than downloaded, because an icon is identity and this one is
ours. It is built out of the same three facts the game is built out of:

  - blocks, so it is drawn on a grid and nothing in it is off-grid
  - the game's own colours, read from `src/ui/style.css` rather than typed
    here, so the icon cannot drift away from the interface
  - a machine seen head-on, which is how the game presents one on the
    title screen

    python tools/bake-icon.py

Writes `build/icon.png` (1024, what electron-builder wants for every
platform) and `public/icon.png` (64, for the page's own favicon).
"""
import os
import re

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def palette():
    """The interface's own colours, so this cannot drift away from it."""
    css = open(os.path.join(ROOT, 'src', 'ui', 'style.css'), encoding='utf-8').read()
    head = css[:css.index('}')]

    def hexof(name, fallback):
        m = re.search(r'--%s:\s*(#[0-9a-fA-F]{6})' % name, head)
        return m.group(1) if m else fallback

    return {
        'bg': hexof('bg', '#070a10'),
        'accent': hexof('accent', '#4fd2ff'),
        'fg': hexof('fg', '#d7e6f4'),
        'dim': hexof('dim', '#7c93a8'),
    }


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


# The mark, on a 16x16 lattice. A head with a visor and two shoulders —
# the smallest arrangement of blocks that still reads as a machine facing
# you. Written out rather than computed so it can be SEEN here.
#
#   .  empty        #  body        =  visor        '  shoulder
MARK = [
    '................',
    '................',
    '....########....',
    '...##########...',
    '...#========#...',
    '...#========#...',
    '...##########...',
    '....########....',
    '......####......',
    ".''''.####.''''.",
    "'''''.####.'''''",
    "'''''.####.'''''",
    ".''''.####.''''.",
    '......####......',
    '................',
    '................',
]

INK = {'#': 'fg', '=': 'accent', "'": 'dim'}


def draw(size):
    """The mark at one size, on the game's own ground."""
    p = palette()
    # Transparent to start with, or the rounded corners are painted over by
    # the very fill they are meant to cut away.
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # A rounded ground, so it sits properly in a dock or a library grid.
    r = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=rgb(p['bg']) + (255,))

    cell = size / len(MARK)
    for y, row in enumerate(MARK):
        for x, ch in enumerate(row):
            if ch == '.':
                continue
            colour = rgb(p[INK[ch]])
            # A hairline gap between blocks: this is a machine made of
            # separate pieces, and at 1024 that reads; at 16 it closes up
            # on its own, which is what you want at 16.
            gap = max(0.0, cell * 0.06)
            x0, y0 = x * cell + gap, y * cell + gap
            x1, y1 = (x + 1) * cell - gap, (y + 1) * cell - gap
            d.rectangle([x0, y0, x1, y1], fill=colour + (255,))

    # The visor glows, because it does in the game. A real blur rather than
    # a flat wash: at 1024 a hard-edged rectangle of 24%% cyan looks like a
    # mistake, and at 16 the blur is what survives the downscale.
    if size >= 128:
        glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        g = ImageDraw.Draw(glow)
        g.rectangle([2.6 * cell, 3.4 * cell, 13.4 * cell, 6.6 * cell],
                    fill=rgb(p['accent']) + (150,))
        glow = glow.filter(ImageFilter.GaussianBlur(radius=size * 0.045))
        img = Image.alpha_composite(img, glow)
        # Redraw the mark over the glow so the blocks stay crisp.
        d2 = ImageDraw.Draw(img)
        for y, row in enumerate(MARK):
            for x, ch in enumerate(row):
                if ch == '.':
                    continue
                gap = max(0.0, cell * 0.06)
                d2.rectangle([x * cell + gap, y * cell + gap,
                              (x + 1) * cell - gap, (y + 1) * cell - gap],
                             fill=rgb(p[INK[ch]]) + (255,))
    return img


def main():
    out_build = os.path.join(ROOT, 'build')
    os.makedirs(out_build, exist_ok=True)

    big = draw(1024)
    big.save(os.path.join(out_build, 'icon.png'))
    print('build/icon.png        1024x1024')

    # Windows wants a real .ico with several sizes in it, or the taskbar
    # scales the 1024 down badly.
    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    big.save(os.path.join(out_build, 'icon.ico'), sizes=sizes)
    print('build/icon.ico        %s' % ', '.join('%dx%d' % s for s in sizes))

    fav = draw(64)
    fav.save(os.path.join(ROOT, 'public', 'icon.png'))
    print('public/icon.png       64x64')


if __name__ == '__main__':
    main()
