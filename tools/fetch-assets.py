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
    # Real firearms, recorded outdoors. CC0. 194MB, and worth every byte:
    # the guns were synthesised before and it is exactly what you could
    # hear — a shot with no crack in front of it and no hillside behind it.
    'Prepared_SFX_Library.7z':
        'https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z',
    # Air under pressure, recorded. CC0. This is what a machine of this size
    # actually sounds like when it moves; an oscillator is not.
    'steam_hisses.zip':
        'https://opengameart.org/sites/default/files/steam_hisses.zip',
    # The soundtrack. All CC0. The game had a title screen, a workbench and
    # a match, and all three were silent apart from the machine itself.
    'ehlers-free-music-pack.zip':
        'https://opengameart.org/sites/default/files/'
        'Alexander%20Ehlers%20-%20Free%20Music%20Pack.zip',
    'ObservingTheStar.zip':
        'https://opengameart.org/sites/default/files/ObservingTheStar.zip',
    # And what a place sounds like when nothing is happening in it.
    'dark-ambience-loop.ogg':
        'https://opengameart.org/sites/default/files/'
        'Iwan%20Gabovitch%20-%20Dark%20Ambience%20Loop.ogg',
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
    ('100-CC0-SFX_0.zip', 'metal_02.ogg', 'hit-landed.ogg'),
    ('100-CC0-SFX_0.zip', 'metal_11.ogg', 'hit-taken.ogg'),
    ('25-CC0-bang-sfx.zip', 'bang_06.ogg', 'boom.ogg'),
    ('sci-fi-sfx.zip', 'beep_01.ogg', 'lock-on.ogg'),
    ('sci-fi-sfx.zip', 'beep_03.ogg', 'lock-off.ogg'),
    # What a place sounds like with nothing happening in it. Two recordings
    # and a gain per arena, not seven files: the difference between a canyon
    # and a salt flat is how much air is moving.
    ('sci-fi-sfx.zip', 'loop_ambient_01.ogg', 'air.ogg'),

    # ---- what makes it sound like a machine rather than a shooter.
    #
    # NOTE: the guns and everything pneumatic are NOT in this list any more.
    # They are cut out of field recordings by tools/cut-sfx.py, which runs
    # after this — a five-megabyte recording of a hillside is not a game
    # asset until somebody has found the gunshot in it.
    #
    # Chosen by DECODING all 175 sounds in these packs and measuring them —
    # length, how fast they get loud, how long they stay loud, how bright
    # they are, and whether the two ends match well enough to be held down.
    # Picking by filename is how a sprite called `spark` turned out to be
    # lightning; the numbers are in the comment beside each one.
    #
    # 0.35s, 11ms attack, dark: a short metal knock, one per footfall.
    ('100-CC0-SFX_0.zip', 'metal_03.ogg', 'step.ogg'),
    # 0.57s, 293ms of body, the loudest low slam in the pack.
    ('100-CC0-SFX_0.zip', 'slam_03.ogg', 'land.ogg'),
    # Loops cleanly (0.80), low and mechanical: joints, while they move.
    # Loops (0.70) and broadband, which is what a thruster actually is.
    # Loops almost perfectly (0.96) and bright: an energy blade held lit.
    # 130ms swell, low: a whoosh rather than a bang.
    # 0.81s, 29ms attack, low: a whoomph as the legs let go.
    # 291ms of bright mechanical body: a ratchet.
    ('100-CC0-SFX_0.zip', 'tools_02.ogg', 'reload.ogg'),
    # 12ms of body: a clean click, and nothing after it.
    ('100-CC0-SFX_0.zip', 'switch_01.ogg', 'swap.ogg'),
    # The loudest beep in either pack, and bright with it.
    ('sci-fi-sfx.zip', 'retro_beep_05.ogg', 'alarm.ogg'),
    # 888ms of tail: a real gong, for the top and bottom of a round.
    ('100-CC0-SFX_0.zip', 'gong_01.ogg', 'round.ogg'),
    # 3ms attack, dark, loud: a machine coming apart.
    ('25-CC0-bang-sfx.zip', 'bang_09.ogg', 'wreck.ogg'),
    # The quiet one, because it plays on every arrow key.
    ('sci-fi-sfx.zip', 'terminal_01.ogg', 'ui-move.ogg'),
    ('sci-fi-sfx.zip', 'terminal_04.ogg', 'ui-select.ogg'),
    ('sci-fi-sfx.zip', 'terminal_05.ogg', 'ui-back.ogg'),
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

    # ---- the soundtrack, chosen by measuring eleven tracks (see LICENSES)
    out_music = os.path.join(KIT, 'music')
    os.makedirs(out_music, exist_ok=True)
    print('bake  music -> %s' % out_music)
    pack = os.path.join(DL, 'ehlers-free-music-pack.zip')
    if os.path.exists(pack):
        pre = 'Alexander Ehlers - Free Music Pack/Alexander Ehlers - '
        with zipfile.ZipFile(pack) as z:
            # Three fight tracks, not one. A solo run walks seven arenas
            # and takes far longer than 2.5 minutes, so one battle track
            # meant hearing the same loop for the whole ladder — the one
            # place in the game where the music is heard longest was the
            # one place it repeated. Chosen the same way the first three
            # were, by measuring the pack rather than by the titles:
            #
            #   Doomed         bright 2824, rms 0.306   the brightest
            #   Warped         bright 1743, rms 0.200   next brightest
            #   Great mission  bright 1071, rms 0.285   loudest of the rest
            #
            # The two left over are the quiet ones (Waking the devil 903,
            # Spacetime 880) and neither belongs under a fight.
            for member, name in [('Flags.mp3', 'title.mp3'),
                                 ('Twists.mp3', 'garage.mp3'),
                                 ('Doomed.mp3', 'fight.mp3'),
                                 ('Warped.mp3', 'fight2.mp3'),
                                 ('Great mission.mp3', 'fight3.mp3')]:
                with open(os.path.join(out_music, name), 'wb') as fh:
                    fh.write(z.read(pre + member))
                print('  %-16s <- %s' % (name, member))
    star = os.path.join(DL, 'ObservingTheStar.zip')
    if os.path.exists(star):
        with zipfile.ZipFile(star) as z,                 open(os.path.join(out_music, 'space.ogg'), 'wb') as fh:
            fh.write(z.read('ObservingTheStar.ogg'))
        print('  %-16s <- ObservingTheStar.ogg' % 'space.ogg')
    amb = os.path.join(DL, 'dark-ambience-loop.ogg')
    if os.path.exists(amb):
        import shutil as _sh
        _sh.copy(amb, os.path.join(KIT, 'sfx', 'deep.ogg'))
        print('  %-16s <- Dark Ambience Loop' % 'deep.ogg')

    # ---- and the sounds that have to be cut out of a recording first
    print('bake  field recordings')
    import subprocess as _sp
    _sp.check_call([sys.executable, os.path.join(HERE, 'unpack-sfx.py')])
    _sp.check_call([sys.executable, os.path.join(HERE, 'cut-sfx.py')])

    # ---- the Open Font License asks that its text travel with the fonts
    print('bake  font licences')
    for name, url in FONT_LICENCES.items():
        fetch(url, os.path.join(KIT, 'font', name), name)

    print()
    print('Done. See LICENSES.md for where all of it came from.')


if __name__ == '__main__':
    main()
