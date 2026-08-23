import { describe, it, expect, beforeEach } from 'vitest';
import {
  encodeShare, decodeShare, isShareCode, measureShare,
  SHARE_PREFIX, SHARE_PREFIX_RAW, QR_BYTE_LIMIT,
} from '../src/core/Share.js';
import { Assembly, PRESETS, computeStats, _resetIds } from '../src/core/Assembly.js';
import { EQUIP } from '../src/core/constants.js';

// Node has no btoa/atob on older majors; the browser always does.
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');

describe('share codes', () => {
  beforeEach(() => _resetIds(0));

  it('round-trips a whole machine', async () => {
    const a = PRESETS.biped.build();
    a.name = 'ROUND TRIP';
    const back = await decodeShare(await encodeShare(a));

    expect(back.name).toBe('ROUND TRIP');
    expect(back.size).toBe(a.size);
    expect(back.core.kind).toBe('core');
    expect(computeStats(back).durability).toBe(computeStats(a).durability);
  });

  it('keeps everything that makes a build what it is', async () => {
    const a = PRESETS.biped.build();
    const chest = [...a.parts.values()].find((p) => p.size?.[0] === 1.5);
    const shotId = a.addEquipOnFace(chest.id, 4, EQUIP.SHOT, {
      size: 0.9, bulletColor: 0x6bff6b,
    }).id;
    const rollId = a.addEquipOnFace(chest.id, 2, EQUIP.ROLLING, {
      spin: { dir: -1, rpm: 210 },
    }).id;
    const custom = a.addBoneOnFace(chest.id, 0, 'custom', { length: 2 });
    Object.assign(custom.custom, { wave: 'saw', freq: 2.5, offset: 30 });
    a.core.vox.brush(8, 8, 8, 4, 0);
    a.setSize(a.rootId, [1.5, 1.5, 1.5]);

    const back = await decodeShare(await encodeShare(a));
    const shot = back.get(shotId);
    const roll = back.get(rollId);
    expect(shot.equipType).toBe(EQUIP.SHOT);
    expect(shot.bulletColor).toBe(0x6bff6b);
    expect(shot.size).toBeCloseTo(0.9, 6);
    expect(roll.spin).toEqual({ dir: -1, rpm: 210 });
    expect(back.get(custom.id).custom).toMatchObject({ wave: 'saw', freq: 2.5, offset: 30 });
    expect(back.core.size).toEqual([1.5, 1.5, 1.5]);
    expect(back.core.vox.solid).toBe(a.core.vox.solid);
  });

  it('round-trips a part document as a part', async () => {
    const doc = Assembly.createPart('SHOULDER POD');
    doc.addBlockOnFace(doc.rootId, 2, 5, { size: [0.5, 0.5, 0.5] });
    const back = await decodeShare(await encodeShare(doc));
    expect(back.isPart).toBe(true);
    expect(back.name).toBe('SHOULDER POD');
    expect(back.size).toBe(2);
  });

  it('is marked, so a stray paste is not mistaken for one', async () => {
    const code = await encodeShare(PRESETS.core.build());
    expect(code.startsWith(SHARE_PREFIX) || code.startsWith(SHARE_PREFIX_RAW)).toBe(true);
    expect(isShareCode(code)).toBe(true);
    expect(isShareCode(`  ${code}  `), 'whitespace is forgiven').toBe(true);
    expect(isShareCode('hello')).toBe(false);
    expect(isShareCode('')).toBe(false);
    expect(isShareCode(null)).toBe(false);
  });

  it('is url-safe and has no padding, so it survives being pasted anywhere', async () => {
    const code = await encodeShare(PRESETS.multileg.build());
    expect(code.slice(SHARE_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('compresses hard enough to fit in a QR', async () => {
    for (const key of Object.keys(PRESETS)) {
      const info = await measureShare(PRESETS[key].build());
      expect(info.bytes, key).toBeLessThan(QR_BYTE_LIMIT);
      expect(info.bytes, `${key} is much smaller than the raw JSON`)
        .toBeLessThan(JSON.stringify(PRESETS[key].build().toJSON()).length / 2);
    }
  });

  it('measure says what it is without the caller decoding it', async () => {
    const machine = await measureShare(PRESETS.biped.build());
    expect(machine.isPart).toBe(false);
    expect(machine.name).toBe('STRIDER');
    expect(machine.fitsQR).toBe(true);

    const part = await measureShare(Assembly.createPart('POD'));
    expect(part.isPart).toBe(true);
  });

  it('refuses anything that is not one of ours, with a reason', async () => {
    await expect(decodeShare('hello')).rejects.toThrow('共有コード');
    await expect(decodeShare('')).rejects.toThrow('共有コード');
    await expect(decodeShare(`${SHARE_PREFIX}!!!!`)).rejects.toThrow('壊れています');
    await expect(decodeShare(`${SHARE_PREFIX_RAW}aGVsbG8`), 'valid base64, not our JSON')
      .rejects.toThrow('壊れています');
  });

  it('refuses a well-formed document that is not a build', async () => {
    const notOurs = `${SHARE_PREFIX_RAW}${btoa('{"format":"something.else"}')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    await expect(decodeShare(notOurs)).rejects.toThrow('BroStom のデータではありません');
  });

  it('an uncompressed code still loads', async () => {
    const a = PRESETS.core.build();
    const json = JSON.stringify(a.toJSON());
    const b64 = btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const back = await decodeShare(SHARE_PREFIX_RAW + b64);
    expect(back.size).toBe(a.size);
  });

  it('survives a code broken across lines, the way a chat app would', async () => {
    const code = await encodeShare(PRESETS.hopper.build());
    const wrapped = code.slice(0, 5) + code.slice(5).replace(/(.{40})/g, '$1\n');
    const back = await decodeShare(wrapped);
    expect(back.size).toBe(PRESETS.hopper.build().size);
  });
});
