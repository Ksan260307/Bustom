import { describe, it, expect } from 'vitest';
import { readNumber } from '../src/ui/dom.js';

// ============================================================
//  The calculator behind the numeric fields.
//
//  Sizes come out of other sizes — half of that, three of these plus a gap —
//  and the field used to take only the answer, so the arithmetic happened in
//  somebody's head and arrived as a decimal nobody could check.
// ============================================================

describe('readNumber', () => {
  it('takes a plain number', () => {
    expect(readNumber('1.25')).toBe(1.25);
    expect(readNumber('-0.5')).toBe(-0.5);
  });

  it('works out the arithmetic people actually type', () => {
    expect(readNumber('0.5*3')).toBe(1.5);
    expect(readNumber('1.2 + 0.3')).toBeCloseTo(1.5, 10);
    expect(readNumber('(2+1)/4')).toBe(0.75);
    expect(readNumber('2.4/2')).toBe(1.2);
  });

  it('falls back rather than guessing when it cannot read it', () => {
    expect(readNumber('', 7)).toBe(7);
    expect(readNumber('   ', 7)).toBe(7);
    expect(readNumber('abc', 7)).toBe(7);
    expect(readNumber('1/0', 7)).toBe(7);          // Infinity is not a size
    expect(readNumber('2+', 7)).toBe(7);           // half-typed
  });

  it('refuses anything that is not arithmetic', () => {
    // The field is read with Function(), so what it will accept matters more
    // than what it computes. Nothing with a name in it gets that far.
    let touched = false;
    globalThis.__touched = () => { touched = true; return 1; };
    expect(readNumber('__touched()', 3)).toBe(3);
    expect(readNumber('globalThis.x=1', 3)).toBe(3);
    expect(readNumber('[].constructor', 3)).toBe(3);
    expect(touched).toBe(false);
    delete globalThis.__touched;
  });
});
