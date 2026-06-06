import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { aggregateRepoCssTokens } from '../../src/tokens/repo-css.js';

describe('aggregateRepoCssTokens', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'repocss-test-'));
    await mkdir(join(dir, 'src', 'styles'), { recursive: true });
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(
      join(dir, 'src', 'styles', 'tokens.css'),
      ':root {\n  --primary-500: #6266F0;\n  --spacing-md: 16px;\n}\n',
    );
    await writeFile(join(dir, 'src', 'reset.css'), '* { margin: 0; }\n'); // no custom props
    await writeFile(
      join(dir, 'node_modules', 'pkg', 'vendor.css'),
      ':root { --vendored: red; }', // must be ignored
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('pools custom properties across hand-authored CSS, skipping vendored dirs and prop-less files', async () => {
    const { tokens, files } = await aggregateRepoCssTokens(dir);
    const names = tokens.map(t => t.name).toSorted();
    expect(names).toEqual(['primary-500', 'spacing-md']);
    expect(files).toEqual(['src/styles/tokens.css']); // reset.css contributed nothing; vendor skipped
    expect(tokens.find(t => t.name === 'primary-500')?.value).toBe('#6266F0');
  });

  it('returns empty when the repo has no CSS custom properties', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'repocss-empty-'));
    try {
      const { tokens, files } = await aggregateRepoCssTokens(empty);
      expect(tokens).toEqual([]);
      expect(files).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
