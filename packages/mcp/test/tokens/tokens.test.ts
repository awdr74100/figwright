import { describe, expect, it } from 'vitest';

import { parseCssCustomProperties } from '../../src/tokens/tokens.js';

describe('parseCssCustomProperties', () => {
  it('parses Tailwind v4 @theme tokens with utility base + category', () => {
    const css = `@theme {
      --color-primary-500: #6266F0;
      --radius-lg: 0.5rem;
      --font-weight-bold: 700;
    }`;
    const tokens = parseCssCustomProperties(css);
    const primary = tokens.find(t => t.name === 'color-primary-500');
    expect(primary).toMatchObject({
      value: '#6266F0',
      cssVar: 'var(--color-primary-500)',
      utility: 'primary-500',
      category: 'color',
    });
    expect(tokens.find(t => t.name === 'radius-lg')?.utility).toBe('lg');
    // font-weight- must win over font-
    expect(tokens.find(t => t.name === 'font-weight-bold')?.category).toBe('font-weight');
  });

  it('parses plain :root CSS vars with no utility/category', () => {
    const tokens = parseCssCustomProperties(':root { --primary-500: #6266F0; --gap: 8px; }');
    const t = tokens.find(x => x.name === 'primary-500');
    expect(t?.cssVar).toBe('var(--primary-500)');
    expect(t?.utility).toBeUndefined();
    expect(t?.category).toBeUndefined();
  });

  it('ignores commented-out declarations', () => {
    const css = `:root { --color-x: #111; }
      /* --color-x: #999; should be ignored (commented) */`;
    const tokens = parseCssCustomProperties(css);
    expect(tokens.filter(t => t.name === 'color-x')).toHaveLength(1);
    expect(tokens.find(t => t.name === 'color-x')?.value).toBe('#111');
  });

  it('keeps every distinct value of a repeated name, @theme leading', () => {
    const css = `:root { --color-x: #111; }
      @theme { --color-x: #222; }`;
    const tokens = parseCssCustomProperties(css).filter(t => t.name === 'color-x');
    // Both are real values the project declares; collapsing them is what used to make a light
    // theme's colors unmatchable once a dark theme redeclared them.
    expect(tokens.map(t => t.value)).toEqual(['#222', '#111']);
  });

  it('leads with the base :root value rather than a theme override', () => {
    const css = `:root { --bg: #FFFFFF; }
      .dark { --bg: #000000; }
      @media (prefers-color-scheme: dark) { :root { --bg: #010101; } }`;
    const tokens = parseCssCustomProperties(css).filter(t => t.name === 'bg');
    // The unconditional :root leads; the class override and the media-nested :root follow in
    // document order — a :root inside @media is an override, not the base declaration.
    expect(tokens.map(t => t.value)).toEqual(['#FFFFFF', '#000000', '#010101']);
  });

  it('collapses a name+value repeated across blocks', () => {
    const css = ':root { --a: 1px; } .x { --a: 1px; } .y { --a: 2px; }';
    const tokens = parseCssCustomProperties(css).filter(t => t.name === 'a');
    // Same value in three places is one token — reporting it twice would make token_map call it
    // ambiguous with itself.
    expect(tokens.map(t => t.value)).toEqual(['1px', '2px']);
  });
});
