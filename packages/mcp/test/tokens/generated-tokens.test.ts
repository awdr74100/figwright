import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  detectTokenBuildTool,
  findGeneratedStylesheets,
} from '../../src/tokens/generated-tokens.js';

describe('detectTokenBuildTool', () => {
  it('recognises the pipelines that generate design tokens into a file', () => {
    expect(detectTokenBuildTool({ 'style-dictionary': '^5.5.1' })).toBe('Style Dictionary');
    // The Figma Tokens Studio → Style Dictionary bridge, squarely this server's audience.
    expect(detectTokenBuildTool({ '@tokens-studio/sd-transforms': '^1' })).toBe(
      'Tokens Studio + Style Dictionary',
    );
    expect(detectTokenBuildTool({ react: '^18' })).toBeNull();
    expect(detectTokenBuildTool({})).toBeNull();
  });
});

describe('findGeneratedStylesheets', () => {
  it('finds a stylesheet nested anywhere under an output directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gen-deep-'));
    try {
      await mkdir(join(dir, 'dist', 'a', 'b', 'c'), { recursive: true });
      await writeFile(join(dir, 'dist', 'a', 'b', 'c', 'buried.css'), ':root{--a:1px}');
      expect(await findGeneratedStylesheets(dir)).toEqual(['dist/a/b/c/buried.css']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('never reaches a root-level node_modules', async () => {
    // The load-bearing property: this crawls `<root>/build|dist|out`, never `<root>` itself, so the
    // dependency tree is not on any path it can take. A change that walked the root instead would
    // put a five-figure file count on a request path.
    const dir = await mkdtemp(join(tmpdir(), 'gen-nm-'));
    try {
      await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
      await writeFile(join(dir, 'node_modules', 'pkg', 'vendor.css'), ':root{--v:1px}');
      await mkdir(join(dir, 'build'), { recursive: true });
      await writeFile(join(dir, 'build', 'variables.css'), ':root{--a:1px}');

      expect(await findGeneratedStylesheets(dir)).toEqual(['build/variables.css']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not descend a node_modules nested inside an output directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gen-nested-nm-'));
    try {
      await mkdir(join(dir, 'out', 'node_modules', 'evil'), { recursive: true });
      await writeFile(join(dir, 'out', 'node_modules', 'evil', 'a.css'), ':root{--e:1px}');
      expect(await findGeneratedStylesheets(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('caps how many it names, shortest path first', async () => {
    // The caller picks one, so an exhaustive list helps nobody — and the shallowest paths are the
    // likeliest entry points rather than a chunk of a bundle.
    const dir = await mkdtemp(join(tmpdir(), 'gen-cap-'));
    try {
      await mkdir(join(dir, 'build', 'nested', 'deeper'), { recursive: true });
      await writeFile(join(dir, 'build', 'a.css'), 'x');
      for (let i = 0; i < 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- fixture setup, order irrelevant
        await writeFile(join(dir, 'build', 'nested', 'deeper', `chunk-${i}.css`), 'x');
      }
      const found = await findGeneratedStylesheets(dir);
      expect(found).toHaveLength(8);
      expect(found[0]).toBe('build/a.css');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('names the same stylesheets on every run over a dist/ above the crawl cap', async () => {
    // CRAWL_CAP is 400. Locks the property the doc claims, rather than reproducing a failure: the
    // old truncation was a race by construction, but it never actually returned two answers here
    // (see the note on findGeneratedStylesheets for why), so this is a guard against a future
    // regression, not a red test that went green.
    const dir = await mkdtemp(join(tmpdir(), 'gen-race-'));
    try {
      // One short-named winner per directory, buried under long-named chunks: the eight names this
      // returns therefore have to come from eight *different* directories, which an arbitrary
      // truncation across forty of them will not reliably reach.
      await Promise.all(
        Array.from({ length: 40 }, async (_unused, d) => {
          const sub = join(dir, 'dist', `g${String(d).padStart(2, '0')}`);
          await mkdir(sub, { recursive: true });
          await writeFile(join(sub, 'a.css'), 'x');
          await Promise.all(
            Array.from({ length: 30 }, (_chunk, i) =>
              writeFile(join(sub, `chunk-with-a-long-name-${String(i).padStart(3, '0')}.css`), 'x'),
            ),
          );
        }),
      );
      const runs: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- separate crawls on purpose
        runs.push((await findGeneratedStylesheets(dir)).join('\n'));
      }
      expect(new Set(runs).size).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns nothing rather than throwing when no output directory exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gen-none-'));
    try {
      await expect(findGeneratedStylesheets(dir)).resolves.toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
