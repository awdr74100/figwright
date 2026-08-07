import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleAnalyzeProject } from '../../src/tools/analyze-project.js';
import { handleScanComponents } from '../../src/tools/scan-components.js';

// The two server-local tools had no coverage of their own. `profile.test.ts` and `scan.test.ts`
// exercise the detection and the AST walk thoroughly; what was untested is the thin layer these
// handlers add on top — argument validation, and the defaulting that wires the two modules
// together. That layer is small but it is the part a caller actually reaches.

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'figwright-local-tools-'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: { vue: '^3.5.0' } }),
    'utf8',
  );
  await mkdir(join(root, 'src'), { recursive: true });
  // A Vue component, which the detected profile's extensions will pick up…
  await writeFile(
    join(root, 'src', 'BaseButton.vue'),
    '<script setup>defineProps({ label: String })</script>\n<template><button>{{ label }}</button></template>\n',
    'utf8',
  );
  // …and a React one, which they will not — the difference is what makes the defaulting observable.
  await writeFile(
    join(root, 'src', 'Card.tsx'),
    'export function Card({ title }: { title: string }) {\n  return <div>{title}</div>;\n}\n',
    'utf8',
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('handleAnalyzeProject', () => {
  it('analyzes the directory it is given', async () => {
    const profile = await handleAnalyzeProject({ rootDir: root });
    expect(profile.rootDir).toBe(root);
    expect(profile.framework).toBe('vue');
  });

  it('falls back to the server cwd when rootDir is omitted', async () => {
    // The documented default, and the one every caller that omits the argument depends on.
    const profile = await handleAnalyzeProject({});
    expect(profile.rootDir).toBe(process.cwd());
  });

  it('requires an argument object, which is what its only caller passes', async () => {
    // registerTool hands the handler `{}` for a no-argument call, so an absent object never arrives
    // through MCP. Pinning the strictness rather than papering over it with `?? {}`: a future
    // internal caller that forgets the argument should fail loudly here, not silently analyze the
    // server's cwd instead of the directory it meant.
    await expect(handleAnalyzeProject({})).resolves.toMatchObject({ rootDir: process.cwd() });
    await expect(handleAnalyzeProject(undefined)).rejects.toThrow(/expected object/);
  });

  it('rejects a rootDir of the wrong type rather than coercing it', async () => {
    // Asserting the *reason*, not just that something threw. Without the schema, a numeric rootDir
    // still blows up somewhere downstream in a path call — so a bare `toThrow()` passes even with
    // validation deleted, which is exactly the mutation this has to catch.
    await expect(handleAnalyzeProject({ rootDir: 42 })).rejects.toThrow(/rootDir/);
  });
});

describe('handleScanComponents', () => {
  it('returns the scanned components alongside the profile they were scanned with', async () => {
    const { components, profile } = await handleScanComponents({ rootDir: root });
    expect(profile.framework).toBe('vue');
    expect(components.map(c => c.name)).toContain('BaseButton');
  });

  it("defaults the extensions to the detected profile's", async () => {
    // The wiring between the two modules: no `extensions` means scan whatever the profile says this
    // project's components are. A Vue project therefore does not pick up the .tsx file sitting next
    // to the .vue one — which is the whole point of detecting the profile first.
    const { components, profile } = await handleScanComponents({ rootDir: root });
    expect(profile.componentExtensions).toContain('.vue');
    expect(components.map(c => c.name)).not.toContain('Card');
  });

  it('honours an explicit extensions list over the detected default', async () => {
    const { components } = await handleScanComponents({ rootDir: root, extensions: ['.tsx'] });
    expect(components.map(c => c.name)).toEqual(['Card']);
  });

  it('rejects an extensions value that is not an array of strings', async () => {
    // Named-field rejections, so deleting the schema fails these rather than letting some later
    // path or fs call throw for an unrelated reason and look like the same pass.
    await expect(handleScanComponents({ rootDir: root, extensions: '.tsx' })).rejects.toThrow(
      /extensions/,
    );
    await expect(handleScanComponents({ rootDir: root, extensions: [1] })).rejects.toThrow(
      /extensions/,
    );
  });

  it('rejects a rootDir of the wrong type', async () => {
    await expect(handleScanComponents({ rootDir: ['/tmp'] })).rejects.toThrow(/rootDir/);
  });
});
