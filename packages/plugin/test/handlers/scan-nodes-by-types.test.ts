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

const fakeFigma = (pageChildren: SceneNode[]): typeof figma =>
  ({
    currentPage: { children: pageChildren },
    getNodeByIdAsync: async () => null,
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
});
