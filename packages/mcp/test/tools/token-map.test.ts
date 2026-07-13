import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GetStylesResult, GetVariableDefsResult } from '@figwright/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET_STYLES_TOOL_NAME } from '../../src/tools/get-styles.js';
import { GET_VARIABLE_DEFS_TOOL_NAME } from '../../src/tools/get-variable-defs.js';
import { handleTokenMap, type ToolDispatcher } from '../../src/tools/token-map.js';

const defs: GetVariableDefsResult = {
  collections: [
    {
      id: 'c',
      name: 'Tokens',
      key: 'k',
      defaultModeId: 'm',
      modes: [{ modeId: 'm', name: 'Default' }],
      variableIds: [],
    },
  ],
  variables: [
    {
      id: 'v1',
      name: 'Primary/500',
      key: 'k',
      resolvedType: 'COLOR',
      collectionId: 'c',
      valuesByMode: { m: { r: 0.384, g: 0.4, b: 0.941, a: 1 } },
    },
    {
      id: 'v2',
      name: 'Accent/Teal',
      key: 'k',
      resolvedType: 'COLOR',
      collectionId: 'c',
      valuesByMode: { m: { r: 0.078, g: 0.722, b: 0.651, a: 1 } },
    },
  ],
};

const emptyStyles: GetStylesResult = { paints: [], texts: [], effects: [], grids: [] };

const dispatch: ToolDispatcher = async tool => {
  if (tool === GET_VARIABLE_DEFS_TOOL_NAME) return defs;
  if (tool === GET_STYLES_TOOL_NAME) return emptyStyles;
  throw new Error(`unexpected dispatch: ${tool}`);
};

describe('handleTokenMap', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tokenmap-test-'));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { tailwindcss: '^4.0.0', '@tailwindcss/vite': '^4.0.0' } }),
    );
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(
      join(dir, 'src', 'app.css'),
      '@import "tailwindcss";\n@theme {\n  --color-primary-500: #6266F0;\n}\n',
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('detects the v4 @theme source, maps Primary/500, flags the unmatched token', async () => {
    const result = await handleTokenMap(dispatch, { rootDir: dir });
    expect(result.tokenSource).toBe('src/app.css');
    expect(result.projectTokenCount).toBe(1);

    const primary = result.mappings.find(m => m.figmaName === 'Primary/500');
    expect(primary?.candidate?.ref).toBe('primary-500');
    expect(primary?.status).toBe('high');

    expect(result.unmapped).toContain('Accent/Teal');
    expect(result.themedCollections).toEqual([]); // single-mode file — no theme axes
    expect(result.profile.styling.tailwindVersion).toBe(4);
  });

  it('surfaces theme axes and per-mode values for a multi-mode collection', async () => {
    const themedDefs: GetVariableDefsResult = {
      collections: [
        ...defs.collections,
        {
          id: 'theme',
          name: 'Theme',
          key: 'k',
          defaultModeId: 'light',
          modes: [
            { modeId: 'light', name: 'Light' },
            { modeId: 'dark', name: 'Dark' },
          ],
          variableIds: [],
        },
      ],
      variables: [
        ...defs.variables,
        {
          id: 'bg',
          name: 'bg/surface',
          key: 'k',
          resolvedType: 'COLOR',
          collectionId: 'theme',
          valuesByMode: {
            light: { r: 1, g: 1, b: 1, a: 1 },
            dark: { r: 0.039, g: 0.039, b: 0.039, a: 1 },
          },
        },
      ],
    };
    const themedDispatch: ToolDispatcher = async tool => {
      if (tool === GET_VARIABLE_DEFS_TOOL_NAME) return themedDefs;
      if (tool === GET_STYLES_TOOL_NAME) return emptyStyles;
      throw new Error(`unexpected dispatch: ${tool}`);
    };

    const result = await handleTokenMap(themedDispatch, { rootDir: dir });
    expect(result.themedCollections).toEqual([
      { name: 'Theme', modes: ['Light', 'Dark'], defaultMode: 'Light' },
    ]);
    const surface = result.mappings.find(m => m.figmaName === 'bg/surface');
    expect(surface?.figmaModes).toEqual({ Light: '#FFFFFF', Dark: '#0A0A0A' });
    // Single-mode variables in the same file stay mode-less.
    const primary = result.mappings.find(m => m.figmaName === 'Primary/500');
    expect(primary?.figmaModes).toBeUndefined();
    expect(primary?.status).toBe('high');
  });

  it('aggregates repo CSS custom properties when no single token config is detected (plain CSS vars)', async () => {
    // A non-Tailwind project whose design tokens are plain :root custom properties. There's no
    // single detected config, so the join falls back to aggregating the repo's CSS — Primary/500
    // should still map to var(--primary-500) via name + value.
    const cssVars = await mkdtemp(join(tmpdir(), 'tokenmap-cssvars-'));
    try {
      await writeFile(
        join(cssVars, 'package.json'),
        JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      );
      await mkdir(join(cssVars, 'src'), { recursive: true });
      await writeFile(
        join(cssVars, 'src', 'theme.css'),
        ':root {\n  --primary-500: #6266F0;\n  --header-height: 64px;\n}\n',
      );
      const result = await handleTokenMap(dispatch, { rootDir: cssVars });

      expect(result.tokenSource).toBeNull(); // no single source — aggregated
      expect(result.note).toMatch(/aggregated/i);
      expect(result.projectTokenCount).toBe(2);

      const primary = result.mappings.find(m => m.figmaName === 'Primary/500');
      expect(primary?.candidate?.ref).toBe('var(--primary-500)'); // plain var, no Tailwind utility
      expect(primary?.status).toBe('high');
      // The incidental --header-height never surfaces — nothing on the Figma side matches it.
      expect(result.unmapped).toContain('Accent/Teal');
    } finally {
      await rm(cssVars, { recursive: true, force: true });
    }
  });

  it('returns a note (and no source) when only a Tailwind v3 JS config is present', async () => {
    const v3 = await mkdtemp(join(tmpdir(), 'tokenmap-v3-'));
    await writeFile(
      join(v3, 'package.json'),
      JSON.stringify({ devDependencies: { tailwindcss: '^3.4.0' } }),
    );
    await writeFile(join(v3, 'tailwind.config.js'), 'module.exports = {};');
    const result = await handleTokenMap(dispatch, { rootDir: v3 });
    expect(result.tokenSource).toBeNull();
    expect(result.note).toMatch(/v3/i);
    await rm(v3, { recursive: true, force: true });
  });

  it('joins a pre-variables file (zero variables) via its shared paint styles', async () => {
    // The 寶島 class of document: the palette lives in paint styles, get_variable_defs is empty.
    // Without the style source the whole join came back empty on exactly these files.
    const noVars: GetVariableDefsResult = { collections: [], variables: [] };
    const styles: GetStylesResult = {
      ...emptyStyles,
      paints: [
        {
          id: 'S:1',
          name: 'Primary/500',
          key: 'k1',
          description: '',
          paints: [
            { type: 'SOLID', visible: true, opacity: 1, color: { r: 0.384, g: 0.4, b: 0.941 } },
          ],
        },
        {
          id: 'S:2',
          name: 'Hero/Gradient',
          key: 'k2',
          description: '',
          paints: [
            {
              type: 'GRADIENT_LINEAR',
              visible: true,
              opacity: 1,
              gradientStops: [],
              gradientTransform: [
                [1, 0, 0],
                [0, 1, 0],
              ],
            },
          ],
        },
      ],
    };
    const styleDispatch: ToolDispatcher = async tool => {
      if (tool === GET_VARIABLE_DEFS_TOOL_NAME) return noVars;
      if (tool === GET_STYLES_TOOL_NAME) return styles;
      throw new Error(`unexpected dispatch: ${tool}`);
    };

    const result = await handleTokenMap(styleDispatch, { rootDir: dir });
    const primary = result.mappings.find(m => m.figmaName === 'Primary/500');
    expect(primary?.source).toBe('style');
    expect(primary?.candidate?.ref).toBe('primary-500');
    expect(primary?.status).toBe('high');
    // The gradient style is a look, not a token — it must not join or pollute unmapped.
    expect(result.mappings.some(m => m.figmaName === 'Hero/Gradient')).toBe(false);
  });

  it('keeps variable rows source-less when both variables and styles exist', async () => {
    const styles: GetStylesResult = {
      ...emptyStyles,
      paints: [
        {
          id: 'S:1',
          name: 'Primary/500',
          key: 'k1',
          description: '',
          paints: [
            { type: 'SOLID', visible: true, opacity: 1, color: { r: 0.384, g: 0.4, b: 0.941 } },
          ],
        },
      ],
    };
    const bothDispatch: ToolDispatcher = async tool => {
      if (tool === GET_VARIABLE_DEFS_TOOL_NAME) return defs;
      if (tool === GET_STYLES_TOOL_NAME) return styles;
      throw new Error(`unexpected dispatch: ${tool}`);
    };

    const result = await handleTokenMap(bothDispatch, { rootDir: dir });
    const rows = result.mappings.filter(m => m.figmaName === 'Primary/500');
    // Variable first (source-less), style row after — both map, neither shadows the other.
    expect(rows).toHaveLength(2);
    expect(rows[0]?.source).toBeUndefined();
    expect(rows[1]?.source).toBe('style');
  });

  it('degrades to the variables-only join when get_styles fails (styles are additive)', async () => {
    const failingStyles: ToolDispatcher = async tool => {
      if (tool === GET_VARIABLE_DEFS_TOOL_NAME) return defs;
      if (tool === GET_STYLES_TOOL_NAME) throw new Error('styles timed out');
      throw new Error(`unexpected dispatch: ${tool}`);
    };
    const result = await handleTokenMap(failingStyles, { rootDir: dir });
    // Exactly the pre-styles behaviour: the variable join succeeds untouched.
    expect(result.mappings.find(m => m.figmaName === 'Primary/500')?.status).toBe('high');
    expect(result.mappings.every(m => m.source === undefined)).toBe(true);
  });

  describe('map-file overrides (docs/figma-token-map.md)', () => {
    let odir: string;
    beforeAll(async () => {
      odir = await mkdtemp(join(tmpdir(), 'tokenmap-ovr-'));
      await writeFile(
        join(odir, 'package.json'),
        JSON.stringify({
          devDependencies: { tailwindcss: '^4.0.0', '@tailwindcss/vite': '^4.0.0' },
        }),
      );
      await mkdir(join(odir, 'src'), { recursive: true });
      await writeFile(
        join(odir, 'src', 'app.css'),
        '@import "tailwindcss";\n@theme {\n  --color-primary-500: #6266F0;\n}\n',
      );
      await mkdir(join(odir, 'docs'), { recursive: true });
    });
    afterAll(async () => {
      await rm(odir, { recursive: true, force: true });
    });

    it('lets a docs/figma-token-map.md row override an unmapped token as map-file', async () => {
      // Accent/Teal has no project token of its own; the recorded row points it at an existing one.
      await writeFile(
        join(odir, 'docs', 'figma-token-map.md'),
        '| Figma | Token |\n| --- | --- |\n| Accent/Teal | primary-500 |\n',
      );
      const result = await handleTokenMap(dispatch, { rootDir: odir });
      const teal = result.mappings.find(m => m.figmaName === 'Accent/Teal');
      expect(teal?.candidate?.token).toBe('color-primary-500');
      expect(teal?.candidate?.matchedBy).toEqual(['map-file']);
      expect(teal?.status).toBe('high');
      expect(result.unmapped).not.toContain('Accent/Teal');
      expect(result.staleOverrides).toBeUndefined();
    });

    it('reports a stale token override (ref gone) and degrades to the normal join', async () => {
      await writeFile(
        join(odir, 'docs', 'figma-token-map.md'),
        '| Accent/Teal | color-deleted-500 |\n',
      );
      const result = await handleTokenMap(dispatch, { rootDir: odir });
      const teal = result.mappings.find(m => m.figmaName === 'Accent/Teal');
      expect(teal?.candidate).toBeUndefined(); // ref didn't resolve → not honoured
      expect(teal?.status).toBe('unmapped'); // degraded (Accent/Teal has no real match)
      expect(result.staleOverrides).toEqual([
        { figmaName: 'Accent/Teal', ref: 'color-deleted-500' },
      ]);
    });
  });
});
