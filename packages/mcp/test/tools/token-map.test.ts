import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GetVariableDefsResult } from '@figwright/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

const dispatch: ToolDispatcher = async tool => {
  if (tool === GET_VARIABLE_DEFS_TOOL_NAME) return defs;
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
    expect(result.profile.styling.tailwindVersion).toBe(4);
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
});
