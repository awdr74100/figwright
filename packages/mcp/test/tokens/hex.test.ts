import { describe, expect, it } from 'vitest';

import { HEX_LITERAL, normHex } from '../../src/tokens/hex.js';

describe('normHex', () => {
  it.each([
    ['#RGB', '#f00', '#FF0000'],
    ['#RGBA', '#0008', '#00000088'],
    ['#RRGGBB', '#6266f0', '#6266F0'],
    ['#RRGGBBAA', '#00000088', '#00000088'],
    ['#RGBA with an opaque alpha', '#F00F', '#FF0000'],
    ['#RRGGBBAA with an opaque alpha', '#FF0000ff', '#FF0000'],
    ['surrounding whitespace', '  #abc  ', '#AABBCC'],
  ])('normalizes %s', (_label, raw, expected) => {
    expect(normHex(raw)).toBe(expected);
  });

  // CSS accepts 3, 4, 6 and 8 digits only; anything else is not a color, so it must not be compared.
  it.each([
    ['5 digits', '#12345'],
    ['7 digits', '#1234567'],
    ['2 digits', '#12'],
    ['9 digits', '#123456789'],
    ['a non-hex digit', '#12345G'],
    ['no leading #', 'FF0000'],
    ['a function', 'rgb(255 0 0)'],
  ])('rejects %s', (_label, raw) => {
    expect(normHex(raw)).toBeNull();
  });

  it('agrees with HEX_LITERAL on what is a hex literal', () => {
    for (const raw of ['#f00', '#0008', '#6266f0', '#00000088', '#12345', '#1234567', '#12']) {
      expect(HEX_LITERAL.test(raw)).toBe(normHex(raw) !== null);
    }
  });
});
