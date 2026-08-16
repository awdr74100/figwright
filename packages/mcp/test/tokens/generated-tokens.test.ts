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

  it('returns nothing rather than throwing when no output directory exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gen-none-'));
    try {
      await expect(findGeneratedStylesheets(dir)).resolves.toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
