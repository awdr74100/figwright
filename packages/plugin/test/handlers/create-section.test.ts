import type { CreateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateSectionHandler } from '../../src/handlers/create-section.js';

const makeSection = () => {
  const node = {
    id: '2:1',
    name: 'Section',
    type: 'SECTION',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    resizeWithoutConstraints(w: number, h: number) {
      node.width = w;
      node.height = h;
    },
    remove: vi.fn<() => void>(),
  };
  return node;
};

const fakeFigma = (
  node: ReturnType<typeof makeSection>,
  page: { appendChild: (n: unknown) => void },
): typeof figma =>
  ({
    createSection: () => node,
    currentPage: page,
    getNodeByIdAsync: async () => null,
  }) as unknown as typeof figma;

describe('create_section handler', () => {
  it('creates, sizes via resizeWithoutConstraints, names, and appends', async () => {
    const node = makeSection();
    const appendChild = vi.fn<(n: unknown) => void>();
    const handler = createCreateSectionHandler(fakeFigma(node, { appendChild }));
    const result = (await handler({ name: 'Flows', width: 800, height: 600 })) as CreateResult;

    expect(node.name).toBe('Flows');
    expect([node.width, node.height]).toEqual([800, 600]);
    expect(appendChild).toHaveBeenCalledWith(node);
    expect(result).toEqual({ ok: true, nodeId: '2:1', name: 'Flows', type: 'SECTION' });
  });
});
