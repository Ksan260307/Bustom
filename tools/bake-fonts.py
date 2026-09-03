# -*- coding: utf-8 -*-
"""
Self-host the latin subset of the two faces the interface asks for.

The stylesheet has named "Inter" since the beginning and never shipped it,
so on a machine without it the whole game quietly fell back to Segoe UI. A
game that is packaged and sold cannot look different on someone else's
computer because of what they happen to have installed.

Latin only, on purpose. Japanese stays on the system face: a subsetted Noto
Sans JP is several megabytes, and every desktop this ships to already has a
perfectly good Japanese font.
"""
import os
import re
import sys
import urllib.request

OUT = sys.argv[1]
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

FACES = [
    ('Inter', 'Inter:wght@400..700', 'inter'),
    ('JetBrains Mono', 'JetBrains+Mono:wght@400;600', 'jetbrains-mono'),
]


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

with open(os.path.join(OUT, 'fonts.css'), 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('/*\n'
             ' * The two faces the interface asks for, carried with the game.\n'
             ' *\n'
             ' * Latin only: Japanese stays on whatever the system provides,\n'
             ' * because a subsetted Japanese face is several megabytes and every\n'
             ' * desktop this runs on already has one.\n'
             ' *\n'
             ' * Both are SIL Open Font License 1.1 - see LICENSES.md.\n'
             ' */\n\n')
    fh.write('\n'.join(blocks))

print('total %d KB' % (total // 1024))
