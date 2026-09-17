import type { CreateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateConnectorHandler } from '../../src/handlers/create-connector.js';

const makeConnector = () => ({
  id: '3:1',
  name: 'Connector',
  type: 'CONNECTOR',
  connectorStart: { position: { x: 0, y: 0 } } as unknown,
  connectorEnd: { position: { x: 0, y: 0 } } as unknown,
  connectorLineType: 'ELBOWED' as unknown,
  connectorStartStrokeCap: 'NONE' as unknown,
  connectorEndStrokeCap: 'ARROW_LINES' as unknown,
  strokes: [] as unknown,
  strokeWeight: 4,
  text: { fontName: undefined as unknown, characters: '' },
  remove: vi.fn<() => void>(),
});

const fakeFigma = (
  connector: ReturnType<typeof makeConnector>,
  currentPage: { appendChild: (n: unknown) => void },
  lookup: Record<string, unknown> = {},
  loadFontAsync = vi.fn<() => Promise<void>>(async () => {}),
): typeof figma =>
  ({
    createConnector: () => connector,
    currentPage,
    loadFontAsync,
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
  }) as unknown as typeof figma;

describe('create_connector handler', () => {
  it('attaches both endpoints to nodes with default AUTO magnet', async () => {
    const connector = makeConnector();
    const currentPage = { appendChild: vi.fn<(n: unknown) => void>() };
    const handler = createCreateConnectorHandler(fakeFigma(connector, currentPage));
    const result = (await handler({
      connectorStart: { endpointNodeId: '1:1' },
      connectorEnd: { endpointNodeId: '1:2', magnet: 'LEFT' },
    })) as CreateResult;

    expect(connector.connectorStart).toEqual({ endpointNodeId: '1:1', magnet: 'AUTO' });
    expect(connector.connectorEnd).toEqual({ endpointNodeId: '1:2', magnet: 'LEFT' });
    expect(currentPage.appendChild).toHaveBeenCalledWith(connector);
    expect(result).toEqual({ ok: true, nodeId: '3:1', name: 'Connector', type: 'CONNECTOR' });
  });

  it('supports a floating endpoint and a relative-position endpoint', async () => {
    const connector = makeConnector();
    const handler = createCreateConnectorHandler(
      fakeFigma(connector, { appendChild: vi.fn<(n: unknown) => void>() }),
    );
    await handler({
      connectorStart: { position: { x: 100, y: 200 } },
      connectorEnd: { endpointNodeId: '1:1', position: { x: 1, y: 0.5 } },
    });

    expect(connector.connectorStart).toEqual({ position: { x: 100, y: 200 } });
    expect(connector.connectorEnd).toEqual({
      position: { x: 1, y: 0.5 },
      endpointNodeId: '1:1',
    });
  });

  it('sets line type, stroke caps, strokes, and strokeWeight', async () => {
    const connector = makeConnector();
    const handler = createCreateConnectorHandler(
      fakeFigma(connector, { appendChild: vi.fn<(n: unknown) => void>() }),
    );
    await handler({
      connectorStart: { position: { x: 0, y: 0 } },
      connectorEnd: { position: { x: 100, y: 0 } },
      connectorLineType: 'STRAIGHT',
      connectorStartStrokeCap: 'DIAMOND_FILLED',
      connectorEndStrokeCap: 'CIRCLE_FILLED',
      strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0 } }],
      strokeWeight: 2,
    });

    expect(connector.connectorLineType).toBe('STRAIGHT');
    expect(connector.connectorStartStrokeCap).toBe('DIAMOND_FILLED');
    expect(connector.connectorEndStrokeCap).toBe('CIRCLE_FILLED');
    expect(connector.strokes).toEqual([
      { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true },
    ]);
    expect(connector.strokeWeight).toBe(2);
  });

  it('loads the default font before writing a label, unlike a fresh TextNode', async () => {
    const connector = makeConnector();
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
    const handler = createCreateConnectorHandler(
      fakeFigma(connector, { appendChild: vi.fn<(n: unknown) => void>() }, {}, loadFontAsync),
    );
    await handler({
      connectorStart: { position: { x: 0, y: 0 } },
      connectorEnd: { position: { x: 100, y: 0 } },
      text: 'depends on',
    });

    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' });
    expect(connector.text.fontName).toEqual({ family: 'Inter', style: 'Regular' });
    expect(connector.text.characters).toBe('depends on');
  });

  it('appends to a given parent', async () => {
    const connector = makeConnector();
    const parent = { id: '1:1', appendChild: vi.fn<(n: unknown) => void>() };
    const handler = createCreateConnectorHandler(
      fakeFigma(connector, { appendChild: vi.fn<(n: unknown) => void>() }, { '1:1': parent }),
    );
    await handler({
      parentId: '1:1',
      connectorStart: { position: { x: 0, y: 0 } },
      connectorEnd: { position: { x: 100, y: 0 } },
    });

    expect(parent.appendChild).toHaveBeenCalledWith(connector);
  });

  it('removes the orphan and throws on an invalid parent', async () => {
    const connector = makeConnector();
    const handler = createCreateConnectorHandler(
      fakeFigma(connector, { appendChild: vi.fn<(n: unknown) => void>() }, {}),
    );
    await expect(
      handler({
        parentId: '9:9',
        connectorStart: { position: { x: 0, y: 0 } },
        connectorEnd: { position: { x: 100, y: 0 } },
      }),
    ).rejects.toThrow(/parent/);
    expect(connector.remove).toHaveBeenCalled();
  });

  it('rejects missing endpoints and an endpoint with neither field', async () => {
    const handler = createCreateConnectorHandler(
      fakeFigma(makeConnector(), { appendChild: vi.fn<(n: unknown) => void>() }),
    );
    await expect(handler({ connectorEnd: { position: { x: 0, y: 0 } } })).rejects.toThrow(
      /connectorStart/,
    );
    await expect(handler({ connectorStart: { position: { x: 0, y: 0 } } })).rejects.toThrow(
      /connectorEnd/,
    );
    await expect(
      handler({ connectorStart: {}, connectorEnd: { position: { x: 0, y: 0 } } }),
    ).rejects.toThrow(/connectorStart needs/);
  });

  it('rejects a bad strokeWeight and non-string text', async () => {
    const handler = createCreateConnectorHandler(
      fakeFigma(makeConnector(), { appendChild: vi.fn<(n: unknown) => void>() }),
    );
    const base = {
      connectorStart: { position: { x: 0, y: 0 } },
      connectorEnd: { position: { x: 100, y: 0 } },
    };
    await expect(handler({ ...base, strokeWeight: -1 })).rejects.toThrow(/strokeWeight/);
    await expect(handler({ ...base, text: 42 })).rejects.toThrow(/text/);
  });
});
