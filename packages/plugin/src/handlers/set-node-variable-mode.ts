import type { VariableModeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

type ModeBearer = BaseNode & {
  explicitVariableModes: Readonly<Record<string, string>>;
  setExplicitVariableModeForCollection(collection: VariableCollection, modeId: string): void;
  clearExplicitVariableModeForCollection(collection: VariableCollection): void;
};

const bearsModes = (node: BaseNode): node is ModeBearer =>
  typeof (node as Partial<ModeBearer>).setExplicitVariableModeForCollection === 'function';

/**
 * Set (or clear) the mode a node renders a variable collection in. Every layer takes one, a layer
 * inside an instance included (Figma records it as an override of that instance), and so does a
 * page. The collection object is passed, not its id: the id overloads are deprecated and throw
 * under `documentAccess: "dynamic-page"`, which this plugin declares. The result is read back from
 * the node rather than assumed.
 */
export const createSetNodeVariableModeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; collectionId?: unknown; modeId?: unknown };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('set_node_variable_mode: nodeId must be a string');
    }
    if (typeof p.collectionId !== 'string') {
      throw new TypeError('set_node_variable_mode: collectionId must be a string');
    }
    if (p.modeId !== null && typeof p.modeId !== 'string') {
      throw new TypeError('set_node_variable_mode: modeId must be a mode id, or null to clear');
    }
    const modeId = p.modeId;

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null) throw new Error(`set_node_variable_mode: node ${p.nodeId} not found`);
    if (!bearsModes(node)) {
      throw new Error(
        `set_node_variable_mode: node ${p.nodeId} (${node.type}) cannot take a variable mode`,
      );
    }
    const collection = await figmaCtx.variables.getVariableCollectionByIdAsync(p.collectionId);
    if (collection === null) {
      throw new Error(
        `set_node_variable_mode: variable collection ${p.collectionId} not found — ` +
          'get_variable_defs lists the collections and their modes',
      );
    }

    let modeName: string | null = null;
    if (modeId === null) {
      node.clearExplicitVariableModeForCollection(collection);
    } else {
      const mode = collection.modes.find(m => m.modeId === modeId);
      if (mode === undefined) {
        const modes = collection.modes.map(m => `${m.name} (${m.modeId})`).join(', ');
        throw new Error(
          `set_node_variable_mode: mode ${modeId} is not in collection "${collection.name}" — ` +
            `its modes are ${modes}`,
        );
      }
      node.setExplicitVariableModeForCollection(collection, modeId);
      modeName = mode.name;
    }

    const now = node.explicitVariableModes[collection.id] ?? null;
    if (now !== modeId) {
      throw new Error(
        `set_node_variable_mode: Figma kept ${node.type} ${p.nodeId} on ` +
          `${now === null ? 'no explicit mode' : `mode ${now}`} for "${collection.name}"`,
      );
    }
    const result: VariableModeResult = {
      ok: true,
      nodeId: node.id,
      collectionId: collection.id,
      collectionName: collection.name,
      modeId,
      modeName,
    };
    return result;
  };
