import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { walkRepoFiles } from '../src/repo-walk.js';

let dir: string;
const make = async (files: Record<string, string>): Promise<string> => {
  dir = await mkdtemp(join(tmpdir(), 'walk-test-'));
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(join(dir, rel, '..'), { recursive: true });
    await writeFile(join(dir, rel), body);
  }
  return dir;
};
const collect = async (
  root: string,
  opts?: Parameters<typeof walkRepoFiles>[1],
): Promise<string[]> => {
  const out: string[] = [];
  for await (const rel of walkRepoFiles(root, opts)) out.push(rel);
  return out.toSorted();
};

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('walkRepoFiles', () => {
  it('prunes baseline dirs (node_modules/vendor) even with no .gitignore', async () => {
    const root = await make({
      'src/Button.tsx': 'x',
      'node_modules/pkg/A.tsx': 'x',
      'vendor/pkg/B.tsx': 'x',
    });
    expect(await collect(root, { extensions: ['.tsx'] })).toEqual(['src/Button.tsx']);
  });

  it('honors the project .gitignore (dir + glob rules) as a union on top of the baseline', async () => {
    const root = await make({
      '.gitignore': 'generated/\nstorybook-static/\n*.draft.tsx\n!Special.draft.tsx\n',
      'src/Card.tsx': 'x',
      'generated/Gen.tsx': 'x', // gitignored dir → skipped
      'storybook-static/Story.tsx': 'x', // gitignored dir → skipped
      'src/A.draft.tsx': 'x', // glob-ignored → skipped
      'src/Special.draft.tsx': 'x', // negation re-includes (parent not dir-excluded)
    });
    expect(await collect(root, { extensions: ['.tsx'] })).toEqual([
      'src/Card.tsx',
      'src/Special.draft.tsx',
    ]);
  });

  it('walks a non-baseline dir when there is no .gitignore (degrades to baseline-only)', async () => {
    const root = await make({ 'src/A.tsx': 'x', 'generated/B.tsx': 'x' });
    // No .gitignore → "generated" isn't baseline → it IS walked (matches pre-gitignore behavior).
    expect(await collect(root, { extensions: ['.tsx'] })).toEqual(['generated/B.tsx', 'src/A.tsx']);
  });

  it('caps the number of yielded files', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) files[`src/F${i}.tsx`] = 'x';
    const root = await make(files);
    expect((await collect(root, { extensions: ['.tsx'], cap: 3 })).length).toBe(3);
  });

  it('filters by extension, or yields everything when none given', async () => {
    const root = await make({ 'a.tsx': 'x', 'b.css': 'x', 'c.md': 'x' });
    expect(await collect(root, { extensions: ['.css'] })).toEqual(['b.css']);
    expect((await collect(root)).length).toBe(3);
  });
});
