import { describe, expect, it } from 'vitest';

import { ownValue } from '../src/own-value.js';

describe('ownValue', () => {
  const table: Readonly<Record<string, number>> = { a: 1, zero: 0 };

  it('returns what the table owns, falsy values included', () => {
    expect(ownValue(table, 'a')).toBe(1);
    expect(ownValue(table, 'zero')).toBe(0);
  });

  it('returns undefined for a missing key', () => {
    expect(ownValue(table, 'b')).toBeUndefined();
  });

  it.each(['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'])(
    'returns undefined for the inherited name %s, which bracket access would resolve',
    key => {
      expect((table as Record<string, unknown>)[key]).toBeDefined(); // the hazard being guarded
      expect(ownValue(table, key)).toBeUndefined();
    },
  );

  it('still answers correctly when the table shadows hasOwnProperty itself', () => {
    const shadowing: Record<string, unknown> = { hasOwnProperty: () => true, x: 'own' };
    expect(ownValue(shadowing, 'x')).toBe('own');
    expect(ownValue(shadowing, 'missing')).toBeUndefined();
  });
});
