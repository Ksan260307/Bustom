# -*- coding: utf-8 -*-
"""
Get the raw recordings out of their archives, and nothing else.

The firearm library is 194MB of 7z holding 56 files, of which this game
wants six. Unpacking all of it to reach them would cost a gigabyte of disk
for no reason, so only the named members come out.

Needs `py7zr` (pip install py7zr) for the two 7z archives. Run by
fetch-assets.py; there is no reason to run it on its own.
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DL = os.path.join(HERE, 'dl')
RAW = os.path.join(DL, '_raw')

GUNS = [
    'Prepared SFX Library/PPSh/P_22P.wav',
    'Prepared SFX Library/Ruger Mark III/R_30P.wav',
    'Prepared SFX Library/Mosin Nagant/M_21P.wav',
    'Prepared SFX Library/Mossberg/N_26P.wav',
    'Prepared SFX Library/Tikka/W_24P.wav',
]


def main():
    os.makedirs(RAW, exist_ok=True)
    guns = os.path.join(DL, 'Prepared_SFX_Library.7z')
    if os.path.exists(guns):
        import py7zr
        with py7zr.SevenZipFile(guns) as a:
            a.extract(path=RAW, targets=GUNS)
        print('  guns    %d files' % len(GUNS))
    else:
        print('  skip guns (no Prepared_SFX_Library.7z)')

    hiss = os.path.join(DL, 'steam_hisses.zip')
    if os.path.exists(hiss):
        with zipfile.ZipFile(hiss) as z:
            n = 0
            for m in z.namelist():
                if not m.lower().endswith('.wav'):
                    continue
                out = os.path.join(RAW, os.path.basename(m).replace(' ', '_'))
                with open(out, 'wb') as fh:
                    fh.write(z.read(m))
                n += 1
        print('  steam   %d files' % n)
    else:
        print('  skip steam (no steam_hisses.zip)')


if __name__ == '__main__':
    main()
