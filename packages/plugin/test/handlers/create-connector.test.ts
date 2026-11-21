import type { CreateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateConnectorHandler } from '../../src/handlers/create-connector.js';

/**
 * A connector that behaves like FigJam's where the handler depends on it (measured 2026-11-21):
 * assigning an end attached to a node Figma does not accept throws "Invalid endpointNodeId", and
 * writing a label throws until Inter Medium — the face Figma writes it in — is loaded.
 */
const makeFigJam = (opts: { nodes?: Record<string, unknown>; refused?: string[] } = {}) => {
  const loaded = new Set<string>();
  const removed = vi.fn<() => void>();
  let label = '';
  const ends: Record<string, unknown> = {};
  const connector: Record<string, unknown> = {
    id: '3:1',
    name: 'Connector line',
    type: 'CONNECTOR',
    connectorLineType: 'ELBOWED',
    connectorStartStrokeCap: 'NONE',
    connectorEndStrokeCap: 'ARROW_LINES',
    strokes: [],
    strokeWeight: 4,
    remove: removed,
    text: {
      get characters() {
        return label;
      },
      set characters(v: string) {
        if (!loaded.has('Inter Medium')) {
          throw new Error(
            'in set_characters: Cannot write to node with unloaded font "Inter Medium"',
          );
        }
        label = v;
        connector.name = v;
      },
    },
  };
  for (const side of ['connectorStart', 'connectorEnd']) {
    Object.defineProperty(connector, side, {
      get: () => ends[side],
      set: (v: { endpointNodeId?: string }) => {
        if (v.endpointNodeId !== undefined && (opts.refused ?? []).includes(v.endpointNodeId)) {
          throw new Error(`in set_${side}: Invalid endpointNodeId`);
        }
        ends[side] = v;
      },
    });
  }
  const currentPage = { appendChild: vi.fn<(n: unknown) => void>() };
  const createConnector = vi.fn<() => unknown>(() => connector);
  const loadFontAsync = vi.fn<(f: FontName) => Promise<void>>(async f => {
    loaded.add(`${f.family} ${f.style}`);
  });
  const figmaCtx = {
    createConnector,
    currentPage,
    loadFontAsync,
    getNodeByIdAsync: async (id: string) => (opts.nodes ?? {})[id] ?? null,
    variables: { getVariableByIdAsync: async () => null },
  } as unknown as typeof figma;
  return { figmaCtx, connector, currentPage, createConnector, removed, loadFontAsync };
};

const NODES = { '1:1': { id: '1:1' }, '1:2': { id: '1:2' } };
const FLOAT = {
  connectorStart: { position: { x: 0, y: 0 } },
  connectorEnd: { position: { x: 100, y: 0 } },
};

describe('create_connector', () => {
  it('attaches to a side of each node, AUTO by default', async () => {
    const f = makeFigJam({ nodes: NODES });
    const result = (await createCreateConnectorHandler(f.figmaCtx)({
      connectorStart: { endpointNodeId: '1:1' },
      connectorEnd: { endpointNodeId: '1:2', magnet: 'LEFT' },
    })) as CreateResult;

    expect(f.connector.connectorStart).toEqual({ endpointNodeId: '1:1', magnet: 'AUTO' });
    expect(f.connector.connectorEnd).toEqual({ endpointNodeId: '1:2', magnet: 'LEFT' });
    // Figma has placed it by its ends; with no parent named it is not moved (see the test below).
    expect(f.currentPage.appendChild).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, nodeId: '3:1', name: 'Connector line', type: 'CONNECTOR' });
  });

  it('attaches at a point on a node and floats an end, handing Figma the px it was given', async () => {
    const f = makeFigJam({ nodes: NODES });
    await createCreateConnectorHandler(f.figmaCtx)({
      connectorStart: { position: { x: 100, y: 200 } },
      connectorEnd: { endpointNodeId: '1:1', position: { x: 240, y: 120 } },
    });
    expect(f.connector.connectorStart).toEqual({ position: { x: 100, y: 200 } });
    expect(f.connector.connectorEnd).toEqual({
      position: { x: 240, y: 120 },
      endpointNodeId: '1:1',
    });
  });

  it('refuses an end given both a magnet and a position, rather than drop the magnet', async () => {
    const f = makeFigJam({ nodes: NODES });
    await expect(
      createCreateConnectorHandler(f.figmaCtx)({
        connectorStart: { endpointNodeId: '1:1', magnet: 'TOP', position: { x: 1, y: 1 } },
        connectorEnd: { position: { x: 0, y: 0 } },
      }),
    ).rejects.toThrow(/takes a magnet or a position, not both/);
    expect(f.createConnector).not.toHaveBeenCalled();
  });

  // Measured: Figma refuses an end on an id it cannot attach to only when it is assigned — at once,
  // where looking the id up first can stall 10 s on Figma's server. So the assignment is the check,
  // and the connector made for it is removed.
  it('removes the connector when Figma refuses an end, naming the side and the id', async () => {
    const f = makeFigJam({ refused: ['9:9'] });
    await expect(
      createCreateConnectorHandler(f.figmaCtx)({
        connectorStart: { position: { x: 0, y: 0 } },
        connectorEnd: { endpointNodeId: '9:9' },
      }),
    ).rejects.toThrow(
      /connectorEnd.endpointNodeId 9:9 is not a node this connector can attach to \(Figma: in set_connectorEnd: Invalid endpointNodeId\)/,
    );
    expect(f.removed).toHaveBeenCalledOnce();
    expect(f.currentPage.appendChild).not.toHaveBeenCalled();
  });

  it('looks no end’s node up before making the connector — Figma’s own refusal is the check', async () => {
    const f = makeFigJam({ nodes: NODES });
    const lookup = vi.spyOn(f.figmaCtx, 'getNodeByIdAsync');
    await createCreateConnectorHandler(f.figmaCtx)({
      connectorStart: { endpointNodeId: '1:1' },
      connectorEnd: { endpointNodeId: '1:2' },
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('removes the connector when a later write fails too, leaving no orphan', async () => {
    const f = makeFigJam();
    Object.defineProperty(f.connector, 'strokeWeight', {
      set: () => {
        throw new Error('in set_strokeWeight: refused');
      },
    });
    await expect(
      createCreateConnectorHandler(f.figmaCtx)({ ...FLOAT, strokeWeight: 3 }),
    ).rejects.toThrow(/refused/);
    expect(f.removed).toHaveBeenCalledOnce();
  });

  it('loads FigJam’s caption face before making the connector, then writes the label', async () => {
    const f = makeFigJam();
    const result = (await createCreateConnectorHandler(f.figmaCtx)({
      ...FLOAT,
      text: 'depends on',
    })) as CreateResult;
    expect(f.loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Medium' });
    expect(f.loadFontAsync.mock.invocationCallOrder[0]).toBeLessThan(
      f.createConnector.mock.invocationCallOrder[0]!,
    );
    expect((f.connector.text as { characters: string }).characters).toBe('depends on');
    expect(result.name).toBe('depends on');
  });

  it('makes nothing when the label’s face cannot be loaded', async () => {
    const f = makeFigJam();
    f.loadFontAsync.mockRejectedValueOnce(new Error('font unavailable'));
    await expect(createCreateConnectorHandler(f.figmaCtx)({ ...FLOAT, text: 'x' })).rejects.toThrow(
      /font unavailable/,
    );
    expect(f.createConnector).not.toHaveBeenCalled();
  });

  it('loads no face for a connector with no label', async () => {
    const f = makeFigJam();
    await createCreateConnectorHandler(f.figmaCtx)(FLOAT);
    expect(f.loadFontAsync).not.toHaveBeenCalled();
  });

  it('sets the path shape, both caps, the strokes and the weight', async () => {
    const f = makeFigJam();
    await createCreateConnectorHandler(f.figmaCtx)({
      ...FLOAT,
      connectorLineType: 'STRAIGHT',
      connectorStartStrokeCap: 'DIAMOND_FILLED',
      connectorEndStrokeCap: 'ERD_MANY',
      strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0 } }],
      strokeWeight: 2,
    });
    expect(f.connector).toMatchObject({
      connectorLineType: 'STRAIGHT',
      connectorStartStrokeCap: 'DIAMOND_FILLED',
      connectorEndStrokeCap: 'ERD_MANY',
      strokes: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true }],
      strokeWeight: 2,
    });
  });

  // Measured: assigning the ends moves a connector into the section (or frame) its two nodes share,
  // as FigJam's own connector tool places one; putting it on the current page pulled it out of that
  // section, so reading or diffing the section left it out.
  it('leaves the connector where Figma put it by its ends when no parent is named', async () => {
    const f = makeFigJam({ nodes: NODES });
    const section = { id: '7:7', type: 'SECTION' };
    Object.defineProperty(f.connector, 'parent', { get: () => section });
    await createCreateConnectorHandler(f.figmaCtx)({
      connectorStart: { endpointNodeId: '1:1' },
      connectorEnd: { endpointNodeId: '1:2' },
    });
    expect(f.currentPage.appendChild).not.toHaveBeenCalled();
    expect((f.connector as { parent: unknown }).parent).toBe(section);
  });

  it('goes into the parent it is given, and removes itself if that parent refuses it', async () => {
    const parent = { id: '1:1', type: 'SECTION', appendChild: vi.fn<(n: unknown) => void>() };
    const f = makeFigJam({ nodes: { '1:1': parent } });
    await createCreateConnectorHandler(f.figmaCtx)({ ...FLOAT, parentId: '1:1' });
    expect(parent.appendChild).toHaveBeenCalledWith(f.connector);

    const g = makeFigJam();
    await expect(
      createCreateConnectorHandler(g.figmaCtx)({ ...FLOAT, parentId: '9:9' }),
    ).rejects.toThrow(/parent/);
    expect(g.removed).toHaveBeenCalled();
  });

  it('says that connectors are FigJam layers where the editor has none', async () => {
    // Measured: in Figma Design createConnector is missing, and calling it said only "not a function".
    const f = makeFigJam();
    delete (f.figmaCtx as { createConnector?: unknown }).createConnector;
    await expect(createCreateConnectorHandler(f.figmaCtx)(FLOAT)).rejects.toThrow(
      /connectors are FigJam layers, and this file is not a FigJam board/,
    );
  });

  it('refuses what it cannot hand Figma', async () => {
    const run = createCreateConnectorHandler(makeFigJam().figmaCtx);
    for (const [args, message] of [
      [{ connectorEnd: FLOAT.connectorEnd }, /connectorStart is required/],
      [{ connectorStart: FLOAT.connectorStart }, /connectorEnd is required/],
      [{ connectorStart: {}, connectorEnd: FLOAT.connectorEnd }, /connectorStart needs/],
      [
        { connectorStart: { position: { x: Number.NaN, y: 0 } }, connectorEnd: FLOAT.connectorEnd },
        /position must be \{ x, y \} finite numbers/,
      ],
      [{ ...FLOAT, strokeWeight: -1 }, /strokeWeight/],
      [{ ...FLOAT, strokeWeight: Number.NaN }, /strokeWeight/],
      [{ ...FLOAT, text: 42 }, /text must be a string/],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop -- each case in turn
      await expect(run(args as Record<string, unknown>)).rejects.toThrow(message);
    }
  });
});
