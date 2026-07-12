import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GetDesignContextResult } from '@figwright/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleDesignDiff, type ToolDispatcher } from '../../src/tools/design-diff.js';
import { GET_DESIGN_CONTEXT_TOOL_NAME } from '../../src/tools/get-design-context.js';

const SNAP_REL = join('.figwright', 'snapshots', '1-1.json');

const ctx = (over: Partial<GetDesignContextResult> = {}): GetDesignContextResult => ({
  nodes: [
    {
      id: '1:1',
      name: 'Card',
      type: 'FRAME',
      children: [{ id: '1:2', name: 'Title', type: 'TEXT', characters: 'Hello' }],
    },
  ],
  metrics: {
    nodeCount: 2,
    maxDepth: 1,
    styleCount: 0,
    tokenCount: 0,
    inlineSizeKb: 1,
    dedupedSizeKb: 1,
  },
  ...over,
});

describe('handleDesignDiff', () => {
  let dir: string;
  let currentCtx: GetDesignContextResult;

  // dispatch stub: design_diff's only round-trip is get_design_context; return the mutable currentCtx.
  const dispatch: ToolDispatcher = async (tool, args) => {
    if (tool !== GET_DESIGN_CONTEXT_TOOL_NAME) throw new Error(`unexpected dispatch: ${tool}`);
    // The tool must always ask for full detail + dedupe (the codegen-equivalent baseline view) and
    // must NOT arm the public-path budget guard: a snapshot needs the raw tree, never a section
    // plan, no matter how large the node is.
    expect(args).toMatchObject({ detail: 'full', dedupeComponents: true });
    expect(args).not.toHaveProperty('budget');
    return currentCtx;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'designdiff-'));
    currentCtx = ctx();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a baseline on the first call and reports baseline-created', async () => {
    const r = await handleDesignDiff(dispatch, { nodeId: '1:1', rootDir: dir });
    expect(r.status).toBe('baseline-created');
    expect(r.nodeId).toBe('1:1');
    expect(r.snapshotPath).toBe(SNAP_REL);
    expect(r.summary).toBeUndefined();

    // The file exists, is format-tagged, and stores the raw context.
    const saved = JSON.parse(await readFile(join(dir, SNAP_REL), 'utf8'));
    expect(saved.figwrightSnapshot).toBe(2);
    expect(saved.nodeId).toBe('1:1');
    expect(saved.context.nodes[0].id).toBe('1:1');
  });

  it('reports no-changes when the design is unchanged since the baseline', async () => {
    await handleDesignDiff(dispatch, { nodeId: '1:1', rootDir: dir });
    const r = await handleDesignDiff(dispatch, { nodeId: '1:1', rootDir: dir });
    expect(r.status).toBe('no-changes');
    expect(r.summary).toEqual({ added: 0, removed: 0, changed: 0 });
    expect(r.baselineCapturedAt).toBeDefined();
  });

  it('reports a real per-property change against the baseline', async () => {
    await handleDesignDiff(dispatch, { nodeId: '1:1', rootDir: dir });
    // The title text changes.
    currentCtx = ctx();
    (currentCtx.nodes[0]!.children![0] as { characters: string }).characters = 'Updated';
    const r = await handleDesignDiff(dispatch, { nodeId: '1:1', rootDir: dir });
    expect(r.status).toBe('diff');
    expect(r.summary).toEqual({ added: 0, removed: 0, changed: 1 });
    const chars = r.changes!.changed[0]!.fields!.find(f => f.field === 'characters')!;
    expect(chars.before).toBe('Hello');
    expect(chars.after).toBe('Updated');
  });

  it('does not rewrite the baseline on a plain diff, but does with update:true', async () => {
    await handleDesignDiff(dispatch, { nodeId: '1:1', rootDir: dir });
    currentCtx = ctx();
    (currentCtx.nodes[0]!.children![0] as { characters: string }).characters = 'Updated';

    // Plain diff: baseline untouched, so a second plain diff still reports the same change.
    const plain = await handleDesignDiff(dispatch, { nodeId: '1:1', rootDir: dir });
    expect(plain.baselineUpdated).toBeUndefined();
    expect(plain.summary!.changed).toBe(1);

    // update:true accepts the current design as the new baseline...
    const accepted = await handleDesignDiff(dispatch, {
      nodeId: '1:1',
      rootDir: dir,
      update: true,
    });
    expect(accepted.baselineUpdated).toBe(true);
    // ...so the next diff (still the "Updated" design) is clean.
    const after = await handleDesignDiff(dispatch, { nodeId: '1:1', rootDir: dir });
    expect(after.status).toBe('no-changes');
  });

  it('re-baselines (never mis-diffs) when the on-disk format version is stale', async () => {
    await mkdir(join(dir, '.figwright', 'snapshots'), { recursive: true });
    await writeFile(
      join(dir, SNAP_REL),
      JSON.stringify({ figwrightSnapshot: 999, nodeId: '1:1', capturedAt: 'x', context: ctx() }),
    );
    const r = await handleDesignDiff(dispatch, { nodeId: '1:1', rootDir: dir });
    expect(r.status).toBe('baseline-created');
    const saved = JSON.parse(await readFile(join(dir, SNAP_REL), 'utf8'));
    expect(saved.figwrightSnapshot).toBe(2); // rewritten to the current format
  });

  it('warns (but still diffs) when the baseline root looks like a different node', async () => {
    await handleDesignDiff(dispatch, { nodeId: '1:1', rootDir: dir });
    // Same id, but the root was renamed/replaced (different name + type).
    currentCtx = ctx({
      nodes: [{ id: '1:1', name: 'Sidebar', type: 'COMPONENT', children: [] }],
    });
    const r = await handleDesignDiff(dispatch, { nodeId: '1:1', rootDir: dir });
    expect(r.status).toBe('diff');
    expect(r.note).toMatch(/different node or a renamed root/i);
  });

  it('keys the baseline by the resolved root when nodeId is omitted (selection)', async () => {
    const r = await handleDesignDiff(dispatch, { rootDir: dir });
    expect(r.nodeId).toBe('1:1');
    expect(r.snapshotPath).toBe(SNAP_REL);
  });
});
