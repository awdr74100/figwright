import { describe, expect, it } from 'vitest';

import { ALL_TOOL_SPECS } from '../packages/mcp/src/tools/registry.js';
import { WIRE_TOOL_SCHEMAS } from '../packages/mcp/src/tools/wire-schema.js';
import { project } from '../packages/plugin/src/handlers/get-design-context.js';
import { createSandboxHandlers } from '../packages/plugin/src/handlers/registry.js';
import { serializeFlatSync } from '../packages/plugin/src/serializer.js';
import { DesignContextNodeSchema, SerializedNodeSchema } from '../packages/shared/src/index.js';

// Figma is the external boundary. Schemas, dispatch, writes, reads and batch rollback stay real.
const setup = () => {
  const base = { name: 'Test', visible: true, locked: false, x: 0, y: 0, parent: null };
  const frame = {
    ...base,
    id: '1:1',
    type: 'FRAME',
    width: 100,
    height: 100,
    layoutAlign: 'INHERIT',
    layoutMode: 'NONE',
    clipsContent: true,
    cornerRadius: 12,
    cornerSmoothing: 0.2,
    relativeTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    resize(w: number, h: number) {
      if (w < 0.01 || h < 0.01) throw new Error('Invalid frame size');
      this.width = w;
      this.height = h;
    },
  };
  const line = {
    ...base,
    id: '1:2',
    type: 'LINE',
    width: 100,
    height: 0,
    relativeTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    resize(w: number, h: number) {
      if (w < 0.01 || h !== 0) throw new Error('Invalid line size');
      this.width = w;
      this.height = h;
    },
    resizeWithoutConstraints(w: number, h: number) {
      this.resize(w, h);
    },
  };
  const rectangle = { ...base, id: '1:3', type: 'RECTANGLE', cornerRadius: 4, fills: [] };
  const store: Record<string, unknown> = { '1:1': frame, '1:2': line, '1:3': rectangle };
  const figmaApi = {
    root: { children: [] },
    getNodeByIdAsync: async (id: string) => store[id] ?? null,
    currentPage: { children: [], selection: [] },
    variables: { getVariableByIdAsync: async () => null },
  } as unknown as typeof figma;
  const handlers = createSandboxHandlers(figmaApi);
  const call = async (name: string, input: Record<string, unknown>) => {
    const spec = ALL_TOOL_SPECS.find(tool => tool.name === name)!;
    return handlers[name]!(spec.inputSchema.parse(input));
  };
  const read = () => {
    const node = frame as unknown as SceneNode;
    return {
      flat: SerializedNodeSchema.parse(serializeFlatSync(node)),
      full: DesignContextNodeSchema.parse(project(node, 'full')),
    };
  };
  return { frame, line, rectangle, handlers, call, read };
};

describe('basic node property round-trips', () => {
  it.each([false, true])(
    'writes clipsContent=%s on a non-auto-layout frame and reads it back',
    async value => {
      const target = setup();
      await target.call('set_layout_props', { nodeId: '1:1', clipsContent: value });
      expect(target.frame.clipsContent).toBe(value);
      expect(target.read().flat).toMatchObject({ clipsContent: value });
      expect(target.read().full).toMatchObject({ clipsContent: value });
    },
  );

  it.each([0, 0.6, 1])('writes cornerSmoothing=%s without changing existing radii', async value => {
    const target = setup();
    await target.call('set_corner_radius', { nodeId: '1:1', cornerSmoothing: value });
    expect(target.frame).toMatchObject({ cornerRadius: 12, cornerSmoothing: value });
    expect(target.read().flat).toMatchObject({ cornerSmoothing: value });
    expect(target.read().full.cornerSmoothing).toBe(value === 0 ? undefined : value);
  });

  it('leaves smoothing unchanged on a radius-only edit', async () => {
    const target = setup();
    await target.call('set_corner_radius', { nodeId: '1:1', radius: 8 });
    expect(target.frame).toMatchObject({ cornerRadius: 8, cornerSmoothing: 0.2 });
  });

  it('resizes a line with its required zero height', async () => {
    const target = setup();
    expect(await target.call('resize_nodes', { nodeIds: ['1:2'], width: 240, height: 0 })).toEqual({
      ok: true,
      affected: ['1:2'],
    });
    expect(target.line).toMatchObject({ width: 240, height: 0 });
  });

  it.each([
    { nodeIds: ['1:2', '1:1'], width: 240, height: 0 },
    { nodeIds: ['1:1', '1:2'], width: 240, height: 10 },
  ])('checks every target before resizing a mixed line/frame request', async input => {
    const target = setup();
    await expect(target.call('resize_nodes', input)).rejects.toThrow(/height.*LINE|LINE.*height/);
    expect(target.line).toMatchObject({ width: 100, height: 0 });
    expect(target.frame).toMatchObject({ width: 100, height: 100 });
  });

  it('rejects unsupported smoothing before writing a radius', async () => {
    const target = setup();
    await expect(
      target.call('set_corner_radius', {
        nodeId: '1:3',
        radius: 12,
        cornerSmoothing: 0.6,
      }),
    ).rejects.toThrow(/cornerSmoothing/);
    expect(target.rectangle.cornerRadius).toBe(4);
  });

  it('rejects clipping on nodes without the property', async () => {
    const target = setup();
    await expect(
      target.call('set_layout_props', { nodeId: '1:3', clipsContent: false }),
    ).rejects.toThrow(/clipsContent/);
    expect(target.rectangle).not.toHaveProperty('clipsContent');
  });

  it.each([
    ['set_corner_radius', { nodeId: '1:1', cornerSmoothing: -0.1 }],
    ['set_corner_radius', { nodeId: '1:1', cornerSmoothing: 1.1 }],
    ['set_corner_radius', { nodeId: '1:1', cornerSmoothing: NaN }],
    ['set_layout_props', { nodeId: '1:1', clipsContent: 'false' }],
    ['resize_nodes', { nodeIds: ['1:2'], width: 0, height: 0 }],
    ['resize_nodes', { nodeIds: ['1:2'], width: 0.005, height: 0 }],
    ['resize_nodes', { nodeIds: ['1:2'], width: Infinity, height: 0 }],
    ['resize_nodes', { nodeIds: ['1:2'], width: 20, height: -1 }],
  ])('rejects invalid %s input at both validation boundaries', async (name, input) => {
    const target = setup();
    const spec = ALL_TOOL_SPECS.find(tool => tool.name === name)!;
    expect(spec.inputSchema.safeParse(input).success).toBe(false);
    expect(WIRE_TOOL_SCHEMAS.get(name)!.safeParse(input).success).toBe(false);
    await expect(target.handlers[name]!(input)).rejects.toThrow(/must be/);
    expect(target.frame).toMatchObject({ clipsContent: true, cornerSmoothing: 0.2 });
    expect(target.line.width).toBe(100);
  });

  it('restores clipping after a later batch operation fails', async () => {
    const target = setup();
    await expect(
      target.call('batch', {
        ops: [
          { tool: 'set_layout_props', params: { nodeId: '1:1', clipsContent: false } },
          { tool: 'set_fills', params: { nodeId: '1:3', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);
    expect(target.frame.clipsContent).toBe(true);
  });

  it('restores smoothing after a later batch operation fails', async () => {
    const target = setup();
    await expect(
      target.call('batch', {
        ops: [
          { tool: 'set_corner_radius', params: { nodeId: '1:1', radius: 8, cornerSmoothing: 0.8 } },
          { tool: 'set_fills', params: { nodeId: '1:3', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);
    expect(target.frame).toMatchObject({ cornerRadius: 12, cornerSmoothing: 0.2 });
  });

  it('restores a zero-height line after a later batch operation fails', async () => {
    const target = setup();
    await expect(
      target.call('batch', {
        ops: [
          { tool: 'resize_nodes', params: { nodeIds: ['1:2'], width: 240, height: 0 } },
          { tool: 'set_fills', params: { nodeId: '1:3', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);
    expect(target.line).toMatchObject({ width: 100, height: 0 });
  });
});
