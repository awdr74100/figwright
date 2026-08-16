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

  it('skips dotfiles and never descends dot-directories (parity with the prior node:fs glob)', async () => {
    const root = await make({
      'src/Keep.tsx': 'x',
      '.hidden.tsx': 'x', // root dotfile → skipped
      'src/.secret.tsx': 'x', // nested dotfile → skipped
      '.storybook/Preview.tsx': 'x', // non-baseline dot-dir → not descended
      'sub/.dot/Deep.tsx': 'x', // nested dot-dir → not descended
    });
    expect(await collect(root, { extensions: ['.tsx'] })).toEqual(['src/Keep.tsx']);
  });

  it('yields only files, never directory entries', async () => {
    const root = await make({ 'src/a.tsx': 'x', 'src/nested/b.css': 'x' });
    // No extension filter → every file, but never the "src" / "src/nested" directories themselves.
    expect(await collect(root)).toEqual(['src/a.tsx', 'src/nested/b.css']);
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

// The existing helper above sorts, which is why none of those tests could see the order the walk
// actually produced. These use the raw sequence.
const rawCollect = async (
  root: string,
  opts?: Parameters<typeof walkRepoFiles>[1],
): Promise<string[]> => {
  const out: string[] = [];
  for await (const rel of walkRepoFiles(root, opts)) out.push(rel);
  return out;
};

describe('walkRepoFiles ordering', () => {
  it('returns the same sequence on every run over an unchanged repo', async () => {
    // fdir crawls concurrently, so without an explicit order the same repo yields the same *set* in
    // a different sequence each time — measured on Bulma, where consecutive runs disagreed on the
    // first three files. It reached the output: token_map's note sampled different files each call,
    // and where several files declare one token name the `from` handed back changed run to run.
    const files: Record<string, string> = {};
    for (let i = 0; i < 60; i += 1) {
      files[`pkg${i}/a.css`] = 'x';
      files[`pkg${i}/nested/b.css`] = 'x';
    }
    const root = await make(files);
    const runs: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- separate crawls on purpose
      runs.push((await rawCollect(root, { extensions: ['.css'] })).join('\n'));
    }
    expect(new Set(runs).size).toBe(1);
  });

  it('orders shallowest first, then by code unit', async () => {
    // Depth leads as a tie-break preference for the one caller that takes the *first* match rather
    // than aggregating (findTailwindCssEntry): a Tailwind v4 entry is conventionally shallow, and
    // plain a-z would rank `src/a/b/deep.css` above `src/index.css`.
    const root = await make({
      'src/a/b/deep.css': 'x',
      'src/index.css': 'x',
      'zz/later.css': 'x',
      'root.css': 'x',
    });
    expect(await rawCollect(root, { extensions: ['.css'] })).toEqual([
      'root.css',
      'src/index.css',
      'zz/later.css',
      'src/a/b/deep.css',
    ]);
  });

  it('orders by code unit rather than locale collation', async () => {
    // localeCompare is environment-dependent, which is the property this ordering exists to remove.
    // These are names an ICU collation orders differently from their code units: it folds case
    // (`a` before `B`) and treats `ä` as a variant of `a` (before `z`), while the code units run
    // B (0x42) < a (0x61) < z (0x7A) < ä (0xE4). Deliberately no case-only pair — a
    // case-insensitive filesystem would collapse the two into one file.
    const root = await make({ 'a.css': 'x', 'B.css': 'x', 'z.css': 'x', 'ä.css': 'x' });
    expect(await rawCollect(root, { extensions: ['.css'] })).toEqual([
      'B.css',
      'a.css',
      'z.css',
      'ä.css',
    ]);
  });
});
