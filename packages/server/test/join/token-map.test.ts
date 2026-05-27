import { describe, expect, it } from 'vitest';

import { joinTokens } from '../../src/join/token-map.js';
import type { FigmaToken } from '../../src/tokens/figma-tokens.js';
import type { ProjectToken } from '../../src/tokens/tokens.js';

const fig = (name: string, value: FigmaToken['value'], type = 'COLOR'): FigmaToken => ({
  name,
  value,
  type,
});

const proj = (name: string, value: string, utility?: string, category?: string): ProjectToken => ({
  name,
  value,
  cssVar: `var(--${name})`,
  ...(utility === undefined ? {} : { utility }),
  ...(category === undefined ? {} : { category }),
});

const tokens: ProjectToken[] = [
  proj('color-primary-500', '#6266F0', 'primary-500', 'color'),
  proj('color-grey-900', '#111827', 'grey-900', 'color'),
  proj('radius-lg', '0.5rem', 'lg', 'radius'),
];

describe('joinTokens', () => {
  it('matches by name + value as high confidence, recommending the Tailwind utility', () => {
    const [m] = joinTokens([fig('Primary/500', '#6266F0')], tokens, { threshold: 0.7 });
    expect(m?.candidate?.token).toBe('color-primary-500');
    expect(m?.candidate?.ref).toBe('primary-500');
    expect(m?.candidate?.cssVar).toBe('var(--color-primary-500)');
    expect(m?.candidate?.matchedBy).toEqual(['name', 'value']);
    expect(m?.candidate?.confidence).toBe(1);
    expect(m?.status).toBe('high');
  });

  it('uses an exact color value-match even when the name differs', () => {
    const [m] = joinTokens([fig('Brand/Indigo', '#6266F0')], tokens, { threshold: 0.7 });
    expect(m?.candidate?.token).toBe('color-primary-500');
    expect(m?.candidate?.matchedBy).toEqual(['value']);
    expect(m?.candidate?.confidence).toBe(0.9);
    expect(m?.status).toBe('high');
  });

  it('falls back to name-match when values are not comparable (e.g. oklch project token)', () => {
    const oklch = [proj('color-primary-500', 'oklch(0.6 0.2 270)', 'primary-500', 'color')];
    const [m] = joinTokens([fig('Primary/500', '#6266F0')], oklch, { threshold: 0.7 });
    expect(m?.candidate?.token).toBe('color-primary-500');
    expect(m?.candidate?.matchedBy).toEqual(['name']);
    expect(m?.status).toBe('high');
  });

  it('normalizes hex shorthand and a fully-opaque alpha before comparing', () => {
    const [m] = joinTokens([fig('White', '#FFFFFFFF')], [proj('color-white', '#fff', 'white')], {
      threshold: 0.7,
    });
    expect(m?.candidate?.token).toBe('color-white');
    expect(m?.candidate?.matchedBy).toContain('value');
  });

  it('flags unmapped when neither name nor value match', () => {
    const [m] = joinTokens([fig('Accent/Teal', '#14B8A6')], tokens, { threshold: 0.7 });
    expect(m?.status).toBe('unmapped');
    expect(m?.candidate).toBeUndefined();
  });

  describe('scale-step gating (B2)', () => {
    it('does not snap a different scale step in the same family to the one that exists', () => {
      // Project defines only primary-500; Primary/50 must NOT match it (50 ≠ 500).
      const [m] = joinTokens([fig('Primary/50', '#F3F5FF')], tokens, { threshold: 0.7 });
      expect(m?.status).toBe('unmapped');
      expect(m?.candidate).toBeUndefined();
    });

    it('does not snap an arbitrary spacing value to the nearest defined step', () => {
      const spacing = [proj('spacing-2', '8px', '2', 'spacing')];
      const [m] = joinTokens([fig('spacing/24', 96, 'FLOAT')], spacing, { threshold: 0.7 });
      expect(m?.status).toBe('unmapped');
    });

    it('still matches when the scale step agrees', () => {
      const spacing = [proj('spacing-2', '8px', '2', 'spacing')];
      const [m] = joinTokens([fig('spacing/2', 8, 'FLOAT')], spacing, { threshold: 0.7 });
      expect(m?.candidate?.token).toBe('spacing-2');
      expect(m?.status).toBe('high');
    });
  });

  it('caps confidence when the name matches but a known color value disagrees (B1)', () => {
    // Same step + stem (grey-100), but the project shade drifted from Figma's — name says yes,
    // value says verify, so it must not read as a confirmed "high" reuse.
    const greys = [proj('color-grey-100', '#EEEEEE', 'grey-100', 'color')];
    const [m] = joinTokens([fig('Grey/100', '#F5F5F5')], greys, { threshold: 0.7 });
    expect(m?.candidate?.token).toBe('color-grey-100');
    expect(m?.candidate?.matchedBy).toEqual(['name']);
    expect(m?.candidate?.confidence).toBeLessThan(0.85);
    expect(m?.status).not.toBe('high');
  });
});
