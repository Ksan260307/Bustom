# -*- coding: utf-8 -*-
"""
Cut the sound out of a recording, and leave the room it was recorded in.

A field recording is not a game asset. `Prepared SFX Library/Mosin
Nagant/M_21P.wav` is ten megabytes of a hillside with a rifle going off
somewhere in the middle of it — several seconds of wind, one transient, and
a long tail. What a game wants is the transient and as much of the tail as
carries, at a size that can sit in memory alongside twenty others.

So this finds the loudest transient, cuts a window around it, fades the ends
so the cut cannot click, normalises, mixes to mono and drops the rate. All
of it is measured off the file rather than typed in: the one number that is
a judgement is how much tail to keep, and it is per-sound because a pistol
and a shotgun do not decay alike.

    python tools/cut-sfx.py

Nothing here is creative. Every output is reproducible from the recipe in
`fetch-assets.py` plus this script, which is why neither the downloads nor
the results are in the repository.
"""
import os
import struct
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(HERE, 'dl', '_raw')
OUT = os.path.join(ROOT, 'public', 'kit', 'sfx')

# 32 kHz keeps everything a gunshot has above the noise floor of a game mix
# and costs a third of what 96 kHz does. Sixteen bits, because these are
# played once and discarded, not mastered.
RATE = 32000


def read_wav(path):
    """Any PCM wav, as float32 mono, at its own rate."""
    with wave.open(path, 'rb') as w:
        ch, width, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if width == 2:
        a = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
    elif width == 3:
        # 24-bit has no numpy dtype: rebuild it a byte at a time.
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        v = (b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16))
        v = np.where(v & 0x800000, v - (1 << 24), v)
        a = v.astype(np.float32) / 8388608.0
    elif width == 4:
        a = np.frombuffer(raw, dtype='<i4').astype(np.float32) / 2147483648.0
    elif width == 1:
        a = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128.0
    else:
        raise ValueError('unsupported width %d' % width)
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    return a, rate


def write_wav(path, a, rate=RATE):
    a = np.clip(a, -1.0, 1.0)
    pcm = (a * 32767.0).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return len(pcm)


def resample(a, src, dst):
    """Linear, which is plenty going DOWN from 96k to 32k on a gunshot."""
    if src == dst:
        return a
    n = int(round(len(a) * dst / src))
    x = np.linspace(0, len(a) - 1, n)
    return np.interp(x, np.arange(len(a)), a).astype(np.float32)


def find_transient(a, rate):
    """Where the loudest thing in the file starts.

    The peak sample is in the middle of the crack, not at the front of it,
    so this walks back to where the sound was still quiet. Miss that and
    every gunshot in the game starts halfway through its own attack.
    """
    peak = int(np.argmax(np.abs(a)))
    floor = np.percentile(np.abs(a[: max(1, rate // 2)]), 95) * 3 + 1e-4
    i = peak
    limit = max(0, peak - int(rate * 0.05))
    while i > limit and abs(a[i]) > floor:
        i -= 1
    return i


def cut(name, src, tail=0.9, lead=0.004, gain=0.95, rate=RATE):
    """One recording -> one game sound."""
    a, sr = read_wav(src)
    at = find_transient(a, sr)
    i0 = max(0, at - int(sr * lead))
    i1 = min(len(a), at + int(sr * tail))
    seg = a[i0:i1].copy()

    # Both ends faded, or the cut itself is a click — which on a gunshot is
    # indistinguishable from the gunshot and quietly ruins it.
    fi = int(sr * 0.0015)
    fo = int(sr * 0.05)
    if fi > 0:
        seg[:fi] *= np.linspace(0, 1, fi)
    if fo > 0 and fo < len(seg):
        seg[-fo:] *= np.linspace(1, 0, fo)

    seg = resample(seg, sr, rate)
    peak = float(np.max(np.abs(seg))) or 1.0
    seg = seg * (gain / peak)
    path = os.path.join(OUT, name)
    n = write_wav(path, seg, rate)
    print('  %-16s %5.2fs from %s @%d' % (name, n / rate, os.path.basename(src), sr))
    return path


def loopable(name, src, secs=1.6, rate=RATE, gain=0.7):
    """A stretch that can be held down.

    Taken from the middle, where the recording is steady, and cross-faded
    end to end so holding it does not tick once a loop. A hiss that ticks
    is a hiss nobody can leave running.
    """
    a, sr = read_wav(src)
    want = int(sr * secs)
    if len(a) < want * 2:
        want = max(1, len(a) // 2)
    mid = len(a) // 2
    seg = a[mid - want // 2: mid + want // 2].astype(np.float32).copy()

    xf = min(int(sr * 0.15), len(seg) // 4)
    if xf > 0:
        head = seg[:xf].copy()
        seg[:xf] *= np.linspace(0, 1, xf)
        seg[-xf:] = seg[-xf:] * np.linspace(1, 0, xf) + head * np.linspace(1, 0, xf)[::-1]
    seg = resample(seg, sr, rate)
    peak = float(np.max(np.abs(seg))) or 1.0
    seg = seg * (gain / peak)
    n = write_wav(os.path.join(OUT, name), seg, rate)
    print('  %-16s %5.2fs loop from %s' % (name, n / rate, os.path.basename(src)))


def main():
    os.makedirs(OUT, exist_ok=True)
    g = os.path.join(RAW, 'Prepared SFX Library')
    hiss = os.path.join(RAW, 'steam_hisses_-_Marker_#%d.wav')

    print('cut  guns')
    # A submachine gun for the gatling: the shortest, driest report in the
    # library, because forty of them a second must not turn into mud.
    cut('fire-light.wav', os.path.join(g, 'PPSh', 'P_22P.wav'), tail=0.45)
    # A rifle on a hillside for the heavy guns: 0.9s of it, tail and all.
    cut('fire-heavy.wav', os.path.join(g, 'Mosin Nagant', 'M_21P.wav'), tail=1.1)
    cut('fire-shot.wav', os.path.join(g, 'Mossberg', 'N_26P.wav'), tail=0.9)
    cut('fire-sniper.wav', os.path.join(g, 'Tikka', 'W_24P.wav'), tail=1.3)
    cut('fire-pistol.wav', os.path.join(g, 'Ruger Mark III', 'R_30P.wav'), tail=0.5)

    print('cut  pneumatics')
    # What a machine of this size actually sounds like when it moves: air
    # under pressure, not an oscillator.
    cut('dash.wav', hiss % 2, tail=0.55, lead=0.01)
    cut('jump.wav', hiss % 4, tail=0.7, lead=0.01)
    loopable('thrust.wav', hiss % 1, secs=1.8, gain=0.75)
    loopable('servo.wav', hiss % 3, secs=1.4, gain=0.6)
    # An energy blade has no field recording anywhere, so it gets the one
    # honest thing available: pressurised air, held. The synthesised layer
    # underneath is what makes it electric.
    loopable('blade.wav', hiss % 5, secs=1.2, gain=0.55)


if __name__ == '__main__':
    main()
