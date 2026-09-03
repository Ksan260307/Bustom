# -*- coding: utf-8 -*-
"""
Fetch every outside asset and bake it, in one command.

The baked files live in `public/kit/` and are NOT in the repository: they
are not ours, and every one of them is reproducible from a URL plus one of
the scripts beside this one. What is in the repository is the recipe.

    python tools/fetch-assets.py

Downloads land in `tools/dl/` and stay there, so running this again is
nearly instant. Nothing is overwritten if it is already the right size.

The game runs without any of it — see tools/README.md — so this is a step
you take when you want the game to LOOK finished, not one you take to make
it start.
"""
import os
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DL = os.path.join(HERE, 'dl')
KIT = os.path.join(ROOT, 'public', 'kit')

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

# ---- ambientCG: the surfaces. CC0.
SURFACES = [
    'Concrete034', 'Asphalt031', 'Rock051', 'DiamondPlate009',
    'Ground093B', 'Ground093C', 'Metal041B', 'Rock064',
]

# ---- Poly Haven: what the metal reflects, and what the sky looks like. CC0.
HDRIS = ['dikhololo_night', 'modern_buildings_night', 'moonless_golf']
SKIES = [
    'kloppenheim_02_puresky', 'kloppenheim_07_puresky',
    'qwantani_dusk_1_puresky', 'qwantani_moon_noon_puresky',
]

# ---- everything else, by direct link
DIRECT = {
    # Kenney's particle pack, via his own upload. CC0.
    'kenney_particlePack.zip':
        'https://opengameart.org/sites/default/files/kenney_particlePack.zip',
    # rubberduck's sound packs. CC0.
    'sci-fi-sfx.zip': 'https://opengameart.org/sites/default/files/sci-fi-sfx.zip',
    '100-CC0-SFX_0.zip': 'https://opengameart.org/sites/default/files/100-CC0-SFX_0.zip',
    '25-CC0-bang-sfx.zip':
        'https://opengameart.org/sites/default/files/25-CC0-bang-sfx.zip',
    # ESO's Milky Way panorama. CC BY 4.0 — the game credits it on the help
    # screen, and that credit is not optional.
    'eso0932a.jpg': 'https://cdn.eso.org/images/large/eso0932a.jpg',
    # NASA. Public domain.
    'world.topo.bathy.200412.3x5400x2700.jpg':
        'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/'
        'world.topo.bathy.200412.3x5400x2700.jpg',
    'lroc_color_poles_2k.tif':
        'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_2k.tif',
}

# ---- the seven sounds, and which pack each is cut from
SFX = [
    ('sci-fi-sfx.zip', 'shoot_01.ogg', 'fire-light.ogg'),
    ('25-CC0-bang-sfx.zip', 'bang_03.ogg', 'fire-heavy.ogg'),
    ('100-CC0-SFX_0.zip', 'metal_02.ogg', 'hit-landed.ogg'),
    ('100-CC0-SFX_0.zip', 'metal_11.ogg', 'hit-taken.ogg'),
    ('sci-fi-sfx.zip', 'explosion_02.ogg', 'boom.ogg'),
    ('sci-fi-sfx.zip', 'beep_01.ogg', 'lock-on.ogg'),
    ('sci-fi-sfx.zip', 'beep_03.ogg', 'lock-off.ogg'),
]

# ---- the two faces, and their licences
FONT_LICENCES = {
    'Inter-OFL.txt': 'https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt',
    'JetBrainsMono-OFL.txt':
        'https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/OFL.txt',
}


def fetch(url, path, label):
    """Download unless it is already here. Never re-downloads by accident."""
    if os.path.exists(path) and os.path.getsize(path) > 1024:
        print('  have  %s' % label)
        return True
    print('  get   %s' % label)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=300) as fh, open(path, 'wb') as out:
            out.write(fh.read())
    except Exception as e:                                    # noqa: BLE001
        print('        FAILED: %s' % e)
        return False
    return True


def polyhaven(slug, kind):
    """Ask Poly Haven where a file is, then take it."""
    import json
    req = urllib.request.Request('https://api.polyhaven.com/files/' + slug,
                                 headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as fh:
        d = json.load(fh)
    return d['hdri']['1k']['hdr']['url'] if kind == 'hdr' else d['tonemapped']['url']


def bake(script, out, *args):
    print('bake  %s -> %s' % (script, out))
    cmd = [sys.executable, os.path.join(HERE, script), out, *args]
    subprocess.run(cmd, check=True, cwd=ROOT)


def main():
    os.makedirs(DL, exist_ok=True)
    ok = True

    print('surfaces (ambientCG, CC0)')
    for a in SURFACES:
        ok &= fetch('https://ambientcg.com/get?file=%s_1K-JPG.zip' % a,
                    os.path.join(DL, '%s_1K-JPG.zip' % a), a)

    print('reflected skies (Poly Haven, CC0)')
    for a in HDRIS:
        path = os.path.join(DL, a + '_1k.hdr')
        if os.path.exists(path) and os.path.getsize(path) > 1024:
            print('  have  %s' % a)
            continue
        ok &= fetch(polyhaven(a, 'hdr'), path, a)

    print('drawn skies (Poly Haven, CC0)')
    for a in SKIES:
        path = os.path.join(DL, a + '.jpg')
        if os.path.exists(path) and os.path.getsize(path) > 1024:
            print('  have  %s' % a)
            continue
        ok &= fetch(polyhaven(a, 'jpg'), path, a)

    print('sprites, sounds and space')
    for name, url in DIRECT.items():
        ok &= fetch(url, os.path.join(DL, name), name)

    if not ok:
        print()
        print('Some downloads failed. Everything that did arrive is baked below;')
        print('the game falls back for whatever is missing.')

    print()
    bake('bake-surfaces.py', os.path.join(KIT, 'surface'))
    bake('bake-env.py', os.path.join(KIT, 'env'), *HDRIS)
    bake('bake-sky.py', os.path.join(KIT, 'sky'))
    bake('bake-space.py', os.path.join(KIT, 'space'))
    bake('bake-fx.py', os.path.join(KIT, 'fx'))
    bake('bake-fonts.py', os.path.join(KIT, 'font'))

    # ---- sounds: chosen, renamed, otherwise untouched
    import zipfile
    out = os.path.join(KIT, 'sfx')
    os.makedirs(out, exist_ok=True)
    print('bake  sounds -> %s' % out)
    for pack, member, name in SFX:
        path = os.path.join(DL, pack)
        if not os.path.exists(path):
            print('  skip  %s (no %s)' % (name, pack))
            continue
        with zipfile.ZipFile(path) as z, open(os.path.join(out, name), 'wb') as fh:
            fh.write(z.read(member))
        print('  %-16s <- %s' % (name, member))

    # ---- the Open Font License asks that its text travel with the fonts
    print('bake  font licences')
    for name, url in FONT_LICENCES.items():
        fetch(url, os.path.join(KIT, 'font', name), name)

    print()
    print('Done. See LICENSES.md for where all of it came from.')


if __name__ == '__main__':
    main()
