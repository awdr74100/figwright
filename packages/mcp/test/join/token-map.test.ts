import { describe, expect, it } from 'vitest';

import { joinTokens, parseTokenMapFile } from '../../src/join/token-map.js';
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
    const [m] = joinTokens([fig('Primary/500', '#6266F0')], tokens, {
      threshold: 0.7,
      tailwind: true,
    });
    expect(m?.candidate?.token).toBe('color-primary-500');
    expect(m?.candidate?.ref).toBe('primary-500');
    expect(m?.candidate?.cssVar).toBe('var(--color-primary-500)');
    expect(m?.candidate?.matchedBy).toEqual(['name', 'value']);
    expect(m?.candidate?.confidence).toBe(1);
    expect(m?.status).toBe('high');
  });

  it('recommends the var() reference (not a bogus utility) on a non-Tailwind project', () => {
    // token.utility is derived from the name prefix and so is set even off-Tailwind, where no
    // `primary-500` class exists. With the flag off, ref must be the CSS var and utility not surfaced.
    const [m] = joinTokens([fig('Primary/500', '#6266F0')], tokens, { threshold: 0.7 });
    expect(m?.candidate?.token).toBe('color-primary-500');
    expect(m?.candidate?.ref).toBe('var(--color-primary-500)');
    expect(m?.candidate?.cssVar).toBe('var(--color-primary-500)');
    expect(m?.candidate?.utility).toBeUndefined();
    expect(m?.status).toBe('high'); // matching still works (utility aids it); only the ref changes
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
      // In some files the "size" collection actually holds radius/spacing dimensions, not font sizes, so a
      // size/* there must not snap to --text-base (always font-size). No collection is treated the same.
      expect(
        joinTokens([fig('size/base', 16, 'FLOAT', 'size')], text, { threshold: 0.7 })[0]?.status,
      ).toBe('unmapped');
      expect(joinTokens([fig('size/base', 16, 'FLOAT')], text, { threshold: 0.7 })[0]?.status).toBe(
        'unmapped',
      );
    });

    it('aliases size→text when the Figma variable is in a typography collection', () => {
      // When font sizes are grouped under a "font" collection → size/base is a font size → --text-base.
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

  describe('Tailwind framework built-in scale fallback (B1)', () => {
    it('flags a numeric spacing/N as framework-builtin (not a false gap) on a Tailwind project', () => {
      // Real Tailwind projects never redeclare the default spacing scale in @theme, so there is no
      // project token — but spacing/4 is still a usable utility step (p-4 / gap-4 / m-4).
      const [m] = joinTokens([fig('spacing/4', 16, 'FLOAT')], tokens, {
        threshold: 0.7,
        tailwind: true,
      });
      expect(m?.status).toBe('framework-builtin');
      expect(m?.builtin).toEqual({ scale: 'spacing', step: '4' });
      expect(m?.candidate).toBeUndefined();
    });

    it('recognizes Figma dash-written half-steps (spacing/1-5 → 1.5) and the px step', () => {
      // Figma can't put a dot in a name segment, so 1.5 is authored as "1-5" (value confirms: 6px).
      const half = joinTokens([fig('spacing/1-5', 6, 'FLOAT')], tokens, {
        threshold: 0.7,
        tailwind: true,
      })[0];
      expect(half?.status).toBe('framework-builtin');
      expect(half?.builtin?.step).toBe('1.5');

      const px = joinTokens([fig('spacing/px', 1, 'FLOAT')], tokens, {
        threshold: 0.7,
        tailwind: true,
      })[0];
      expect(px?.status).toBe('framework-builtin');
      expect(px?.builtin?.step).toBe('px');
    });

    it('NEVER overrides a real project match: declared spacing-4 wins as high (guarantee 1)', () => {
      const spacing = [proj('spacing-4', '16px', '4', 'spacing')];
      const [m] = joinTokens([fig('spacing/4', 16, 'FLOAT')], spacing, {
        threshold: 0.7,
        tailwind: true,
      });
      expect(m?.status).toBe('high');
      expect(m?.candidate?.token).toBe('spacing-4');
      expect(m?.builtin).toBeUndefined();
    });

    it('recognizes line-height/N as a framework-builtin (leading-N), despite the dash in the stem', () => {
      // line-height/7 = 28px = leading-7 (v4 leading is calc(var(--spacing) * 7) too). The stem's own
      // dash must not be mistaken for a half-step separator — split on "/" first.
      const [m] = joinTokens([fig('line-height/7', 28, 'FLOAT')], tokens, {
        threshold: 0.7,
        tailwind: true,
      });
      expect(m?.status).toBe('framework-builtin');
      expect(m?.builtin).toEqual({ scale: 'line-height', step: '7' });
    });

    it('maps weight/* to a font-weight built-in, renaming Regular → normal', () => {
      const bold = joinTokens([fig('weight/Bold', 'Bold', 'STRING')], tokens, {
        threshold: 0.7,
        tailwind: true,
      })[0];
      expect(bold?.status).toBe('framework-builtin');
      expect(bold?.builtin).toEqual({ scale: 'font-weight', step: 'bold' });

      const regular = joinTokens([fig('weight/Regular', 'Regular', 'STRING')], tokens, {
        threshold: 0.7,
        tailwind: true,
      })[0];
      expect(regular?.builtin).toEqual({ scale: 'font-weight', step: 'normal' });

      // Tolerates spacing/casing variants of the style name.
      const semi = joinTokens([fig('weight/Semi Bold', 'Semi Bold', 'STRING')], tokens, {
        threshold: 0.7,
        tailwind: true,
      })[0];
      expect(semi?.builtin?.step).toBe('semibold');
    });

    it('leaves an unknown weight name unmapped (conservative)', () => {
      const [m] = joinTokens([fig('weight/Condensed', 'Condensed', 'STRING')], tokens, {
        threshold: 0.7,
        tailwind: true,
      });
      expect(m?.status).toBe('unmapped');
    });

    it('does not fire on a non-Tailwind project (flag off) — stays unmapped', () => {
      const [m] = joinTokens([fig('spacing/4', 16, 'FLOAT')], tokens, { threshold: 0.7 });
      expect(m?.status).toBe('unmapped');
      expect(m?.builtin).toBeUndefined();
    });

    it('only blesses unambiguous namespaces: non-numeric spacing and size/* stay unmapped (guarantee 2)', () => {
      expect(
        joinTokens([fig('spacing/banner', 16, 'FLOAT')], tokens, {
          threshold: 0.7,
          tailwind: true,
        })[0]?.status,
      ).toBe('unmapped');
      // size/* is overloaded (font size vs dimension), so it is deliberately not treated as a built-in.
      expect(
        joinTokens([fig('size/68', 68, 'FLOAT')], tokens, { threshold: 0.7, tailwind: true })[0]
          ?.status,
      ).toBe('unmapped');
    });
  });

  it('carries figmaModes through the join untouched (theme-dependent token)', () => {
    const themed: FigmaToken = {
      ...fig('bg/surface', '#FFFFFF'),
      modes: { Light: '#FFFFFF', Dark: '#0A0A0A' },
    };
    const [m] = joinTokens([themed], [proj('color-surface', '#FFFFFF', 'surface', 'color')], {
      threshold: 0.7,
      tailwind: true,
    });
    // Matching still runs on the default-mode value; the per-theme values ride along verbatim.
    expect(m?.candidate?.token).toBe('color-surface');
    expect(m?.figmaModes).toEqual({ Light: '#FFFFFF', Dark: '#0A0A0A' });
  });

  it('leaves figmaModes absent for a single-mode token', () => {
    const [m] = joinTokens([fig('Primary/500', '#6266F0')], tokens, { threshold: 0.7 });
    expect(m?.figmaModes).toBeUndefined();
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

describe('joinTokens — same-value siblings (value-match ambiguity)', () => {
  // Real projects alias one color to several tokens; #FFFFFF is the canonical case. A value-only
  // match must never bind an arbitrary sibling at high confidence — that silently diverges the
  // moment the wrongly-chosen token is retuned.
  const whites: ProjectToken[] = [
    proj('color-white', '#FFFFFF', 'white', 'color'),
    proj('color-background', '#FFFFFF', 'background', 'color'),
    proj('color-card', '#FFFFFF', 'card', 'color'),
  ];

  it('lets the name pick the winner among same-value tokens', () => {
    const [m] = joinTokens([fig('Colors/Card', '#FFFFFF')], whites, { threshold: 0.7 });
    expect(m?.candidate?.token).toBe('color-card');
    expect(m?.candidate?.matchedBy).toEqual(['name', 'value']);
    expect(m?.candidate?.ambiguousWith).toBeUndefined();
    expect(m?.status).toBe('high');
  });

  it('caps below high and lists the siblings when the name carries no signal', () => {
    const [m] = joinTokens([fig('Brand/Snow', '#FFFFFF')], whites, { threshold: 0.7 });
    expect(m?.candidate).toBeDefined();
    expect(m?.candidate?.matchedBy).toEqual(['value']);
    expect(m?.candidate?.confidence).toBeLessThan(0.85);
    expect(m?.status).toBe('medium');
    // The pick plus its listed siblings must cover all three same-value tokens exactly.
    const names = [m?.candidate?.token, ...(m?.candidate?.ambiguousWith ?? [])].toSorted();
    expect(names).toEqual(['color-background', 'color-card', 'color-white']);
  });

  it('is deterministic regardless of project token order', () => {
    const [a] = joinTokens([fig('Brand/Snow', '#FFFFFF')], whites, { threshold: 0.7 });
    const [b] = joinTokens([fig('Brand/Snow', '#FFFFFF')], whites.toReversed(), {
      threshold: 0.7,
    });
    expect(a?.candidate?.token).toBe(b?.candidate?.token);
    expect(a?.candidate?.ambiguousWith).toEqual(b?.candidate?.ambiguousWith);
  });

  it('treats a name-score tie among siblings as ambiguous, not a confident pick', () => {
    // Without utilities, "brand" Dice-scores identically against color-brand and brand-color
    // (0.615 each) — no split, so the pick must be flagged, not confidently bound.
    const tied = [proj('color-brand', '#123456'), proj('brand-color', '#123456')];
    const [m] = joinTokens([fig('brand', '#123456')], tied, { threshold: 0.7 });
    expect(m?.candidate?.ambiguousWith).toHaveLength(1);
    expect(m?.status).not.toBe('high');
  });

  it('keeps the unique value-match at 0.9 high (unchanged behaviour)', () => {
    const unique = [proj('color-primary-500', '#6266F0', 'primary-500', 'color')];
    const [m] = joinTokens([fig('Brand/Indigo', '#6266F0')], unique, { threshold: 0.7 });
    expect(m?.candidate?.token).toBe('color-primary-500');
    expect(m?.candidate?.matchedBy).toEqual(['value']);
    expect(m?.candidate?.confidence).toBe(0.9);
    expect(m?.candidate?.ambiguousWith).toBeUndefined();
    expect(m?.status).toBe('high');
  });
});

describe('joinTokens — map-file overrides (write-back loop)', () => {
  it('an override wins as high with matchedBy map-file when its ref resolves', () => {
    // A recorded mapping for an otherwise-ambiguous / value-only Figma token: authoritative, not a
    // weak ['value'] hypothesis. The ref may be written as a utility, a var() reference, or a bare
    // custom-property name — all resolve to the same project token.
    const overrides = new Map([['Brand/Accent', 'primary-500']]);
    for (const ref of ['primary-500', 'var(--color-primary-500)', 'color-primary-500']) {
      const [m] = joinTokens([fig('Brand/Accent', '#123456')], tokens, {
        threshold: 0.7,
        tailwind: true,
        overrides: new Map([...overrides, ['Brand/Accent', ref]]),
      });
      expect(m?.candidate?.token).toBe('color-primary-500');
      expect(m?.candidate?.confidence).toBe(1);
      expect(m?.candidate?.matchedBy).toEqual(['map-file']);
      expect(m?.status).toBe('high');
      expect(m?.staleOverride).toBeUndefined();
    }
  });

  it('degrades a stale override (ref no longer resolves) to the normal join and flags it', () => {
    // The recorded token was renamed/removed. Referencing a nonexistent token is worse than the
    // fuzzy fallback, so it degrades — here Primary/500 still name+value matches its real token —
    // and reports the dead ref for cleanup.
    const overrides = new Map([['Primary/500', 'color-deleted-500']]);
    const [m] = joinTokens([fig('Primary/500', '#6266F0')], tokens, {
      threshold: 0.7,
      tailwind: true,
      overrides,
    });
    expect(m?.candidate?.token).toBe('color-primary-500'); // recovered the real match
    expect(m?.candidate?.matchedBy).not.toContain('map-file');
    expect(m?.staleOverride).toEqual({ ref: 'color-deleted-500' });
    expect(m?.status).toBe('high');
  });
});

describe('parseTokenMapFile', () => {
  it('parses table rows and arrow lines, skipping the header, keying raw + normalized', () => {
    const map = parseTokenMapFile(
      [
        '| Figma | Token |',
        '| --- | --- |',
        '| Brand/Primary | bg-primary-500 |',
        'Accent/Teal -> var(--color-teal)',
      ].join('\n'),
    );
    expect(map.get('Brand/Primary')).toBe('bg-primary-500');
    expect(map.get('brandprimary')).toBe('bg-primary-500'); // normalized key
    expect(map.get('Accent/Teal')).toBe('var(--color-teal)');
    expect(map.has('Figma')).toBe(false); // header skipped
  });

  it('does not mistake a data row for the header (whole-cell header match)', () => {
    // A figma name containing "figma" mapped to a ref containing "value" must NOT be dropped as a
    // header — the earlier substring check silently swallowed exactly this row.
    const map = parseTokenMapFile(
      [
        '| Figma | Ref |', // real header — skipped
        '| :--- | ---: |', // aligned separator — skipped
        '| Figma/Brand | brand-value |', // data row that trips a substring check
      ].join('\n'),
    );
    expect(map.get('Figma/Brand')).toBe('brand-value');
    expect(map.has('Figma')).toBe(false);
    expect([...map.keys()].some(k => k.startsWith(':'))).toBe(false);
  });
});
