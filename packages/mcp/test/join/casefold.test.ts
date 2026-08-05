import { describe, expect, it } from 'vitest';

import { casefold } from '../../src/join/casefold.js';

describe('casefold', () => {
  it('folds the separator and case conventions the two sides disagree on', () => {
    // A Figma property label and the code identifier for it are the same thing spelled differently.
    for (const variant of ['Show icon', 'show-icon', 'show_icon', 'showIcon', 'SHOW ICON'])
      expect(casefold(variant)).toBe('showicon');
  });

  it('strips Latin diacritics so an accented label matches an ASCII identifier', () => {
    // Designers write the product name; the JS symbol is ASCII by convention.
    expect(casefold('Café')).toBe(casefold('Cafe'));
    expect(casefold('Ünï-Tëst')).toBe('unitest');
  });

  it('keeps letters and digits in every script, distinctly', () => {
    // Load-bearing: an [a-z0-9] filter folds all of these to '', and equal empty strings compare as
    // a *perfect* Dice match — so a Chinese name would score 1.0 against a Japanese one, and any
    // map keyed on the fold would collapse every non-Latin entry onto a single bucket.
    const folded = ['按鈕', 'ボタン', '버튼', 'Кнопка', 'κουμπί'].map(casefold);
    expect(folded.every(f => f.length > 0)).toBe(true);
    expect(new Set(folded).size).toBe(folded.length); // all distinct
  });

  it('recomposes so Hangul stays syllables rather than decomposed jamo', () => {
    // NFD splits Hangul; leaving it split would change every Korean name's bigrams.
    expect(casefold('버튼')).toBe('버튼');
    expect([...casefold('버튼')]).toHaveLength(2);
  });

  it('drops separators and symbols entirely', () => {
    expect(casefold('Button/Primary')).toBe('buttonprimary');
    expect(casefold('🔍 Search')).toBe('search');
    expect(casefold('   ')).toBe('');
  });
});
