# -*- coding: utf-8 -*-
"""
Self-host every face the interface asks for — including the Japanese one.

The stylesheet has named "Inter" since the beginning and never shipped it,
so on a machine without it the whole game quietly fell back to Segoe UI. A
game that is packaged and sold cannot look different on someone else's
computer because of what they happen to have installed.

That argument was made for Latin and then not followed through. This
interface is almost entirely Japanese — every panel, every label, every
menu — so shipping two carefully chosen Latin faces and leaving the other
ninety-five percent of the text to whatever the machine happens to have was
choosing the typography of the part nobody reads.

The reason given was size, and it was wrong. A COMPLETE Japanese face is
several megabytes; a subset holding only the characters this game's own
strings use is not:

    Zen Kaku Gothic New   2.36 MB  ->   86 KB
    Noto Sans JP          9.59 MB  ->  167 KB
    M PLUS 2              4.20 MB  ->  197 KB

Eighty-six kilobytes is less than the two Latin faces already carried
between them. So the Japanese face is subset HERE, against the strings in
`src/` — which also means the set is never stale: add a label with a new
kanji in it and the next bake picks it up.
"""
import os
import re
import subprocess
import sys
import urllib.request

OUT = sys.argv[1]
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

FACES = [
    ('Inter', 'Inter:wght@400..700', 'inter'),
    ('JetBrains Mono', 'JetBrains+Mono:wght@400;600', 'jetbrains-mono'),
]

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# Zen Kaku Gothic New: geometric, even, and quiet enough to sit next to
# Inter without either of them looking like the guest. Static weights, which
# is why its subset is half the size of the variable faces — a subset of a
# variable font carries the whole weight axis whether it is wanted or not.
JP_FACE = 'Zen Kaku Gothic New'
JP_SLUG = 'zen-kaku-gothic-new'
JP_SOURCES = {
    '400': ('https://raw.githubusercontent.com/google/fonts/main/ofl/'
            'zenkakugothicnew/ZenKakuGothicNew-Regular.ttf'),
    '700': ('https://raw.githubusercontent.com/google/fonts/main/ofl/'
            'zenkakugothicnew/ZenKakuGothicNew-Bold.ttf'),
}


def japanese_in_use():
    """Every Japanese character the game's own strings contain.

    Read off `src/` rather than written down, so the subset cannot drift
    away from the interface. A label added with a kanji nobody has used
    before would otherwise render in the system face — one character in a
    different typeface, which is more obvious than the whole thing being
    in one.
    """
    keep = set()
    for root, _dirs, files in os.walk(os.path.join(ROOT, 'src')):
        for f in files:
            if not f.endswith(('.js', '.css', '.html')):
                continue
            with open(os.path.join(root, f), encoding='utf-8') as fh:
                for ch in fh.read():
                    o = ord(ch)
                    if (0x3040 <= o <= 0x30FF or 0x4E00 <= o <= 0x9FFF
                            or 0xFF00 <= o <= 0xFFEF
                            or o in (0x3001, 0x3002, 0x300C, 0x300D, 0x3005, 0x30FB)):
                        keep.add(ch)
    return keep


def get(url, binary=False):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as fh:
        data = fh.read()
    return data if binary else data.decode('utf-8')


os.makedirs(OUT, exist_ok=True)
blocks = []
total = 0

for name, spec, slug in FACES:
    css = get('https://fonts.googleapis.com/css2?family=%s&display=swap' % spec)
    # Each @font-face is one subset. Latin is the one with the basic block
    # in its range; everything else is Cyrillic, Greek or Vietnamese, and
    # this interface is Japanese and English.
    faces = re.findall(r'@font-face\s*\{(.*?)\}', css, re.S)
    for body in faces:
        rng = re.search(r'unicode-range:\s*([^;]+);', body)
        if not rng or 'U+0000-00FF' not in rng.group(1):
            continue
        url = re.search(r'url\((https://[^)]+\.woff2)\)', body).group(1)
        weight = re.search(r'font-weight:\s*([^;]+);', body).group(1).strip()
        data = get(url, binary=True)
        fname = '%s-%s.woff2' % (slug, weight.split()[0])
        with open(os.path.join(OUT, fname), 'wb') as fh:
            fh.write(data)
        total += len(data)
        blocks.append(
            '@font-face {\n'
            "  font-family: '%s';\n"
            '  font-style: normal;\n'
            '  font-weight: %s;\n'
            '  font-display: swap;\n'
            # CSS urls resolve against the STYLESHEET, not the page.
            "  src: url('./%s') format('woff2');\n"
            '  unicode-range: %s;\n'
            '}\n' % (name, weight, fname, rng.group(1).strip())
        )
        print('  %-16s %s  %d KB' % (name, weight, len(data) // 1024))

# ---- and the Japanese face, cut to the characters the game actually uses
want = japanese_in_use()
print('  %-16s %d characters in use' % (JP_FACE, len(want)))
text = ''.join(sorted(want))
for weight, url in JP_SOURCES.items():
    raw = os.path.join(OUT, '_%s-%s.ttf' % (JP_SLUG, weight))
    with open(raw, 'wb') as fh:
        fh.write(get(url, binary=True))
    fname = '%s-%s.woff2' % (JP_SLUG, weight)
    out = os.path.join(OUT, fname)
    subprocess.check_call([
        sys.executable, '-m', 'fontTools.subset', raw,
        '--text=' + text, '--flavor=woff2', '--output-file=' + out,
        # No layout features and no hints: this is screen text at one size,
        # and the tables are a third of what is left after subsetting.
        '--layout-features=', '--no-hinting', '--desubroutinize',
    ])
    os.remove(raw)
    total += os.path.getsize(out)
    blocks.append(
        '@font-face {\n'
        "  font-family: '%s';\n"
        '  font-style: normal;\n'
        '  font-weight: %s;\n'
        '  font-display: swap;\n'
        "  src: url('./%s') format('woff2');\n"
        '}\n' % (JP_FACE, weight, fname)
    )
    print('  %-16s %s  %d KB' % (JP_FACE, weight, os.path.getsize(out) // 1024))

with open(os.path.join(OUT, 'fonts.css'), 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('/*\n'
             ' * Every face the interface asks for, carried with the game.\n'
             ' *\n'
             ' * The Japanese one is cut to the characters the game\'s own strings\n'
             ' * use and nothing else - see tools/bake-fonts.py. A complete face is\n'
             ' * megabytes; this is smaller than either of the Latin ones, and it\n'
             ' * stops the interface being set in whatever the machine happens to\n'
             ' * have installed.\n'
             ' *\n'
             ' * No unicode-range on it on purpose: the Latin faces claim the Latin\n'
             ' * block, so this only ever answers for what they do not cover.\n'
             ' *\n'
             ' * All SIL Open Font License 1.1 - see LICENSES.md.\n'
             ' */\n\n')
    fh.write('\n'.join(blocks))

print('total %d KB' % (total // 1024))
