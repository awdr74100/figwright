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

  it(
    "carries the walk's omitted count so a capped pool cannot read as a complete one",
    // Staging enough files to breach the cap is the test, so the cost is not removable — and 260
    // creates, a full walk and a recursive rm run past vitest's 5s default on a Windows runner,
    // where each of those is a syscall an order of magnitude dearer than on the other two. Same
    // hazard and same remedy as the fixtures in #220; this one and its sibling in `load.test.ts`
    // were the pair that release left behind.
    { timeout: 30_000 },
    async () => {
      // MAX_CSS_FILES is 200. A pool that silently drops the rest looks exactly like a project that
      // declares fewer tokens, which is the reading this count exists to prevent.
      const big = await mkdtemp(join(tmpdir(), 'repocss-cap-'));
      try {
        await mkdir(join(big, 'src'), { recursive: true });
        await Promise.all(
          Array.from({ length: 260 }, (_, i) =>
            writeFile(join(big, 'src', `f${String(i).padStart(3, '0')}.css`), `:root{--c${i}:red}`),
          ),
        );
        const { files, omitted } = await aggregateRepoCssTokens(big);
        expect(files.length).toBe(200);
        expect(omitted).toBe(60);
      } finally {
        await rm(big, { recursive: true, force: true });
      }
    },
  );

  it('reports nothing omitted when the whole repo fits under the cap', async () => {
    expect((await aggregateRepoCssTokens(dir)).omitted).toBe(0);
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
