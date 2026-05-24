import type { MutateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createSwapComponentHandler } from '../../src/handlers/swap-component.js';

const withNode = (node: unknown): typeof figma =>
  ({ getNodeByIdAsync: async () => node }) as unknown as typeof figma;

describe('swap_component handler', () => {
  it('swaps using a local componentId', async () => {
    const swapComponent = vi.fn<() => void>();
    const instance = { id: '1:1', type: 'INSTANCE', swapComponent };
    const component = { id: 'C:1', type: 'COMPONENT' };
    const lookup: Record<string, unknown> = { '1:1': instance, 'C:1': component };
    const f = {
      getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
    } as unknown as typeof figma;

    const result = (await createSwapComponentHandler(f)({
      instanceId: '1:1',
      componentId: 'C:1',
    })) as MutateResult;
    expect(swapComponent).toHaveBeenCalledWith(component);
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('swaps using a published componentKey', async () => {
    const swapComponent = vi.fn<() => void>();
    const instance = { id: '1:1', type: 'INSTANCE', swapComponent };
    const imported = { id: 'C:9', type: 'COMPONENT' };
    const importComponentByKeyAsync = vi.fn<() => Promise<unknown>>(async () => imported);
    const f = {
      getNodeByIdAsync: async () => instance,
      importComponentByKeyAsync,
    } as unknown as typeof figma;

    await createSwapComponentHandler(f)({ instanceId: '1:1', componentKey: 'abc123' });
    expect(importComponentByKeyAsync).toHaveBeenCalledWith('abc123');
    expect(swapComponent).toHaveBeenCalledWith(imported);
  });

  it('throws on bad input or non-instance', async () => {
    await expect(createSwapComponentHandler(withNode({}))({ componentId: 'C:1' })).rejects.toThrow(
      /instanceId/,
    );
    await expect(createSwapComponentHandler(withNode({}))({ instanceId: '1:1' })).rejects.toThrow(
      /componentId or componentKey/,
    );
    await expect(
      createSwapComponentHandler(withNode({ id: '1:1', type: 'FRAME' }))({
        instanceId: '1:1',
        componentId: 'C:1',
      }),
    ).rejects.toThrow(/not an INSTANCE/);
  });
});
