import { describe, expect, it } from 'vitest';

import { joinTokens } from '../../src/join/token-map.js';
import type { FigmaToken } from '../../src/tokens/figma-tokens.js';
import type { ProjectToken } from '../../src/tokens/tokens.js';

const fig = (
  name: string,
  value: FigmaToken['value'],
  type = 'COLOR',
  collection?: string,
): FigmaToken => ({
  name,
  value,
  type,
  ...(collection === undefined ? {} : { collection }),
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

  describe('Tailwind/Figma namespace synonyms (B3)', () => {
    it('matches Figma rounded/* to a Tailwind --radius-* token', () => {
      const radii = [proj('radius-lg', '0.5rem', 'lg', 'radius')];
      const [m] = joinTokens([fig('rounded/lg', 8, 'FLOAT')], radii, { threshold: 0.7 });
      expect(m?.candidate?.token).toBe('radius-lg');
      expect(m?.status).toBe('high');
    });

    it('does NOT alias size→text outside a typography collection (size/* is overloaded)', () => {
      const text = [proj('text-base', '1rem', 'base', 'font-size')];
      // In Design A the "size" collection actually holds radius/spacing dimensions, not font sizes, so a
      // size/* there must not snap to --text-base (always font-size). No collection is treated the same.
      expect(
        joinTokens([fig('size/base', 16, 'FLOAT', 'size')], text, { threshold: 0.7 })[0]?.status,
      ).toBe('unmapped');
      expect(joinTokens([fig('size/base', 16, 'FLOAT')], text, { threshold: 0.7 })[0]?.status).toBe(
        'unmapped',
      );
    });

    it('aliases size→text when the Figma variable is in a typography collection', () => {
      // Design A groups font sizes under a "font" collection → size/base is a font size → --text-base.
      const text = [proj('text-base', '1rem', 'base', 'font-size')];
      const [m] = joinTokens([fig('size/base', 16, 'FLOAT', 'font')], text, { threshold: 0.7 });
      expect(m?.candidate?.token).toBe('text-base');
      expect(m?.status).toBe('high');
    });

    it('still gates on the step: rounded/md does not match radius-lg', () => {
      const radii = [proj('radius-lg', '0.5rem', 'lg', 'radius')];
      const [m] = joinTokens([fig('rounded/md', 6, 'FLOAT')], radii, { threshold: 0.7 });
      expect(m?.status).toBe('unmapped');
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
