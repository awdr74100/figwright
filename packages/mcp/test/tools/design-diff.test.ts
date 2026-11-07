import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GetDesignContextResult } from '@figwright/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  handleDesignDiff,
  SNAPSHOT_FORMAT_VERSION,
  type ToolDispatcher,
} from '../../src/tools/design-diff.js';
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
    expect(saved.figwrightSnapshot).toBe(SNAPSHOT_FORMAT_VERSION);
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
    expect(saved.figwrightSnapshot).toBe(SNAPSHOT_FORMAT_VERSION); // rewritten to the current format
  });

  describe('a baseline saved by an older release', () => {
    const withStyles = (
      styleIds: Record<string, string>,
      {
        title = 'Hello',
        styles,
      }: { title?: string; styles?: GetDesignContextResult['styles'] } = {},
    ): GetDesignContextResult =>
      ctx({
        nodes: [
          {
            id: '1:1',
            name: 'Card',
            type: 'FRAME',
            styleIds,
            children: [{ id: '1:2', name: 'Title', type: 'TEXT', characters: title }],
          },
        ],
        ...(styles === undefined ? {} : { styles }),
      });
    const writeAt = async (version: number, context: GetDesignContextResult) => {
      await mkdir(join(dir, '.figwright', 'snapshots'), { recursive: true });
      await writeFile(
        join(dir, SNAP_REL),
        JSON.stringify({
          figwrightSnapshot: version,
          nodeId: '1:1',
          capturedAt: `v${version}`,
          context,
        }),
      );
    };
    const diff = () => handleDesignDiff(dispatch, { nodeId: '1:1', rootDir: dir });
    const changedFields = (r: Awaited<ReturnType<typeof diff>>) =>
      r.changes?.changed.flatMap(c => c.fields?.map(x => [x.field, x.after]) ?? []);

    // Re-baselining one would overwrite the saved baseline and lose every change made since.
    it('v9 is still diffed, and a grid style it could not hold is no change', async () => {
      await writeAt(9, ctx());
      currentCtx = withStyles({ grid: 'S:grid,' });
      const r = await diff();
      expect(r.status).toBe('no-changes');
      expect(r.baselineCapturedAt).toBe('v9');
    });

    // Up to v10 a local style id was saved without its trailing comma, and never named — on a node
    // and on each run of a mixed text alike.
    const withRun = (context: GetDesignContextResult, textStyleId: string) => {
      const title = context.nodes[0]!.children![0] as { segments?: unknown };
      title.segments = [{ characters: 'Hello', styleIds: { text: textStyleId } }];
      return context;
    };
    it.each([9, 10])(
      'v%i sees a local style id gain its comma and its name as no change',
      async version => {
        await writeAt(
          version,
          withRun(
            withStyles(
              { fill: 'S:a', text: 'S:lib,1:2' },
              {
                styles: { 'S:lib,1:2': { name: 'Body', type: 'TEXT' } },
              },
            ),
            'S:t',
          ),
        );
        currentCtx = withRun(
          withStyles(
            { fill: 'S:a,', text: 'S:lib,1:2' },
            {
              styles: {
                'S:a,': { name: 'Brand/A', type: 'PAINT' },
                'S:lib,1:2': { name: 'Body', type: 'TEXT' },
                'S:t,': { name: 'Body/Bold', type: 'TEXT' },
              },
            },
          ),
          'S:t,',
        );
        expect((await diff()).status).toBe('no-changes');
      },
    );

    // The server ships ahead of the plugin, so a baseline in the current format can still have been
    // captured through a plugin that cut the ids — once that plugin updates, nothing has changed.
    it.each([
      ['a node', 'S:a', 'S:lib,9:9'],
      ['only a run of a mixed text', 'S:lib,1:2', 'S:t'],
    ])(
      'a current baseline captured through an older plugin, a cut id on %s, sees the same',
      async (_where, fill, run) => {
        const named = (id: string) => (id.includes(',') ? id : `${id},`);
        const tokens = {
          [named(fill)]: { name: 'Brand/A', type: 'PAINT' },
          [named(run)]: { name: 'Body/Bold', type: 'TEXT' },
        };
        // A library style resolved before too, so the old baseline names it; a cut one it could not.
        const libraryOnly = Object.fromEntries(
          Object.entries(tokens).filter(([id]) => !id.endsWith(',')),
        );
        await writeAt(
          SNAPSHOT_FORMAT_VERSION,
          withRun(withStyles({ fill }, { styles: libraryOnly }), run),
        );
        currentCtx = withRun(withStyles({ fill: named(fill) }, { styles: tokens }), named(run));
        expect((await diff()).status).toBe('no-changes');
      },
    );

    it('v9 reports every other change, other style slots included', async () => {
      await writeAt(9, withStyles({ fill: 'S:a' }));
      currentCtx = withStyles({ fill: 'S:b,', grid: 'S:grid,' }, { title: 'Bye' });
      const r = await diff();
      expect(r.status).toBe('diff');
      expect(changedFields(r)).toEqual([
        ['styleIds', { fill: 'S:b' }],
        ['characters', 'Bye'],
      ]);
    });

    it('is replaced by a full capture on update:true, which then sees a grid style change', async () => {
      await writeAt(9, ctx());
      currentCtx = withStyles({ grid: 'S:grid,' });
      await handleDesignDiff(dispatch, { nodeId: '1:1', rootDir: dir, update: true });
      const saved = JSON.parse(await readFile(join(dir, SNAP_REL), 'utf8'));
      expect(saved.figwrightSnapshot).toBe(SNAPSHOT_FORMAT_VERSION);
      expect(saved.context.nodes[0].styleIds).toEqual({ grid: 'S:grid,' });

      currentCtx = withStyles({ grid: 'S:other,' });
      expect((await diff()).status).toBe('diff');
    });

    it('a current baseline names a swapped local style', async () => {
      await writeAt(
        SNAPSHOT_FORMAT_VERSION,
        withStyles(
          { fill: 'S:a,' },
          {
            styles: { 'S:a,': { name: 'Brand/A', type: 'PAINT' } },
          },
        ),
      );
      currentCtx = withStyles(
        { fill: 'S:b,' },
        {
          styles: { 'S:b,': { name: 'Brand/B', type: 'PAINT' } },
        },
      );
      const r = await diff();
      expect(r.changes?.changed[0]?.fields).toEqual([
        { field: 'styleIds', before: { fill: 'Brand/A' }, after: { fill: 'Brand/B' } },
      ]);
    });
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
