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

  it('ignores comments and lets later declarations win', () => {
    const css = `:root { --color-x: #111; }
      /* --color-x: #999; should be ignored (commented) */
      @theme { --color-x: #222; }`;
    const tokens = parseCssCustomProperties(css);
    expect(tokens.filter(t => t.name === 'color-x')).toHaveLength(1);
    expect(tokens.find(t => t.name === 'color-x')?.value).toBe('#222');
  });
});
