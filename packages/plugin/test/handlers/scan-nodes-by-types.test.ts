import type { ScanNodesByTypesResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createScanNodesByTypesHandler } from '../../src/handlers/scan-nodes-by-types.js';

const fake = (id: string, type: string, children?: SceneNode[]): SceneNode =>
  ({
    id,
    name: id,
    type,
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    parent: { id: 'root' },
    children,
  }) as unknown as SceneNode;

const fakeFigma = (
  pageChildren: SceneNode[],
  lookup: Record<string, BaseNode | null> = {},
): typeof figma =>
  ({
    currentPage: { children: pageChildren },
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
  }) as unknown as typeof figma;

const page = (): SceneNode[] => [
  fake('1:1', 'FRAME', [fake('1:2', 'COMPONENT'), fake('1:3', 'TEXT')]),
  fake('1:4', 'INSTANCE'),
];

describe('scan_nodes_by_types handler', () => {
  it('collects nodes whose type is in the list', async () => {
    const handler = createScanNodesByTypesHandler(fakeFigma(page()));
    const result = (await handler({ types: ['COMPONENT', 'INSTANCE'] })) as ScanNodesByTypesResult;
    expect(result.nodes.map(n => n.id)).toEqual(['1:2', '1:4']);
  });

  it('throws when types is missing, empty, or not all strings', async () => {
    const handler = createScanNodesByTypesHandler(fakeFigma(page()));
    await expect(handler({})).rejects.toThrow(/types/);
    await expect(handler({ types: [] })).rejects.toThrow(/types/);
    await expect(handler({ types: ['TEXT', 1] })).rejects.toThrow(/types/);
  });

  it('bounds lookups on a large page while preserving every match, order, and component metadata', async () => {
    let pending = 0;
    let peak = 0;
    const instances = Array.from({ length: 1025 }, (_, index) =>
      Object.assign(fake(`2:${index}`, 'INSTANCE'), {
        getMainComponentAsync: async () => {
          pending += 1;
          peak = Math.max(peak, pending);
          await Promise.resolve();
          if (index % 2 === 0) await Promise.resolve();
          pending -= 1;
          return { id: `3:${index}`, name: `Component ${index}`, key: `key-${index}` };
        },
      }),
    );
    const root = { type: 'PAGE', children: instances } as unknown as PageNode;
    const handler = createScanNodesByTypesHandler(fakeFigma([], { '1:1': root }));
    const result = (await handler({ root: '1:1', types: ['INSTANCE'] })) as ScanNodesByTypesResult;

    expect(result.nodes.map(node => node.id)).toEqual(instances.map(node => node.id));
    expect(result.nodes.map(node => node.mainComponent)).toEqual(
      instances.map((_, index) => ({
        id: `3:${index}`,
        name: `Component ${index}`,
        key: `key-${index}`,
      })),
    );
    expect(result.nodes.every(node => node.children === undefined)).toBe(true);
    expect(peak).toBeLessThanOrEqual(512);
  });

  it('lets host timers run before all large-scan matches are serialized', async () => {
    let lookups = 0;
    const instances = Array.from({ length: 1025 }, (_, index) =>
      Object.assign(fake(`2:${index}`, 'INSTANCE'), {
        getMainComponentAsync: async () => {
          lookups += 1;
          return null;
        },
      }),
    );
    const handler = createScanNodesByTypesHandler(fakeFigma(instances));
    const hostTick = new Promise<number>(resolve => setTimeout(() => resolve(lookups), 0));
    const result = (await handler({ types: ['INSTANCE'] })) as ScanNodesByTypesResult;

    expect(result.nodes).toHaveLength(instances.length);
    expect(await hostTick).toBeLessThan(instances.length);
  });
});
