import type { ModeResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createAddVariableModeHandler } from '../../src/handlers/add-variable-mode.js';

const fakeFigma = (collection: unknown): typeof figma =>
  ({
    variables: { getVariableCollectionByIdAsync: async () => collection },
  }) as unknown as typeof figma;

describe('add_variable_mode handler', () => {
  it('adds a mode to the collection and returns its id', async () => {
    const addMode = vi.fn<(name: string) => string>(() => 'M:1');
    const handler = createAddVariableModeHandler(fakeFigma({ id: 'VC:0', addMode }));
    const result = (await handler({ collectionId: 'VC:0', name: 'Dark' })) as ModeResult;

    expect(addMode).toHaveBeenCalledWith('Dark');
    expect(result).toEqual({ ok: true, modeId: 'M:1', name: 'Dark' });
  });

  it('throws when collection missing or input bad', async () => {
    await expect(
      createAddVariableModeHandler(fakeFigma(null))({ collectionId: 'VC:9', name: 'Dark' }),
    ).rejects.toThrow(/not found/);
    await expect(createAddVariableModeHandler(fakeFigma(null))({ name: 'Dark' })).rejects.toThrow(
      /collectionId/,
    );
  });
});
