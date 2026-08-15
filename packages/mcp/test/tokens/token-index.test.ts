import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GetDesignContextResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import {
  annotateProjectTokens,
  buildTokenValueIndex,
  loadTokenValueIndex,
} from '../../src/tokens/token-index.js';
import { parseCssCustomProperties, type ProjectToken } from '../../src/tokens/tokens.js';

const proj = (name: string, value: string, utility?: string): ProjectToken => ({
  name,
  value,
  cssVar: `var(--${name})`,
  ...(utility === undefined ? {} : { utility }),
});

describe('buildTokenValueIndex', () => {
  it('indexes hex-valued tokens by normalized hex and skips non-hex values', () => {
    const index = buildTokenValueIndex([
      proj('color-primary', '#6266F0'),
      proj('color-primary-lower', '#6266f0'),
      proj('radius-lg', '0.5rem'),
      proj('color-fancy', 'oklch(0.6 0.2 270)'),
    ]);
    expect(index.get('#6266F0')?.map(t => t.name)).toEqual([
      'color-primary',
      'color-primary-lower',
    ]);
    expect(index.size).toBe(1);
  });

  it('normalizes shorthand and drops an opaque alpha', () => {
    const index = buildTokenValueIndex([proj('white', '#fff'), proj('card', '#FFFFFFFF')]);
    expect(index.get('#FFFFFF')?.map(t => t.name)).toEqual(['white', 'card']);
  });

  it('collapses duplicate name+value declarations (aggregated CSS repeats a file)', () => {
    const index = buildTokenValueIndex([
      proj('color-primary', '#6266F0'),
      proj('color-primary', '#6266F0'),
    ]);
    expect(index.get('#6266F0')).toHaveLength(1);
  });
});

describe('annotateProjectTokens', () => {
  const result = (over: Partial<GetDesignContextResult> = {}): GetDesignContextResult => ({
    nodes: [{ id: '1:1', name: 'Card', type: 'FRAME' }],
    ...over,
  });

  it('annotates a unique value match with the emit ref, keyed by the verbatim payload string', () => {
    const index = buildTokenValueIndex([proj('color-primary-500', '#6266F0', 'primary-500')]);
    const payload = result({
      globalVars: { styles: { abc: [{ type: 'SOLID', color: '#6266f0' }] } },
    });
    const r = annotateProjectTokens(payload, index, false);
    // Keyed exactly as it appears in the payload (lowercase here), value ref is the CSS var
    // off-Tailwind.
    expect(r.projectTokens).toEqual({
      '#6266f0': {
        ref: 'var(--color-primary-500)',
        name: 'color-primary-500',
        matchedBy: ['value'],
      },
    });
  });

  it('emits the Tailwind utility as ref on a Tailwind project', () => {
    const index = buildTokenValueIndex([proj('color-primary-500', '#6266F0', 'primary-500')]);
    const payload = result({ globalVars: { styles: { abc: { color: '#6266F0' } } } });
    const r = annotateProjectTokens(payload, index, true);
    expect(r.projectTokens?.['#6266F0']).toEqual({
      ref: 'primary-500',
      name: 'color-primary-500',
      matchedBy: ['value'],
    });
  });

  it('lists 2–3 same-value tokens as unranked candidates, sorted by name', () => {
    const index = buildTokenValueIndex([
      proj('color-white', '#FFFFFF'),
      proj('color-background', '#FFFFFF'),
    ]);
    const payload = result({ globalVars: { styles: { s: { color: '#FFFFFF' } } } });
    const r = annotateProjectTokens(payload, index, false);
    expect(r.projectTokens?.['#FFFFFF']).toEqual({
      matchedBy: ['value'],
      candidates: [
        { ref: 'var(--color-background)', name: 'color-background' },
        { ref: 'var(--color-white)', name: 'color-white' },
      ],
    });
  });

  it('omits a color shared by more than three tokens (noise)', () => {
    const index = buildTokenValueIndex(
      ['a', 'b', 'c', 'd'].map(n => proj(`color-${n}`, '#FFFFFF')),
    );
    const payload = result({ globalVars: { styles: { s: { color: '#FFFFFF' } } } });
    const r = annotateProjectTokens(payload, index, false);
    expect(r.projectTokens).toBeUndefined();
  });

  it('walks node trees (inline fills, effects, nested arrays) too', () => {
    const index = buildTokenValueIndex([proj('color-shadow', '#00000040')]);
    const payload = result({
      nodes: [
        {
          id: '1:1',
          name: 'Card',
          type: 'FRAME',
          children: [
            {
              id: '1:2',
              name: 'Row',
              type: 'FRAME',
              effects: [{ type: 'DROP_SHADOW', color: '#00000040' }],
            } as never,
          ],
        },
      ],
    });
    const r = annotateProjectTokens(payload, index, false);
    expect(r.projectTokens?.['#00000040']).toEqual({
      ref: 'var(--color-shadow)',
      name: 'color-shadow',
      matchedBy: ['value'],
    });
  });

  it('returns the input untouched when nothing matches or the index is empty', () => {
    const payload = result({ globalVars: { styles: { s: { color: '#123456' } } } });
    expect(annotateProjectTokens(payload, new Map(), false)).toBe(payload);
    const index = buildTokenValueIndex([proj('color-primary', '#6266F0')]);
    const r = annotateProjectTokens(payload, index, false);
    expect(r).toBe(payload);
    expect(r.projectTokens).toBeUndefined();
  });
});

describe('loadTokenValueIndex', () => {
  it('builds the index from a plain CSS-variables project and caches until the file changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tokenidx-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    const css = join(dir, 'src', 'theme.css');
    await writeFile(css, ':root { --primary: #6266F0; }');

    const first = await loadTokenValueIndex(dir);
    expect(first.utilityFirst).toBe(false);
    expect(first.index.get('#6266F0')?.[0]?.name).toBe('primary');

    // Cached: same map instance while the file is untouched.
    const second = await loadTokenValueIndex(dir);
    expect(second.index).toBe(first.index);

    // An edit (mtime bump) invalidates the cache and the new value shows up.
    await writeFile(css, ':root { --primary: #FF0000; }');
    await utimes(css, new Date(), new Date(Date.now() + 5000));
    const third = await loadTokenValueIndex(dir);
    expect(third.index.get('#FF0000')?.[0]?.name).toBe('primary');
    expect(third.index.get('#6266F0')).toBeUndefined();
  });

  it('returns an empty index (never throws) on a directory with no tokens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tokenidx-empty-'));
    const r = await loadTokenValueIndex(dir);
    expect(r.index.size).toBe(0);
  });
});

describe('annotateProjectTokens — themed stylesheets', () => {
  // A light/dark stylesheet parsed for real. Every declared value now reaches the index, where the
  // previous parser kept only whichever block came last — so a light-mode color had no entry at all.
  const themed = parseCssCustomProperties(`
    :root { --background: #FFFFFF; --foreground: #0A0A0A; --card: #FFFFFF; }
    .dark { --background: #0A0A0A; --foreground: #FAFAFA; --card: #171717; }
  `);

  it('annotates a light-mode value that used to have no index entry at all', () => {
    const index = buildTokenValueIndex(themed);
    const r = annotateProjectTokens(
      { nodes: [], globalVars: { styles: { a: [{ type: 'SOLID', color: '#FFFFFF' }] } } },
      index,
      false,
    );
    // #FFFFFF is --background and --card in light mode; both are surfaced, unranked, as candidates.
    expect(r.projectTokens).toEqual({
      '#FFFFFF': {
        matchedBy: ['value'],
        candidates: [
          { ref: 'var(--background)', name: 'background' },
          { ref: 'var(--card)', name: 'card' },
        ],
      },
    });
  });

  it('withholds an annotation the old parser answered confidently but wrongly', () => {
    // #0A0A0A is --foreground in light mode AND --background in dark mode. Collapsing the repeated
    // names hid the light declarations, leaving exactly one candidate — so the payload used to be
    // annotated "#0A0A0A is --background", which inverts the color in light mode. Seeing all of them
    // makes it correctly ambiguous, and an ambiguous color is left to the raw hex rather than bound
    // to an arbitrary sibling.
    const index = buildTokenValueIndex(themed);
    expect(index.get('#0A0A0A')?.map(t => t.name)).toEqual(['foreground', 'background']);
    const r = annotateProjectTokens(
      { nodes: [], globalVars: { styles: { a: [{ type: 'SOLID', color: '#0A0A0A' }] } } },
      index,
      false,
    );
    expect(r.projectTokens).toEqual({
      '#0A0A0A': {
        matchedBy: ['value'],
        candidates: [
          { ref: 'var(--background)', name: 'background' },
          { ref: 'var(--foreground)', name: 'foreground' },
        ],
      },
    });
  });
});
