import type { VariableModeResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createBatchHandler } from '../../src/handlers/batch.js';
import { createSetNodeVariableModeHandler } from '../../src/handlers/set-node-variable-mode.js';

const COLLECTION = {
  id: 'VariableCollectionId:1:2',
  name: 'color',
  defaultModeId: '1:0',
  modes: [
    { modeId: '1:0', name: 'Light' },
    { modeId: '9:0', name: 'Dark' },
  ],
};

/** A node whose explicit modes behave like Figma's: set and clear take the collection object. */
const modeNode = (id: string, initial: Record<string, string> = {}) => {
  const modes: Record<string, string> = { ...initial };
  const calls: unknown[][] = [];
  return {
    id,
    type: 'FRAME',
    calls,
    get explicitVariableModes(): Record<string, string> {
      return { ...modes };
    },
    setExplicitVariableModeForCollection(collection: unknown, modeId: string) {
      calls.push(['set', collection, modeId]);
      modes[(collection as { id: string }).id] = modeId;
    },
    clearExplicitVariableModeForCollection(collection: unknown) {
      calls.push(['clear', collection]);
      delete modes[(collection as { id: string }).id];
    },
  };
};

const ctx = (nodes: Record<string, unknown>): typeof figma =>
  ({
    root: { children: [] },
    currentPage: { id: '0:1' },
    getNodeByIdAsync: async (id: string) => nodes[id] ?? null,
    variables: {
      getVariableCollectionByIdAsync: async (id: string) =>
        id === COLLECTION.id ? COLLECTION : null,
    },
  }) as unknown as typeof figma;

describe('set_node_variable_mode handler', () => {
  it('switches the node by passing the collection object, and names the mode', async () => {
    const frame = modeNode('1:1');
    const result = (await createSetNodeVariableModeHandler(ctx({ '1:1': frame }))({
      nodeId: '1:1',
      collectionId: COLLECTION.id,
      modeId: '9:0',
    })) as VariableModeResult;

    expect(result).toEqual({
      ok: true,
      nodeId: '1:1',
      collectionId: COLLECTION.id,
      collectionName: 'color',
      modeId: '9:0',
      modeName: 'Dark',
    });
    // The id overload is deprecated and throws under dynamic-page: the object must be what is passed.
    expect(frame.calls).toEqual([['set', COLLECTION, '9:0']]);
    expect(frame.explicitVariableModes).toEqual({ [COLLECTION.id]: '9:0' });
  });

  it('clears the setting with modeId null so the node inherits again', async () => {
    const frame = modeNode('1:1', { [COLLECTION.id]: '9:0' });
    const result = (await createSetNodeVariableModeHandler(ctx({ '1:1': frame }))({
      nodeId: '1:1',
      collectionId: COLLECTION.id,
      modeId: null,
    })) as VariableModeResult;

    expect(result).toMatchObject({ modeId: null, modeName: null });
    expect(frame.explicitVariableModes).toEqual({});
  });

  it('refuses a mode from another collection and lists the ones it has, before writing', async () => {
    const frame = modeNode('1:1');
    await expect(
      createSetNodeVariableModeHandler(ctx({ '1:1': frame }))({
        nodeId: '1:1',
        collectionId: COLLECTION.id,
        modeId: '5:0',
      }),
    ).rejects.toThrow('its modes are Light (1:0), Dark (9:0)');
    expect(frame.calls).toEqual([]);
  });

  it('refuses an unknown collection, a missing node, and a node that takes no modes', async () => {
    const handler = createSetNodeVariableModeHandler(
      ctx({ '1:1': modeNode('1:1'), '1:2': { id: '1:2', type: 'TEXT' } }),
    );
    await expect(
      handler({ nodeId: '1:1', collectionId: 'VariableCollectionId:x', modeId: '9:0' }),
    ).rejects.toThrow('variable collection VariableCollectionId:x not found');
    await expect(
      handler({ nodeId: '9:9', collectionId: COLLECTION.id, modeId: '9:0' }),
    ).rejects.toThrow('node 9:9 not found');
    await expect(
      handler({ nodeId: '1:2', collectionId: COLLECTION.id, modeId: '9:0' }),
    ).rejects.toThrow('(TEXT) cannot take a variable mode');
  });

  it('reports a write Figma did not keep instead of claiming it', async () => {
    const stubborn = { ...modeNode('1:1'), setExplicitVariableModeForCollection: () => {} };
    await expect(
      createSetNodeVariableModeHandler(ctx({ '1:1': stubborn }))({
        nodeId: '1:1',
        collectionId: COLLECTION.id,
        modeId: '9:0',
      }),
    ).rejects.toThrow('Figma kept FRAME 1:1 on no explicit mode');
  });

  it('requires modeId to be given — a missing one is not a clear', async () => {
    await expect(
      createSetNodeVariableModeHandler(ctx({ '1:1': modeNode('1:1') }))({
        nodeId: '1:1',
        collectionId: COLLECTION.id,
      }),
    ).rejects.toThrow('modeId must be a mode id, or null to clear');
  });
});

describe('set_node_variable_mode in a batch', () => {
  // A batchable op that fails: the same tool, with a mode the collection does not have.
  const FAIL = {
    tool: 'set_node_variable_mode',
    params: { nodeId: '1:1', collectionId: COLLECTION.id, modeId: '5:0' },
  };
  const run = (frame: ReturnType<typeof modeNode>, modeId: string | null) => {
    const figmaCtx = ctx({ '1:1': frame });
    const handler = createBatchHandler(figmaCtx, {
      set_node_variable_mode: createSetNodeVariableModeHandler(figmaCtx),
    });
    return handler({
      ops: [
        {
          tool: 'set_node_variable_mode',
          params: { nodeId: '1:1', collectionId: COLLECTION.id, modeId },
        },
        FAIL,
      ],
    });
  };

  it('clears a mode the op set on a node that inherited', async () => {
    const frame = modeNode('1:1');
    await expect(run(frame, '9:0')).rejects.toThrow(/rolled back 1/);
    expect(frame.explicitVariableModes).toEqual({});
  });

  it('puts back the mode the node had, rather than clearing it', async () => {
    const frame = modeNode('1:1', { [COLLECTION.id]: '1:0', other: 'o:1' });
    await expect(run(frame, '9:0')).rejects.toThrow(/rolled back 1/);
    expect(frame.explicitVariableModes).toEqual({ [COLLECTION.id]: '1:0', other: 'o:1' });
  });

  it('clears rather than fails when the previous mode was deleted from the collection', async () => {
    // Figma keeps a deleted mode on the node; setting it again would throw, clearing renders the same.
    const frame = modeNode('1:1', { [COLLECTION.id]: '5:5' });
    await expect(run(frame, '9:0')).rejects.toThrow(/rolled back 1/);
    expect(frame.explicitVariableModes).toEqual({});
    expect(frame.calls.at(-1)?.[0]).toBe('clear');
  });

  it('puts back a mode the op cleared', async () => {
    const frame = modeNode('1:1', { [COLLECTION.id]: '9:0' });
    await expect(run(frame, null)).rejects.toThrow(/rolled back 1/);
    expect(frame.explicitVariableModes).toEqual({ [COLLECTION.id]: '9:0' });
  });
});
