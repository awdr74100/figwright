import type { CreateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createDetachInstanceHandler } from '../../src/handlers/detach-instance.js';

const withNode = (node: unknown): typeof figma =>
  ({ getNodeByIdAsync: async () => node }) as unknown as typeof figma;

describe('detach_instance handler', () => {
  it('detaches an instance and returns the resulting frame', async () => {
    const frame = { id: 'F:1', name: 'Card', type: 'FRAME' };
    const detachInstance = vi.fn<() => typeof frame>(() => frame);
    const instance = { id: '1:1', type: 'INSTANCE', detachInstance };
    const f = { getNodeByIdAsync: async () => instance } as unknown as typeof figma;

    const result = (await createDetachInstanceHandler(f)({ instanceId: '1:1' })) as CreateResult;
    expect(detachInstance).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, nodeId: 'F:1', name: 'Card', type: 'FRAME' });
  });

  it('throws on bad input or non-instance', async () => {
    await expect(createDetachInstanceHandler(withNode({}))({})).rejects.toThrow(/instanceId/);
    await expect(
      createDetachInstanceHandler(withNode({ id: '1:1', type: 'FRAME' }))({ instanceId: '1:1' }),
    ).rejects.toThrow(/not an INSTANCE/);
  });
});
