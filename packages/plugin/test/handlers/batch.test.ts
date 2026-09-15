import { readFileSync } from 'node:fs';

import type { BatchResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import type { SandboxHandlers } from '../../src/dispatcher.js';
import { createAddComponentPropertyHandler } from '../../src/handlers/add-component-property.js';
import { createAddVariableModeHandler } from '../../src/handlers/add-variable-mode.js';
import { createApplyAnimationStyleHandler } from '../../src/handlers/apply-animation-style.js';
import { createApplyManualKeyframeTrackHandler } from '../../src/handlers/apply-manual-keyframe-track.js';
import { createBatchRenameNodesHandler } from '../../src/handlers/batch-rename-nodes.js';
import { SEGMENT_FIELDS, TEXT_RESTORED_FIELDS } from '../../src/handlers/batch-snapshot.js';
import { createBatchHandler } from '../../src/handlers/batch.js';
import { createBindVariableToNodeHandler } from '../../src/handlers/bind-variable-to-node.js';
import { createCombineAsVariantsHandler } from '../../src/handlers/combine-as-variants.js';
import { createCreateComponentHandler } from '../../src/handlers/create-component.js';
import { createCreateFrameHandler } from '../../src/handlers/create-frame.js';
import { createCreatePaintStyleHandler } from '../../src/handlers/create-paint-style.js';
import { createDeleteNodesHandler } from '../../src/handlers/delete-nodes.js';
import { createEditComponentPropertyHandler } from '../../src/handlers/edit-component-property.js';
import { createGroupNodesHandler } from '../../src/handlers/group-nodes.js';
import { createMoveNodesHandler } from '../../src/handlers/move-nodes.js';
import { createNavigateToPageHandler } from '../../src/handlers/navigate-to-page.js';
import { createRemoveReactionsHandler } from '../../src/handlers/remove-reactions.js';
import { createRenameNodeHandler } from '../../src/handlers/rename-node.js';
import { createRenameVariableHandler } from '../../src/handlers/rename-variable.js';
import { createReorderNodesHandler } from '../../src/handlers/reorder-nodes.js';
import { createReparentNodesHandler } from '../../src/handlers/reparent-nodes.js';
import { createSetAutoLayoutHandler } from '../../src/handlers/set-auto-layout.js';
import { createSetCornerRadiusHandler } from '../../src/handlers/set-corner-radius.js';
import { createSetFillsHandler } from '../../src/handlers/set-fills.js';
import { createSetInstancePropertiesHandler } from '../../src/handlers/set-instance-properties.js';
import { createSetOpacityHandler } from '../../src/handlers/set-opacity.js';
import { createSetPositionHandler } from '../../src/handlers/set-position.js';
import { createSetReactionsHandler } from '../../src/handlers/set-reactions.js';
import { createSetStrokesHandler } from '../../src/handlers/set-strokes.js';
import { createSetTextPropertiesHandler } from '../../src/handlers/set-text-properties.js';
import { createSetTextHandler } from '../../src/handlers/set-text.js';
import { createSetTimelineDurationHandler } from '../../src/handlers/set-timeline-duration.js';
import { createSetVariableCodeSyntaxHandler } from '../../src/handlers/set-variable-code-syntax.js';
import { createSetVariableValueHandler } from '../../src/handlers/set-variable-value.js';
import { createSwapComponentHandler } from '../../src/handlers/swap-component.js';
import { createUpdatePaintStyleHandler } from '../../src/handlers/update-paint-style.js';
import { createUpdateTextStyleHandler } from '../../src/handlers/update-text-style.js';
import { createIdempotencyCache, idempotent } from '../../src/idempotency.js';

/** A mutable node store backing a fake figma whose getNodeByIdAsync / createFrame share one map. */
const MIXED = Symbol('mixed');

const makeFigma = (initial: Record<string, Record<string, unknown>>) => {
  const store = new Map<string, Record<string, unknown>>(Object.entries(initial));
  let seq = 100;
  const currentPage = { appendChild: vi.fn<(n: unknown) => void>() };
  const loadFontAsync = vi.fn<(font: unknown) => Promise<void>>(async () => {});
  const figmaCtx = {
    mixed: MIXED,
    currentPage,
    loadFontAsync,
    variables: { getVariableByIdAsync: async (id: string) => ({ id }) },
    getNodeByIdAsync: async (id: string) => store.get(id) ?? null,
    createFrame: () => {
      const id = `9:${(seq += 1)}`;
      const node: Record<string, unknown> = {
        id,
        name: 'Frame',
        type: 'FRAME',
        x: 0,
        y: 0,
        resize: vi.fn<(w: number, h: number) => void>(),
        remove: vi.fn<() => void>(() => {
          store.delete(id);
        }),
      };
      store.set(id, node);
      return node;
    },
  } as unknown as typeof figma;
  return { figmaCtx, store, loadFontAsync };
};

const realWrites = (figmaCtx: typeof figma): SandboxHandlers => ({
  rename_node: createRenameNodeHandler(figmaCtx),
  set_opacity: createSetOpacityHandler(figmaCtx),
  set_fills: createSetFillsHandler(figmaCtx),
  set_strokes: createSetStrokesHandler(figmaCtx),
  set_corner_radius: createSetCornerRadiusHandler(figmaCtx),
  set_text_properties: createSetTextPropertiesHandler(figmaCtx),
  move_nodes: createMoveNodesHandler(figmaCtx),
  set_position: createSetPositionHandler(figmaCtx),
  reparent_nodes: createReparentNodesHandler(figmaCtx),
  create_frame: createCreateFrameHandler(figmaCtx),
  create_component: createCreateComponentHandler(figmaCtx),
  delete_nodes: createDeleteNodesHandler(figmaCtx),
});

const SOLID = (r: number): unknown => ({ type: 'SOLID', color: { r, g: 0, b: 0 } });

type Fn = (...args: never[]) => unknown;
type Run = Record<string, unknown>;

const RUN_DEFAULTS: Run = {
  fontName: { family: 'Inter', style: 'Regular' },
  fontSize: 12,
  textCase: 'ORIGINAL',
  textDecoration: 'NONE',
  textDecorationStyle: null,
  textDecorationOffset: null,
  textDecorationThickness: null,
  textDecorationColor: null,
  textDecorationSkipInk: null,
  lineHeight: { unit: 'AUTO' },
  letterSpacing: { unit: 'PIXELS', value: 0 },
  fills: [SOLID(0)],
  listOptions: { type: 'NONE' },
  listSpacing: 0,
  indentation: 0,
  paragraphIndent: 0,
  paragraphSpacing: 0,
  textWrapStyle: 'AUTO',
  hyperlink: null,
  textStyleId: '',
  fillStyleId: '',
  boundVariables: {},
  openTypeFeatures: {},
};

/** The run fields a text style supplies — a raw write to one detaches the run's style (measured). */
const TEXT_STYLED = new Set([
  'fontName',
  'fontSize',
  'textCase',
  'textDecoration',
  'lineHeight',
  'letterSpacing',
  'paragraphIndent',
  'paragraphSpacing',
]);
const NO_RAW_SETTER = new Set(['textStyleId', 'fillStyleId', 'boundVariables', 'openTypeFeatures']);
const capital = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

/**
 * A TEXT node that behaves like Figma's wherever the text inverse depends on it — each rule was
 * measured against a live file: rewriting `characters` gives every run the first run's style; a raw
 * run write detaches the run's text style (or fill style) and drops the binding on that field; a
 * node-level getter reads figma.mixed when the runs differ; resizing turns auto-resize off.
 */
const fakeText = (id: string, characters: string, base: Run = {}): Record<string, unknown> => {
  let chars = characters;
  let runs: Run[] = [...chars].map(() => Object.assign({}, RUN_DEFAULTS, base));
  const writeRun = (s: number, e: number, field: string, value: unknown): void => {
    for (let i = s; i < e; i += 1) {
      const run: Run = { ...runs[i]!, [field]: value };
      if (TEXT_STYLED.has(field)) run.textStyleId = '';
      if (field === 'fills') run.fillStyleId = '';
      const bound = { ...(run.boundVariables as Run) };
      delete bound[field];
      run.boundVariables = bound;
      runs[i] = run;
    }
  };
  const uniform = (field: string): unknown => {
    if (runs.length === 0) return { ...RUN_DEFAULTS, ...base }[field];
    const first = JSON.stringify(runs[0]![field]);
    return runs.every(r => JSON.stringify(r[field]) === first) ? runs[0]![field] : MIXED;
  };
  let nodeBound: Run = {};
  const node: Record<string, unknown> = {
    id,
    type: 'TEXT',
    parent: null,
    width: 100,
    height: 20,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    textTruncation: 'DISABLED',
    maxLines: null,
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    leadingTrim: 'NONE',
    hangingPunctuation: false,
    hangingList: false,
    getRangeAllFontNames: (s: number, e: number) => {
      const seen = new Map<string, unknown>();
      for (const r of runs.slice(s, e)) seen.set(JSON.stringify(r.fontName), r.fontName);
      return [...seen.values()];
    },
    getStyledTextSegments: (fields: string[]) => {
      const out: Run[] = [];
      runs.forEach((run, i) => {
        const pick = Object.fromEntries(fields.map(f => [f, run[f]]));
        const last = out.at(-1);
        if (
          last !== undefined &&
          JSON.stringify(fields.map(f => last[f])) === JSON.stringify(fields.map(f => pick[f]))
        ) {
          last.end = i + 1;
          last.characters = chars.slice(last.start as number, i + 1);
        } else {
          out.push({ characters: chars[i], start: i, end: i + 1, ...pick });
        }
      });
      return out;
    },
    resizeWithoutConstraints: (w: number, h: number) => {
      node.width = w;
      node.height = h;
      node.textAutoResize = 'NONE';
    },
    getRangeTextStyleId: (s: number, e: number) => {
      const ids = new Set(runs.slice(s, e).map(r => r.textStyleId));
      return ids.size === 1 ? [...ids][0] : MIXED;
    },
    getRangeFillStyleId: (s: number, e: number) => {
      const ids = new Set(runs.slice(s, e).map(r => r.fillStyleId));
      return ids.size === 1 ? [...ids][0] : MIXED;
    },
    setRangeTextStyleIdAsync: async (s: number, e: number, styleId: string) => {
      for (let i = s; i < e; i += 1) runs[i] = { ...runs[i]!, textStyleId: styleId };
    },
    setRangeFillStyleIdAsync: async (s: number, e: number, styleId: string) => {
      for (let i = s; i < e; i += 1) runs[i] = { ...runs[i]!, fillStyleId: styleId };
    },
    setRangeBoundVariable: (
      s: number,
      e: number,
      field: string,
      variable: { id: string } | null,
    ) => {
      for (let i = s; i < e; i += 1) {
        const bound = { ...(runs[i]!.boundVariables as Run) };
        if (variable === null) delete bound[field];
        else bound[field] = { type: 'VARIABLE_ALIAS', id: variable.id };
        runs[i] = { ...runs[i]!, boundVariables: bound };
      }
    },
  };
  /**
   * A node-level binding: drives every run, and is recorded on the node apart from them — a run's
   * raw write drops the run's binding but leaves the node's record (measured).
   */
  node.setBoundVariable = (field: string, variable: { id: string } | null) => {
    if (variable === null) {
      const { [field]: _gone, ...rest } = nodeBound;
      nodeBound = rest;
      for (let i = 0; i < runs.length; i += 1) {
        const bound = { ...(runs[i]!.boundVariables as Run) };
        delete bound[field];
        runs[i] = { ...runs[i]!, boundVariables: bound };
      }
      return;
    }
    // `characters` is a node field — one alias, driving no run. Typography is per run, and the node
    // lists it as an array (the typings' VariableBindableTextField shape).
    if (field === 'characters') {
      nodeBound = { ...nodeBound, characters: { type: 'VARIABLE_ALIAS', id: variable.id } };
      return;
    }
    nodeBound = { ...nodeBound, [field]: [{ type: 'VARIABLE_ALIAS', id: variable.id }] };
    for (let i = 0; i < runs.length; i += 1) {
      const bound = {
        ...(runs[i]!.boundVariables as Run),
        [field]: { type: 'VARIABLE_ALIAS', id: variable.id },
      };
      runs[i] = { ...runs[i]!, boundVariables: bound };
    }
  };
  /** Test hook: write one run field directly — for a field Figma offers no setter for. */
  node.patchRun = (i: number, patch: Run) => {
    runs[i] = { ...runs[i]!, ...patch };
  };
  Object.defineProperty(node, 'characters', {
    enumerable: true,
    get: () => chars,
    set: (value: string) => {
      const { characters: _dropped, ...rest } = nodeBound; // a raw write drops the binding
      nodeBound = rest;
      const first = runs[0] ?? { ...RUN_DEFAULTS, ...base };
      chars = value;
      runs = [...value].map(() => Object.assign({}, first));
    },
  });
  Object.defineProperty(node, 'boundVariables', { enumerable: true, get: () => nodeBound });
  for (const field of Object.keys(RUN_DEFAULTS).filter(f => f !== 'boundVariables')) {
    if (!NO_RAW_SETTER.has(field)) {
      node[`setRange${capital(field)}`] = (s: number, e: number, v: unknown) =>
        writeRun(s, e, field, v);
    }
    Object.defineProperty(node, field, {
      enumerable: true,
      configurable: true,
      get: () => uniform(field),
      set: (value: unknown) => writeRun(0, chars.length, field, value),
    });
  }
  return node;
};

const segmentsOf = (text: Record<string, unknown>): unknown =>
  (text.getStyledTextSegments as (f: string[]) => unknown)([...SEGMENT_FIELDS]);

const INTER_BOLD = { family: 'Inter', style: 'Bold' };
const FAIL = { tool: 'set_fills', params: { nodeId: 'F', fills: [{ type: 'GRADIENT_LINEAR' }] } };

describe('batch handler', () => {
  it('applies ops in order and returns one result per op', async () => {
    const { figmaCtx, store } = makeFigma({
      '1:1': { id: '1:1', name: 'A', opacity: 1 },
      '1:2': { id: '1:2', name: 'B', x: 10, y: 20 },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    const result = (await handler({
      ops: [
        { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
        { tool: 'set_opacity', params: { nodeId: '1:1', opacity: 0.5 } },
        { tool: 'move_nodes', params: { nodeIds: ['1:2'], dx: 5, dy: -5 } },
      ],
    })) as BatchResult;

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(store.get('1:1')).toMatchObject({ name: 'renamed', opacity: 0.5 });
    expect(store.get('1:2')).toMatchObject({ x: 15, y: 15 });
  });

  it('rejects a non-invertible op at validate time without mutating anything', async () => {
    const { figmaCtx, store } = makeFigma({ '1:1': { id: '1:1', name: 'A' } });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
          { tool: 'delete_nodes', params: { nodeIds: ['1:1'] } },
        ],
      }),
    ).rejects.toThrow(/not batchable/);
    expect(store.get('1:1')).toMatchObject({ name: 'A' }); // untouched
  });

  it('rejects create_component with fromNodeId (no faithful inverse) at validate time', async () => {
    const { figmaCtx, store } = makeFigma({ '1:1': { id: '1:1', type: 'FRAME', name: 'A' } });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
          { tool: 'create_component', params: { fromNodeId: '1:1' } },
        ],
      }),
    ).rejects.toThrow(/fromNodeId is not batchable/);
    expect(store.get('1:1')).toMatchObject({ name: 'A' }); // first op never applied
  });

  it('aborts in the capture phase (bad node id) before any op is applied', async () => {
    const { figmaCtx, store } = makeFigma({ '1:1': { id: '1:1', name: 'A' } });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
          { tool: 'rename_node', params: { nodeId: 'missing', name: 'x' } },
        ],
      }),
    ).rejects.toThrow(/node missing not found/);
    expect(store.get('1:1')).toMatchObject({ name: 'A' }); // first op never applied
  });

  it('rolls back already-applied mutations when a later op fails mid-apply', async () => {
    const { figmaCtx, store } = makeFigma({
      '1:1': { id: '1:1', name: 'A', opacity: 1 },
      '1:2': { id: '1:2', name: 'B', fills: [] },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
          { tool: 'set_opacity', params: { nodeId: '1:1', opacity: 0.3 } },
          // GRADIENT is rejected by set_fills at apply time → triggers rollback of the two above.
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/op 2 \(set_fills\) failed, rolled back 2/);

    expect(store.get('1:1')).toMatchObject({ name: 'A', opacity: 1 }); // both restored
  });

  it('rolls back a create by removing the node it produced', async () => {
    const { figmaCtx, store } = makeFigma({ '1:2': { id: '1:2', fills: [] } });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'create_frame', params: { name: 'New' } },
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    // The frame created by op 0 was the only 9:x node; rollback removed it.
    const created = [...store.keys()].filter(k => k.startsWith('9:'));
    expect(created).toHaveLength(0);
  });

  it('restores the previous x/y on rollback of a set_position op', async () => {
    // set_position writes absolute coordinates, so its undo has to restore both axes even when the
    // op only set one of them — a node placed by x alone must not keep the new x on rollback.
    const { figmaCtx, store } = makeFigma({
      '1:1': { id: '1:1', x: 10, y: 20 },
      '1:2': { id: '1:2', fills: [] },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'set_position', params: { nodeId: '1:1', x: 400 } },
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(store.get('1:1')).toMatchObject({ x: 10, y: 20 });
  });

  it('rolls back when the set_position op is itself the one that fails', async () => {
    // Its refusal of an in-flow auto-layout child is the one failure capture cannot pre-empt — that
    // phase only proves the node has an x — so it lands mid-apply and the earlier op has to come
    // back. The other direction (set_position applied, a later op failing) is covered above.
    const { figmaCtx, store } = makeFigma({
      '1:1': { id: '1:1', name: 'A' },
      '1:2': {
        id: '1:2',
        x: 0,
        y: 0,
        layoutPositioning: 'AUTO',
        parent: { layoutMode: 'VERTICAL' },
      },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
          { tool: 'set_position', params: { nodeId: '1:2', x: 400 } },
        ],
      }),
    ).rejects.toThrow(/op 1 \(set_position\) failed, rolled back 1/);

    expect(store.get('1:1')).toMatchObject({ name: 'A' }); // rename undone
    expect(store.get('1:2')).toMatchObject({ x: 0, y: 0 }); // never moved
  });

  it('applies a set_position op alongside other writes', async () => {
    const { figmaCtx, store } = makeFigma({ '1:1': { id: '1:1', name: 'A', x: 0, y: 0 } });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    const result = (await handler({
      ops: [
        { tool: 'set_position', params: { nodeId: '1:1', x: 120, y: 40 } },
        { tool: 'rename_node', params: { nodeId: '1:1', name: 'placed' } },
      ],
    })) as BatchResult;

    expect(result.results).toHaveLength(2);
    expect(store.get('1:1')).toMatchObject({ x: 120, y: 40, name: 'placed' });
  });

  it('restores a fill on rollback', async () => {
    const { figmaCtx, store } = makeFigma({
      '1:1': { id: '1:1', fills: [SOLID(0.2)] },
      '1:2': { id: '1:2', fills: [] },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'set_fills', params: { nodeId: '1:1', fills: [SOLID(0.9)] } },
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(store.get('1:1')!.fills).toEqual([SOLID(0.2)]); // original fill restored
  });

  it('reports undo failures instead of claiming a clean rollback', async () => {
    // op 0 creates a frame whose remove() throws → its rollback fails; op 1 throws to trigger rollback.
    const store = new Map<string, Record<string, unknown>>([['1:2', { id: '1:2', fills: [] }]]);
    const figmaCtx = {
      currentPage: { appendChild: vi.fn<(n: unknown) => void>() },
      getNodeByIdAsync: async (id: string) => store.get(id) ?? null,
      createFrame: () => {
        const node = {
          id: '9:1',
          name: 'F',
          type: 'FRAME',
          resize: vi.fn<(w: number, h: number) => void>(),
          remove: () => {
            throw new Error('cannot remove');
          },
        };
        store.set('9:1', node);
        return node;
      },
    } as unknown as typeof figma;
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'create_frame', params: {} },
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/undo\(s\) FAILED.*cannot remove.*partially changed/);
  });

  it('restores per-corner radii on rollback when cornerRadius reads mixed', async () => {
    // Corners differ → the uniform cornerRadius getter is figma.mixed (a symbol the undo must
    // skip); the per-corner snapshot is what actually restores the node.
    const { figmaCtx, store } = makeFigma({
      '1:1': {
        id: '1:1',
        cornerRadius: Symbol('mixed'),
        topLeftRadius: 8,
        topRightRadius: 0,
        bottomRightRadius: 4,
        bottomLeftRadius: 0,
      },
      '1:2': { id: '1:2', fills: [] },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'set_corner_radius', params: { nodeId: '1:1', radius: 12 } },
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(store.get('1:1')).toMatchObject({
      topLeftRadius: 8,
      topRightRadius: 0,
      bottomRightRadius: 4,
      bottomLeftRadius: 0,
    });
  });

  it('restores strokeAlign / dashPattern / per-side weights on rollback', async () => {
    const { figmaCtx, store } = makeFigma({
      '1:1': {
        id: '1:1',
        strokes: [SOLID(0.2)],
        strokeWeight: Symbol('mixed'), // per-side weights differ
        strokeAlign: 'INSIDE',
        dashPattern: [4, 2],
        strokeTopWeight: 1,
        strokeRightWeight: 0,
        strokeBottomWeight: 2,
        strokeLeftWeight: 0,
      },
      '1:2': { id: '1:2', fills: [] },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          {
            tool: 'set_strokes',
            params: {
              nodeId: '1:1',
              strokes: [SOLID(0.9)],
              strokeWeight: 3,
              strokeAlign: 'CENTER',
              dashPattern: [],
            },
          },
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(store.get('1:1')).toMatchObject({
      strokes: [SOLID(0.2)],
      strokeAlign: 'INSIDE',
      dashPattern: [4, 2],
      strokeTopWeight: 1,
      strokeRightWeight: 0,
      strokeBottomWeight: 2,
      strokeLeftWeight: 0,
    });
  });

  it('restores every run of a text node on set_text_properties rollback, reloading its fonts', async () => {
    const text = fakeText('1:1', 'Hello World');
    (text.setRangeFontName as Fn as (s: number, e: number, v: unknown) => void)(6, 11, INTER_BOLD);
    (text.setRangeFontSize as Fn as (s: number, e: number, v: unknown) => void)(6, 11, 24);
    const before = segmentsOf(text);
    const { figmaCtx, store, loadFontAsync } = makeFigma({ F: { id: 'F', fills: [] } });
    store.set('1:1', text);
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          {
            tool: 'set_text_properties',
            params: {
              nodeId: '1:1',
              fontName: { family: 'Arial', style: 'Bold' },
              fontSize: 30,
              textCase: 'UPPER',
              textAutoResize: 'HEIGHT',
            },
          },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(segmentsOf(text)).toEqual(before); // both runs, not a node-level flattening
    expect(text.textAutoResize).toBe('WIDTH_AND_HEIGHT');
    // A captured face — the bold run's — is loaded again before its runs are written back.
    expect(loadFontAsync).toHaveBeenCalledWith(INTER_BOLD);
  });

  it('brings back the runs a set_text flattened', async () => {
    // Rewriting characters gives every run the first run's style; putting the old string back alone
    // would leave the text one style. The runs are replayed from the snapshot.
    const text = fakeText('1:1', 'Hello World');
    (text.setRangeFontName as (s: number, e: number, v: unknown) => void)(6, 11, INTER_BOLD);
    (text.setRangeFills as (s: number, e: number, v: unknown) => void)(0, 5, [SOLID(0.9)]);
    const before = segmentsOf(text);
    const { figmaCtx, store } = makeFigma({ F: { id: 'F', fills: [] } });
    store.set('1:1', text);
    const handler = createBatchHandler(figmaCtx, {
      ...realWrites(figmaCtx),
      set_text: createSetTextHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [{ tool: 'set_text', params: { nodeId: '1:1', characters: 'Changed' } }, FAIL],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(text.characters).toBe('Hello World');
    expect(segmentsOf(text)).toEqual(before);
  });

  it('re-attaches a run text style and re-binds a run variable after replaying raw values', async () => {
    const text = fakeText('1:1', 'Aaaa Bbbb');
    await (text.setRangeTextStyleIdAsync as (s: number, e: number, id: string) => Promise<void>)(
      0,
      4,
      'S:text',
    );
    (text.setRangeBoundVariable as (s: number, e: number, f: string, v: { id: string }) => void)(
      5,
      9,
      'fontSize',
      { id: 'V:size' },
    );
    const before = segmentsOf(text);
    const { figmaCtx, store } = makeFigma({ F: { id: 'F', fills: [] } });
    store.set('1:1', text);
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [{ tool: 'set_text_properties', params: { nodeId: '1:1', fontSize: 40 } }, FAIL],
      }),
    ).rejects.toThrow(/rolled back 1/);

    // The raw replay detaches the style and drops the binding again; both come back after it.
    expect(segmentsOf(text)).toEqual(before);
  });

  it('drops a node-level text binding the op added, which replaying the runs leaves behind', async () => {
    const text = fakeText('1:1', 'Hello World');
    (text.setRangeFontName as (s: number, e: number, v: unknown) => void)(6, 11, INTER_BOLD);
    const before = segmentsOf(text);
    const { figmaCtx, store } = makeFigma({ F: { id: 'F', fills: [] } });
    store.set('1:1', text);
    const handler = createBatchHandler(figmaCtx, {
      ...realWrites(figmaCtx),
      bind_variable_to_node: createBindVariableToNodeHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [
          {
            tool: 'bind_variable_to_node',
            params: { nodeId: '1:1', field: 'fontSize', variableId: 'V:24' },
          },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(text.boundVariables).toEqual({});
    expect(segmentsOf(text)).toEqual(before);
  });

  it('re-binds text characters that set_text wrote over', async () => {
    const text = fakeText('1:1', 'from-var');
    (text.setBoundVariable as (f: string, v: { id: string }) => void)('characters', {
      id: 'V:str',
    });
    const { figmaCtx, store } = makeFigma({ F: { id: 'F', fills: [] } });
    store.set('1:1', text);
    const handler = createBatchHandler(figmaCtx, {
      ...realWrites(figmaCtx),
      set_text: createSetTextHandler(figmaCtx),
    });

    await expect(
      handler({ ops: [{ tool: 'set_text', params: { nodeId: '1:1', characters: 'raw' } }, FAIL] }),
    ).rejects.toThrow(/rolled back 1/);

    expect(text.characters).toBe('from-var');
    expect(text.boundVariables).toEqual({ characters: { type: 'VARIABLE_ALIAS', id: 'V:str' } });
  });

  it('restores every text field the text-writing handlers can touch (derived from their source)', () => {
    // The restore list and the handlers are two copies of one fact, and drift is silent: a rollback
    // would restore everything except the newest field and still report success. Read the fields
    // off the handlers' own writes, so adding one fails here until the snapshot learns about it.
    const source = (file: string): string =>
      readFileSync(new URL(`../../src/handlers/${file}`, import.meta.url), 'utf8');
    const assigned = [...source('set-text-properties.ts').matchAll(/\btext\.([A-Za-z]+) = /g)].map(
      m => m[1]!,
    );
    const ranged = [
      ...source('set-text-range.ts').matchAll(/\btext\.setRange([A-Za-z]+?)(?:Async)?\(/g),
    ].map(m => {
      const field = m[1]![0]!.toLowerCase() + m[1]!.slice(1);
      return field === 'boundVariable' ? 'boundVariables' : field;
    });
    expect(assigned.length).toBeGreaterThan(10); // the regexes still match something
    expect(ranged.length).toBeGreaterThan(10);
    expect([...assigned, ...ranged].filter(f => !TEXT_RESTORED_FIELDS.has(f))).toEqual([]);
  });

  it('refuses a non-batchable op with the reason, before anything runs', async () => {
    const { figmaCtx, store } = makeFigma({ '1:1': { id: '1:1', name: 'A' } });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
          { tool: 'delete_nodes', params: { nodeIds: ['1:1'] } },
        ],
      }),
    ).rejects.toThrow(/'delete_nodes' \(index 1\) is not batchable — a deleted node cannot/);
    expect(store.get('1:1')).toMatchObject({ name: 'A' });
  });

  it('refuses two ops that between them would empty a group Figma then deletes', async () => {
    // Each op alone leaves the group a child; only counting across the batch sees both leaving.
    const group: Record<string, unknown> = { id: 'G', type: 'GROUP', name: 'G' };
    const a = { id: 'a', type: 'RECTANGLE', name: 'a', parent: group };
    const b = { id: 'b', type: 'RECTANGLE', name: 'b', parent: group };
    group.children = [a, b];
    const target = {
      id: 'T',
      type: 'FRAME',
      parent: null,
      children: [],
      appendChild: vi.fn<(child: unknown) => void>(),
    };
    const { figmaCtx, store } = makeFigma({ G: group, a, b, T: target });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'reparent_nodes', params: { nodeIds: ['a'], newParentId: 'T' } },
          { tool: 'reparent_nodes', params: { nodeIds: ['b'], newParentId: 'T' } },
        ],
      }),
    ).rejects.toThrow(/op 0 \(reparent_nodes\), op 1 \(reparent_nodes\) would empty GROUP G/);
    expect(target.appendChild).not.toHaveBeenCalled();
    expect(store.get('a')).toMatchObject({ parent: group });
  });

  it('refuses taking a variant out of its set at capture', async () => {
    const set: Record<string, unknown> = { id: 'S', type: 'COMPONENT_SET' };
    const variant = { id: 'v', type: 'COMPONENT', name: 'State=A', parent: set };
    const other = { id: 'w', type: 'COMPONENT', name: 'State=B', parent: set };
    set.children = [variant, other];
    const target = {
      id: 'T',
      type: 'FRAME',
      parent: null,
      children: [],
      appendChild: vi.fn<(child: unknown) => void>(),
    };
    const { figmaCtx } = makeFigma({ S: set, v: variant, w: other, T: target });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({ ops: [{ tool: 'reparent_nodes', params: { nodeIds: ['v'], newParentId: 'T' } }] }),
    ).rejects.toThrow(/v is a variant of S/);
    expect(target.appendChild).not.toHaveBeenCalled();
  });

  it('names what a rollback could not put back instead of claiming a clean one', async () => {
    // OpenType features have no setter: when rewriting the characters resets a run's features, the
    // text restore can bring back everything else but must say that much stayed changed.
    const text = fakeText('1:1', 'Hello World');
    for (let i = 6; i < 11; i += 1) {
      (text.patchRun as (i: number, p: Run) => void)(i, { openTypeFeatures: { SUPS: true } });
    }
    const { figmaCtx, store } = makeFigma({ F: { id: 'F', fills: [] } });
    store.set('1:1', text);
    const handler = createBatchHandler(figmaCtx, {
      ...realWrites(figmaCtx),
      set_text: createSetTextHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [{ tool: 'set_text', params: { nodeId: '1:1', characters: 'Changed' } }, FAIL],
      }),
    ).rejects.toThrow(
      /rolled back 1 applied op\(s\) \(restored with residue: op 0 \(set_text\): text 1:1 keeps changed OpenType features/,
    );
    expect(text.characters).toBe('Hello World');
  });

  it('replays as a unit under idempotency: same requestId applies its ops once', async () => {
    const { figmaCtx, store } = makeFigma({ '1:2': { id: '1:2', x: 0, y: 0 } });
    const batch = idempotent(
      createIdempotencyCache(),
      createBatchHandler(figmaCtx, realWrites(figmaCtx)),
    );
    const call = {
      requestId: 'r1',
      ops: [{ tool: 'move_nodes', params: { nodeIds: ['1:2'], dx: 10, dy: 0 } }],
    };

    const first = (await batch(call)) as BatchResult;
    const replay = (await batch(call)) as BatchResult;

    expect(replay).toEqual(first); // cached result returned, not re-run
    expect(store.get('1:2')).toMatchObject({ x: 10, y: 0 }); // moved once, not twice
  });

  it('turns a bare-string rejection during capture into an Error saying nothing was applied', async () => {
    // Figma can reject with a plain string (measured: a connection failure); it must not escape raw.
    const { figmaCtx, store } = makeFigma({ '1:1': { id: '1:1', name: 'A' } });
    const handler = createBatchHandler(
      {
        ...figmaCtx,
        getNodeByIdAsync: async (id: string) => {
          if (id === 'offline') throw 'Unable to establish connection to Figma after 10 seconds'; // eslint-disable-line no-throw-literal
          return store.get(id) ?? null;
        },
      } as unknown as typeof figma,
      realWrites(figmaCtx),
    );

    const failure = handler({
      ops: [
        { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
        { tool: 'rename_node', params: { nodeId: 'offline', name: 'x' } },
      ],
    });
    await expect(failure).rejects.toBeInstanceOf(Error);
    await expect(failure).rejects.toThrow(
      /capture failed before any op was applied: Unable to establish connection/,
    );
    expect(store.get('1:1')).toMatchObject({ name: 'A' });
  });

  it('resolves bound variables at capture, so no undo has to ask Figma for one', async () => {
    // A live rollback was measured failing on exactly this call ("Unable to establish connection to
    // Figma after 10 seconds"), which leaves the document changed. Capture is where such a failure
    // costs nothing, so the resolve moved there and the undo only assigns.
    const { figmaCtx } = makeFigma({
      '1:1': {
        id: '1:1',
        opacity: 0.5,
        boundVariables: { opacity: { type: 'VARIABLE_ALIAS', id: 'V:half' } },
        setBoundVariable: vi.fn<(f: string, v: unknown) => void>(),
      },
      F: { id: 'F', fills: [] },
    });
    const getVariableByIdAsync = vi.fn<(id: string) => Promise<unknown>>(async id => ({ id }));
    let applying = false;
    const ctx = {
      ...figmaCtx,
      variables: {
        getVariableByIdAsync: async (id: string) => {
          if (applying) throw new Error('an undo must not resolve a variable');
          return getVariableByIdAsync(id);
        },
      },
    } as unknown as typeof figma;
    const handler = createBatchHandler(ctx, {
      ...realWrites(ctx),
      set_fills: async (params: unknown) => {
        applying = true; // everything from the failing op onward, rollback included
        return createSetFillsHandler(ctx)(params);
      },
    });

    await expect(
      handler({ ops: [{ tool: 'set_opacity', params: { nodeId: '1:1', opacity: 0.2 } }, FAIL] }),
    ).rejects.toThrow(/rolled back 1 applied op\(s\)/); // no "undo(s) FAILED"
    expect(getVariableByIdAsync).toHaveBeenCalledWith('V:half'); // resolved, but during capture
  });

  it('validates the ops envelope', async () => {
    const { figmaCtx } = makeFigma({});
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));
    await expect(handler({})).rejects.toThrow(/ops must be an array/);
    await expect(handler({ ops: [] })).rejects.toThrow(/must not be empty/);
    await expect(handler({ ops: [{ params: {} }] })).rejects.toThrow(/tool must be a string/);
  });
});

// ── Motion (beta) batch inverses ─────────────────────────────────────────────

const makeMotionFigma = (editorType = 'figma') => {
  const store = new Map<string, Record<string, unknown>>();

  const addMotionNode = (
    id: string,
    init: { tracks?: Record<string, unknown>; timelines?: { id: string; duration: number }[] } = {},
  ) => {
    const applied: { id: string; styleId: string }[] = [];
    const tracks: Record<string, unknown> = { ...init.tracks };
    const timelines = init.timelines ?? [];
    let seq = 0;
    const node = {
      id,
      get animationStyles() {
        return applied.slice();
      },
      get manualKeyframeTracks() {
        return tracks;
      },
      get timelines() {
        return timelines;
      },
      applyAnimationStyle: vi.fn<(styleId: string) => string>((styleId: string) => {
        const appliedId = `${id}:as:${(seq += 1)}`;
        applied.push({ id: appliedId, styleId });
        return appliedId;
      }),
      removeAnimationStyle: vi.fn<(appliedId: string) => void>((appliedId: string) => {
        const i = applied.findIndex(a => a.id === appliedId);
        if (i >= 0) applied.splice(i, 1);
      }),
      applyManualKeyframeTrack: vi.fn<
        (field: { type: string; name?: string }, track: unknown) => void
      >((field: { type: string; name?: string }, track: unknown) => {
        if (field.type === 'PROPERTY' && field.name !== undefined) tracks[field.name] = track;
      }),
      removeManualKeyframeTrack: vi.fn<(field: { type: string; name?: string }) => void>(
        (field: { type: string; name?: string }) => {
          if (field.type === 'PROPERTY' && field.name !== undefined) delete tracks[field.name];
        },
      ),
      setTimelineDuration: vi.fn<(tid: string, d: number) => void>((tid: string, d: number) => {
        const t = timelines.find(x => x.id === tid);
        if (t !== undefined) t.duration = d;
      }),
    };
    store.set(id, node as unknown as Record<string, unknown>);
    return node;
  };

  const figmaCtx = {
    editorType,
    getNodeByIdAsync: async (id: string) => store.get(id) ?? null,
  } as unknown as typeof figma;

  return { figmaCtx, store, addMotionNode };
};

const motionWrites = (figmaCtx: typeof figma): SandboxHandlers => ({
  apply_animation_style: createApplyAnimationStyleHandler(figmaCtx),
  apply_manual_keyframe_track: createApplyManualKeyframeTrackHandler(figmaCtx),
  set_timeline_duration: createSetTimelineDurationHandler(figmaCtx),
  set_fills: createSetFillsHandler(figmaCtx),
});

/** A trailing op that always fails at apply time, forcing rollback of the preceding Motion op. */
const FAILING_FILL = {
  tool: 'set_fills',
  params: { nodeId: 'F', fills: [{ type: 'GRADIENT_LINEAR' }] },
};

describe('batch Motion inverses', () => {
  it('rolls back apply_animation_style by removing the applied style instance', async () => {
    const { figmaCtx, store, addMotionNode } = makeMotionFigma();
    const a = addMotionNode('1:1');
    store.set('F', { id: 'F', fills: [] });
    const handler = createBatchHandler(figmaCtx, motionWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'apply_animation_style', params: { nodeId: '1:1', styleId: 's1' } },
          FAILING_FILL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(a.removeAnimationStyle).toHaveBeenCalledWith('1:1:as:1');
    expect(a.animationStyles).toHaveLength(0);
  });

  it('restores a prior PROPERTY keyframe track on rollback', async () => {
    const OLD = {
      baseValue: { type: 'FLOAT', value: 0 },
      keyframes: [{ timelinePosition: 0, value: { type: 'FLOAT', value: 0 } }],
    };
    const { figmaCtx, store, addMotionNode } = makeMotionFigma();
    const a = addMotionNode('1:1', { tracks: { TRANSLATION_X: OLD } });
    store.set('F', { id: 'F', fills: [] });
    const handler = createBatchHandler(figmaCtx, motionWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          {
            tool: 'apply_manual_keyframe_track',
            params: {
              nodeId: '1:1',
              field: { type: 'PROPERTY', name: 'TRANSLATION_X' },
              track: {
                keyframes: [{ timelinePosition: 0.3, value: { type: 'FLOAT', value: 120 } }],
              },
            },
          },
          FAILING_FILL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(a.manualKeyframeTracks.TRANSLATION_X).toEqual(OLD); // deep-equal, from the cloned snapshot
  });

  it('removes a PROPERTY keyframe track on rollback when there was none before', async () => {
    const { figmaCtx, store, addMotionNode } = makeMotionFigma();
    const a = addMotionNode('1:1');
    store.set('F', { id: 'F', fills: [] });
    const handler = createBatchHandler(figmaCtx, motionWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          {
            tool: 'apply_manual_keyframe_track',
            params: {
              nodeId: '1:1',
              field: { type: 'PROPERTY', name: 'OPACITY' },
              track: { keyframes: [{ timelinePosition: 0, value: { type: 'FLOAT', value: 1 } }] },
            },
          },
          FAILING_FILL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(a.removeManualKeyframeTrack).toHaveBeenCalledWith({ type: 'PROPERTY', name: 'OPACITY' });
    expect(a.manualKeyframeTracks.OPACITY).toBeUndefined();
  });

  it('rejects an indexed (effects) keyframe track as not batchable, before any op runs', async () => {
    const { figmaCtx, addMotionNode } = makeMotionFigma();
    addMotionNode('1:1');
    const handler = createBatchHandler(figmaCtx, motionWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          {
            tool: 'apply_manual_keyframe_track',
            params: {
              nodeId: '1:1',
              field: { type: 'INDEXED_ITEM', collection: 'effects', index: 0, field: 'RADIUS' },
              track: { keyframes: [{ timelinePosition: 0, value: { type: 'FLOAT', value: 1 } }] },
            },
          },
        ],
      }),
    ).rejects.toThrow(/only PROPERTY fields are batchable/);
  });

  it('restores a timeline duration on rollback', async () => {
    const { figmaCtx, store, addMotionNode } = makeMotionFigma();
    const a = addMotionNode('1:1', { timelines: [{ id: 't1', duration: 1 }] });
    store.set('F', { id: 'F', fills: [] });
    const handler = createBatchHandler(figmaCtx, motionWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          {
            tool: 'set_timeline_duration',
            params: { nodeId: '1:1', timelineId: 't1', duration: 5 },
          },
          FAILING_FILL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(a.timelines[0]!.duration).toBe(1);
  });

  it('rejects Motion ops outside the Figma Design editor at capture time', async () => {
    const { figmaCtx, addMotionNode } = makeMotionFigma('figjam');
    addMotionNode('1:1');
    const handler = createBatchHandler(figmaCtx, motionWrites(figmaCtx));

    await expect(
      handler({
        ops: [{ tool: 'apply_animation_style', params: { nodeId: '1:1', styleId: 's1' } }],
      }),
    ).rejects.toThrow(/Figma Design editor/);
  });
});

// ── Newly batchable writes ───────────────────────────────────────────────────

/** A figma stand-in wide enough for the style / variable / page / component writes. */
const makeWide = () => {
  const store = new Map<string, Record<string, unknown>>();
  const styles = new Map<string, Record<string, unknown>>();
  const variables = new Map<string, Record<string, unknown>>();
  const collections = new Map<string, Record<string, unknown>>();
  const pages = { current: 'P:1' };
  let seq = 0;
  const figmaCtx = {
    mixed: MIXED,
    get currentPage() {
      return store.get(pages.current);
    },
    setCurrentPageAsync: vi.fn<(p: { id: string }) => Promise<void>>(async p => {
      pages.current = p.id;
    }),
    getNodeByIdAsync: async (id: string) => store.get(id) ?? null,
    getStyleByIdAsync: async (id: string) => styles.get(id) ?? null,
    createPaintStyle: () => {
      const style: Record<string, unknown> = {
        id: `S:${(seq += 1)}`,
        type: 'PAINT',
        name: '',
        description: '',
        paints: [],
        remove: vi.fn<() => void>(() => styles.delete(style.id as string)),
      };
      styles.set(style.id as string, style);
      return style;
    },
    variables: {
      getVariableByIdAsync: async (id: string) => variables.get(id) ?? null,
      getVariableCollectionByIdAsync: async (id: string) => collections.get(id) ?? null,
    },
  } as unknown as typeof figma;
  return { figmaCtx, store, styles, variables, collections, pages };
};

const failingFrame = (store: Map<string, Record<string, unknown>>): void => {
  store.set('F', { id: 'F', fills: [] });
};

describe('batch inverses for the newly batchable writes', () => {
  it('puts reactions back after set_reactions and after remove_reactions', async () => {
    const { figmaCtx, store } = makeWide();
    failingFrame(store);
    const node = (id: string, reactions: unknown[]) => {
      const n: Record<string, unknown> = {
        id,
        reactions,
        setReactionsAsync: vi.fn<(r: unknown[]) => Promise<void>>(async r => {
          n.reactions = r;
        }),
      };
      store.set(id, n);
      return n;
    };
    const had = [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'BACK' }] }];
    const a = node('1:1', []);
    const b = node('1:2', had);
    const handler = createBatchHandler(figmaCtx, {
      set_reactions: createSetReactionsHandler(figmaCtx),
      remove_reactions: createRemoveReactionsHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [
          { tool: 'set_reactions', params: { nodeId: '1:1', reactions: had } },
          { tool: 'remove_reactions', params: { nodeId: '1:2' } },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 2/);
    expect(a.reactions).toEqual([]);
    expect(b.reactions).toEqual(had);
  });

  it('navigates back to the page it started on', async () => {
    const { figmaCtx, store, pages } = makeWide();
    failingFrame(store);
    store.set('P:1', { id: 'P:1', type: 'PAGE' });
    store.set('P:2', { id: 'P:2', type: 'PAGE' });
    const handler = createBatchHandler(figmaCtx, {
      navigate_to_page: createNavigateToPageHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });

    await expect(
      handler({ ops: [{ tool: 'navigate_to_page', params: { pageId: 'P:2' } }, FAIL] }),
    ).rejects.toThrow(/rolled back 1/);
    expect(pages.current).toBe('P:1');
  });

  it('restores a variable value, name and code syntax', async () => {
    const { figmaCtx, store, variables, collections } = makeWide();
    failingFrame(store);
    collections.set('C:1', { id: 'C:1', modes: [{ modeId: 'm1', name: 'Mode 1' }] });
    const variable: Record<string, unknown> = {
      id: 'V:1',
      name: 'size',
      resolvedType: 'FLOAT',
      variableCollectionId: 'C:1',
      valuesByMode: { m1: 8 },
      codeSyntax: { WEB: '--size' },
      setValueForMode(mode: string, value: unknown) {
        variable.valuesByMode = { ...(variable.valuesByMode as object), [mode]: value };
      },
      setVariableCodeSyntax(platform: string, value: string) {
        variable.codeSyntax = { ...(variable.codeSyntax as object), [platform]: value };
      },
      removeVariableCodeSyntax(platform: string) {
        const { [platform]: _gone, ...rest } = variable.codeSyntax as Record<string, string>;
        variable.codeSyntax = rest;
      },
    };
    variables.set('V:1', variable);
    const handler = createBatchHandler(figmaCtx, {
      set_variable_value: createSetVariableValueHandler(figmaCtx),
      set_variable_code_syntax: createSetVariableCodeSyntaxHandler(figmaCtx),
      rename_variable: createRenameVariableHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [
          { tool: 'set_variable_value', params: { variableId: 'V:1', modeId: 'm1', value: 16 } },
          {
            tool: 'set_variable_code_syntax',
            params: { variableId: 'V:1', codeSyntax: { WEB: '--big', ANDROID: 'big' } },
          },
          { tool: 'rename_variable', params: { variableId: 'V:1', name: 'big' } },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 3/);
    expect(variable).toMatchObject({
      name: 'size',
      valuesByMode: { m1: 8 },
      codeSyntax: { WEB: '--size' },
    });
  });

  it("refuses a value written to a mode outside the variable's own collection", async () => {
    // An extended collection's mode writes an override — an inverse not verified yet.
    const { figmaCtx, variables, collections } = makeWide();
    collections.set('C:1', { id: 'C:1', modes: [{ modeId: 'm1', name: 'Mode 1' }] });
    variables.set('V:1', {
      id: 'V:1',
      name: 'size',
      variableCollectionId: 'C:1',
      valuesByMode: { m1: 8 },
    });
    const handler = createBatchHandler(figmaCtx, {
      set_variable_value: createSetVariableValueHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [
          { tool: 'set_variable_value', params: { variableId: 'V:1', modeId: 'ext', value: 1 } },
        ],
      }),
    ).rejects.toThrow(/mode ext is not a mode of size's own collection/);
  });

  it('removes what a create made — a style, a mode, a component property', async () => {
    const { figmaCtx, store, styles, collections } = makeWide();
    failingFrame(store);
    const collection: Record<string, unknown> = {
      id: 'C:1',
      name: 'c',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      addMode(name: string) {
        (collection.modes as unknown[]).push({ modeId: 'm2', name });
        return 'm2';
      },
      removeMode: vi.fn<(id: string) => void>(id => {
        collection.modes = (collection.modes as { modeId: string }[]).filter(m => m.modeId !== id);
      }),
    };
    collections.set('C:1', collection);
    const definitions: Record<string, unknown> = {};
    const component = {
      id: '1:1',
      type: 'COMPONENT',
      parent: null,
      componentPropertyDefinitions: definitions,
      addComponentProperty: (name: string, type: string, defaultValue: unknown) => {
        definitions[`${name}#9:9`] = { type, defaultValue };
        return `${name}#9:9`;
      },
      deleteComponentProperty: vi.fn<(id: string) => void>(id => {
        delete definitions[id];
      }),
    };
    store.set('1:1', component);
    const handler = createBatchHandler(figmaCtx, {
      create_paint_style: createCreatePaintStyleHandler(figmaCtx),
      add_variable_mode: createAddVariableModeHandler(figmaCtx),
      add_component_property: createAddComponentPropertyHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [
          { tool: 'create_paint_style', params: { name: 'new', paints: [] } },
          { tool: 'add_variable_mode', params: { collectionId: 'C:1', name: 'Dark' } },
          {
            tool: 'add_component_property',
            params: { componentId: '1:1', name: 'Show', type: 'BOOLEAN', defaultValue: true },
          },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 3/);
    expect(styles.size).toBe(0);
    expect(collection.modes).toEqual([{ modeId: 'm1', name: 'Mode 1' }]);
    expect(definitions).toEqual({});
  });

  it('edits a component property back through the id the rename minted', async () => {
    const { figmaCtx, store } = makeWide();
    failingFrame(store);
    const definitions: Record<string, Record<string, unknown>> = {
      'Title#1:0': { type: 'TEXT', defaultValue: 'Hello' },
    };
    const edits: [string, unknown][] = [];
    const component = {
      id: '1:1',
      type: 'COMPONENT',
      parent: null,
      componentPropertyDefinitions: definitions,
      editComponentProperty: (id: string, value: { name?: string; defaultValue?: unknown }) => {
        edits.push([id, value]);
        const def = {
          ...definitions[id]!,
          ...('defaultValue' in value && { defaultValue: value.defaultValue }),
        };
        delete definitions[id];
        const next = `${value.name ?? id.split('#')[0]}#1:0`;
        definitions[next] = def;
        return next;
      },
    };
    store.set('1:1', component);
    const handler = createBatchHandler(figmaCtx, {
      edit_component_property: createEditComponentPropertyHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [
          {
            tool: 'edit_component_property',
            params: {
              componentId: '1:1',
              propertyId: 'Title#1:0',
              name: 'Heading',
              defaultValue: 'Hi',
            },
          },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);
    expect(edits.at(-1)).toEqual(['Heading#1:0', { name: 'Title', defaultValue: 'Hello' }]);
    expect(definitions).toEqual({ 'Title#1:0': { type: 'TEXT', defaultValue: 'Hello' } });
  });

  it('restores a paint style it updated', async () => {
    const { figmaCtx, store, styles } = makeWide();
    failingFrame(store);
    const style = {
      id: 'S:1',
      type: 'PAINT',
      name: 'brand',
      description: 'd',
      paints: [SOLID(0.2)],
    };
    styles.set('S:1', style);
    const handler = createBatchHandler(figmaCtx, {
      update_paint_style: createUpdatePaintStyleHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [
          {
            tool: 'update_paint_style',
            params: { styleId: 'S:1', name: 'x', description: 'y', paints: [SOLID(0.9)] },
          },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);
    expect(style).toEqual({
      id: 'S:1',
      type: 'PAINT',
      name: 'brand',
      description: 'd',
      paints: [SOLID(0.2)],
    });
  });

  it('restores names after batch_rename_nodes and the order after reorder_nodes', async () => {
    const { figmaCtx, store } = makeFigma({ F: { id: 'F', fills: [] } });
    const parent: Record<string, unknown> & { children: Record<string, unknown>[] } = {
      id: 'P',
      children: [],
      insertChild(index: number, child: Record<string, unknown>) {
        const at = parent.children.indexOf(child);
        parent.children.splice(index, 0, child);
        if (at !== -1) parent.children.splice(at < index ? at : at + 1, 1);
      },
    };
    const kids = ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase(), parent }));
    parent.children = [...kids];
    store.set('P', parent);
    for (const k of kids) store.set(k.id, k);
    const handler = createBatchHandler(figmaCtx, {
      batch_rename_nodes: createBatchRenameNodesHandler(figmaCtx),
      reorder_nodes: createReorderNodesHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [
          { tool: 'batch_rename_nodes', params: { renames: [{ nodeId: 'a', name: 'x' }] } },
          { tool: 'reorder_nodes', params: { nodeIds: ['c'], index: 0 } },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 2/);
    expect(kids[0]!.name).toBe('A');
    expect(parent.children.map(c => c.id)).toEqual(['a', 'b', 'c']);
  });
});

// ── Tree structure ───────────────────────────────────────────────────────────

type TreeNode = Record<string, unknown> & {
  id: string;
  children?: TreeNode[];
  parent?: TreeNode | null;
};

const T0 = [
  [1, 0, 0],
  [0, 1, 0],
];

/**
 * A node tree that behaves like Figma's where the structural inverses depend on it (measured): a
 * GROUP / COMPONENT_SET deletes itself once emptied; a node placed into auto-layout loses its own
 * position to the layout; combining renames the components and hands each one every component's
 * properties, and leaving a set renames a component again.
 */
const makeTree = () => {
  const store = new Map<string, TreeNode>();
  let seq = 0;
  const detach = (child: TreeNode): void => {
    const parent = child.parent;
    if (parent === null || parent === undefined) return;
    parent.children!.splice(parent.children!.indexOf(child), 1);
    if (parent.type === 'COMPONENT_SET')
      child.name = `Component/${String(child.name).split('=')[1]}`;
    if (
      (parent.type === 'GROUP' || parent.type === 'COMPONENT_SET') &&
      parent.children!.length === 0
    ) {
      parent.removed = true;
      detach(parent);
      store.delete(parent.id);
    }
  };
  const place = (parent: TreeNode, child: TreeNode, index: number): void => {
    detach(child);
    parent.children!.splice(Math.min(index, parent.children!.length), 0, child);
    child.parent = parent;
    if (typeof parent.layoutMode === 'string' && parent.layoutMode !== 'NONE') {
      child.relativeTransform = T0; // the layout places it
    }
  };
  const node = (
    id: string,
    type: string,
    parent: TreeNode | null,
    extra: Record<string, unknown> = {},
  ): TreeNode => {
    const n: TreeNode = {
      id,
      type,
      name: id,
      parent: null,
      width: 10,
      height: 10,
      relativeTransform: T0,
      removed: false,
      resizeWithoutConstraints(this: TreeNode, w: number, h: number) {
        this.width = w;
        this.height = h;
      },
      remove(this: TreeNode) {
        detach(this);
        this.removed = true;
        store.delete(this.id);
      },
      ...extra,
    };
    if (['FRAME', 'GROUP', 'PAGE', 'COMPONENT_SET'].includes(type)) {
      n.children = [];
      n.layoutMode ??= 'NONE';
      n.insertChild = (i: number, c: TreeNode) => place(n, c, i);
      n.appendChild = (c: TreeNode) => place(n, c, n.children!.length);
    }
    store.set(id, n);
    if (parent !== null) place(parent, n, parent.children!.length);
    return n;
  };
  const figmaCtx = {
    mixed: MIXED,
    getNodeByIdAsync: async (id: string) => store.get(id) ?? null,
    variables: { getVariableByIdAsync: async (id: string) => ({ id }) },
    group: (nodes: TreeNode[], parent: TreeNode) => {
      const g = node(`G:${(seq += 1)}`, 'GROUP', parent);
      for (const n of nodes) place(g, n, g.children!.length);
      return g;
    },
    combineAsVariants: (components: TreeNode[], parent: TreeNode) => {
      const set = node(`S:${(seq += 1)}`, 'COMPONENT_SET', parent);
      const shared = Object.assign({}, ...components.map(c => c.componentPropertyDefinitions));
      for (const c of components) {
        place(set, c, set.children!.length);
        c.name = `Property 1=${String(c.name)}`;
        c.componentPropertyDefinitions = { ...shared };
      }
      return set;
    },
  } as unknown as typeof figma;
  return { store, node, figmaCtx };
};

const ids = (n: TreeNode): string[] => n.children!.map(c => c.id);

describe('batch inverses for tree structure', () => {
  it('puts a node taken into auto-layout back where it was, position included', async () => {
    const { node, figmaCtx } = makeTree();
    const page = node('P0', 'PAGE', null);
    const plain = node('P1', 'FRAME', page);
    node('x', 'RECTANGLE', plain);
    const moved = node('n', 'RECTANGLE', plain, {});
    moved.relativeTransform = [
      [1, 0, 5],
      [0, 1, 6],
    ];
    node('y', 'RECTANGLE', plain);
    const flow = node('P2', 'FRAME', page, { layoutMode: 'HORIZONTAL' });
    node('z', 'RECTANGLE', flow);
    node('F', 'RECTANGLE', page, { fills: [] });
    const handler = createBatchHandler(figmaCtx, {
      reparent_nodes: createReparentNodesHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [{ tool: 'reparent_nodes', params: { nodeIds: ['n'], newParentId: 'P2' } }, FAIL],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(ids(plain)).toEqual(['x', 'n', 'y']);
    expect(ids(flow)).toEqual(['z']);
    expect(moved.relativeTransform).toEqual([
      [1, 0, 5],
      [0, 1, 6],
    ]);
  });

  it('ungroups nodes gathered from two parents back into both, and the group goes', async () => {
    const { node, store, figmaCtx } = makeTree();
    const page = node('P0', 'PAGE', null);
    const p = node('P', 'FRAME', page);
    node('a', 'RECTANGLE', p);
    node('b', 'RECTANGLE', p);
    const q = node('Q', 'FRAME', page);
    node('c', 'RECTANGLE', q);
    node('F', 'RECTANGLE', page, { fills: [] });
    const handler = createBatchHandler(figmaCtx, {
      group_nodes: createGroupNodesHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });

    await expect(
      handler({ ops: [{ tool: 'group_nodes', params: { nodeIds: ['a', 'c'] } }, FAIL] }),
    ).rejects.toThrow(/rolled back 1/);

    expect(ids(p)).toEqual(['a', 'b']);
    expect(ids(q)).toEqual(['c']);
    expect([...store.keys()].filter(k => k.startsWith('G:'))).toEqual([]);
  });

  it('un-combines components: order, names, and the properties the set handed out', async () => {
    const { node, store, figmaCtx } = makeTree();
    const page = node('P0', 'PAGE', null);
    const component = (id: string, defs: Record<string, unknown>) =>
      node(id, 'COMPONENT', page, {
        componentPropertyDefinitions: defs,
        deleteComponentProperty(this: TreeNode, key: string) {
          const { [key]: _gone, ...rest } = this.componentPropertyDefinitions as Record<
            string,
            unknown
          >;
          this.componentPropertyDefinitions = rest;
        },
      });
    const k1 = component('k1', { 'Txt#1:0': { type: 'TEXT', defaultValue: 'hi' } });
    k1.name = 'Alpha';
    const k2 = component('k2', {});
    k2.name = 'Beta';
    node('F', 'RECTANGLE', page, { fills: [] });
    const handler = createBatchHandler(figmaCtx, {
      combine_as_variants: createCombineAsVariantsHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });

    await expect(
      handler({ ops: [{ tool: 'combine_as_variants', params: { nodeIds: ['k1', 'k2'] } }, FAIL] }),
    ).rejects.toThrow(/rolled back 1/);

    expect(ids(page)).toEqual(['k1', 'k2', 'F']);
    expect([k1.name, k2.name]).toEqual(['Alpha', 'Beta']);
    expect(k1.componentPropertyDefinitions).toEqual({
      'Txt#1:0': { type: 'TEXT', defaultValue: 'hi' },
    });
    expect(k2.componentPropertyDefinitions).toEqual({}); // the copy it was handed is gone
    expect([...store.keys()].filter(k => k.startsWith('S:'))).toEqual([]);
  });

  it('turns auto-layout back off last, after the fields only a layout mode can take', async () => {
    const { node, figmaCtx } = makeTree();
    const page = node('P0', 'PAGE', null);
    const writes: string[] = [];
    const state: Record<string, unknown> = { layoutMode: 'NONE', paddingLeft: 0, itemSpacing: 0 };
    const frame = node('A', 'FRAME', page);
    for (const k of Object.keys(state)) {
      Object.defineProperty(frame, k, {
        enumerable: true,
        get: () => state[k],
        set: (v: unknown) => {
          writes.push(`${k}=${String(v)}`);
          state[k] = v;
        },
      });
    }
    node('F', 'RECTANGLE', page, { fills: [] });
    const handler = createBatchHandler(figmaCtx, {
      set_auto_layout: createSetAutoLayoutHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [
          {
            tool: 'set_auto_layout',
            params: { nodeId: 'A', layoutMode: 'HORIZONTAL', paddingLeft: 16, itemSpacing: 8 },
          },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(state).toEqual({ layoutMode: 'NONE', paddingLeft: 0, itemSpacing: 0 });
    const undo = writes.slice(writes.indexOf('itemSpacing=8') + 1);
    expect(undo.at(-1)).toBe('layoutMode=NONE');
    expect(undo).toContain('paddingLeft=0');
  });
});

// ── Instances and text styles ────────────────────────────────────────────────

describe('batch inverses for instances and text styles', () => {
  /**
   * An instance whose VARIANT property picks its main component, and whose TEXT property can be
   * bound.
   */
  const makeInstance = () => {
    const mains: Record<string, { id: string; type: string }> = {
      A: { id: 'M:A', type: 'COMPONENT' },
      B: { id: 'M:B', type: 'COMPONENT' },
    };
    let main = mains.A!;
    let props: Record<string, Record<string, unknown>> = {
      State: { type: 'VARIANT', value: 'A' },
      'Title#1:0': {
        type: 'TEXT',
        value: 'from-var',
        boundVariables: { value: { type: 'VARIABLE_ALIAS', id: 'V:s' } },
      },
    };
    const instance: Record<string, unknown> = {
      id: 'I:1',
      type: 'INSTANCE',
      parent: null,
      removed: false,
      overrides: [],
      findAllWithCriteria: () => [],
      get componentProperties() {
        return props;
      },
      getMainComponentAsync: async () => main,
      swapComponent: vi.fn<(c: { id: string; type: string }) => void>(c => {
        main = c;
      }),
      setProperties: vi.fn<(p: Record<string, unknown>) => void>(p => {
        const next = { ...props };
        for (const [key, value] of Object.entries(p)) {
          const alias = typeof value === 'object' && value !== null ? value : undefined;
          next[key] = {
            type: props[key]!.type,
            value: alias === undefined ? value : 'from-var',
            ...(alias !== undefined && { boundVariables: { value: alias } }),
          };
          if (key === 'State') main = mains[value as string]!;
        }
        props = next;
      }),
    };
    const { figmaCtx, store } = makeFigma({ F: { id: 'F', fills: [] } });
    store.set('I:1', instance);
    store.set('M:A', mains.A!);
    store.set('M:B', mains.B!);
    return { instance, figmaCtx, mains, current: () => ({ main, props }) };
  };

  it('puts instance properties back — a bound one as its alias — and the main they chose', async () => {
    const { instance, figmaCtx, mains, current } = makeInstance();
    const before = current().props;
    const handler = createBatchHandler(figmaCtx, {
      set_instance_properties: createSetInstancePropertiesHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [
          {
            tool: 'set_instance_properties',
            params: { instanceId: 'I:1', properties: { State: 'B', 'Title#1:0': 'plain' } },
          },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(instance.setProperties).toHaveBeenLastCalledWith({
      State: 'A',
      'Title#1:0': { type: 'VARIABLE_ALIAS', id: 'V:s' },
    });
    expect(current().props).toEqual(before);
    expect(current().main).toBe(mains.A);
  });

  it('swaps an instance back to the main it had', async () => {
    const { figmaCtx, mains, current } = makeInstance();
    const handler = createBatchHandler(figmaCtx, {
      swap_component: createSwapComponentHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [{ tool: 'swap_component', params: { instanceId: 'I:1', componentId: 'M:B' } }, FAIL],
      }),
    ).rejects.toThrow(/rolled back 1/);
    expect(current().main).toBe(mains.A);
  });

  it('restores a text style: unbinds what the op bound, reloads the old face, writes the old values', async () => {
    const log: string[] = [];
    let bound: Record<string, { type: string; id: string }> = {};
    const style: Record<string, unknown> = {
      id: 'S:t',
      type: 'TEXT',
      name: 'body',
      description: '',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 14,
      lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      paragraphSpacing: 0,
      paragraphIndent: 0,
      textWrapStyle: 'AUTO',
      get boundVariables() {
        return bound;
      },
      setBoundVariable: (field: string, v: { id: string } | null) => {
        log.push(`bind ${field}=${v === null ? 'null' : v.id}`);
        const { [field]: _old, ...rest } = bound;
        bound = v === null ? rest : { ...rest, [field]: { type: 'VARIABLE_ALIAS', id: v.id } };
      },
      getStyleConsumersAsync: async () => [],
    };
    const loadFontAsync = vi.fn<(f: unknown) => Promise<void>>(async () => {});
    const { figmaCtx } = makeFigma({ F: { id: 'F', fills: [] } });
    Object.assign(figmaCtx, {
      loadFontAsync,
      getStyleByIdAsync: async (id: string) => (id === 'S:t' ? style : null),
      variables: {
        getVariableByIdAsync: async (id: string) => ({
          id,
          resolvedType: 'FLOAT',
          valuesByMode: { m: 24 },
        }),
      },
    });
    const handler = createBatchHandler(figmaCtx, {
      update_text_style: createUpdateTextStyleHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });

    await expect(
      handler({
        ops: [
          {
            tool: 'update_text_style',
            params: {
              styleId: 'S:t',
              fontName: { family: 'Inter', style: 'Bold' },
              fontSize: 32,
              boundVariables: { fontSize: 'V:24' },
            },
          },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(style).toMatchObject({ fontName: { family: 'Inter', style: 'Regular' }, fontSize: 14 });
    expect(bound).toEqual({});
    expect(log.at(-1)).toBe('bind fontSize=null');
    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' });
  });
});
