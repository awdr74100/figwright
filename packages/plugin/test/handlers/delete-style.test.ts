import type { StyleResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createDeleteStyleHandler } from '../../src/handlers/delete-style.js';

describe('delete_style handler', () => {
  it('removes the style and returns its captured id + name', async () => {
    const remove = vi.fn<() => void>();
    const style = { id: 'S:0', name: 'Brand/Primary', remove };
    const handler = createDeleteStyleHandler(
      { getStyleByIdAsync: async () => style } as unknown as typeof figma,
    );
    const result = (await handler({ styleId: 'S:0' })) as StyleResult;

    expect(remove).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, styleId: 'S:0', name: 'Brand/Primary' });
  });

  it('throws when missing or input is bad', async () => {
    const f = { getStyleByIdAsync: async () => null } as unknown as typeof figma;
    await expect(createDeleteStyleHandler(f)({ styleId: 'S:9' })).rejects.toThrow(/not found/);
    await expect(createDeleteStyleHandler(f)({})).rejects.toThrow(/styleId/);
  });
});
