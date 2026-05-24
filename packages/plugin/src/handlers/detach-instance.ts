import type { CreateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Detach an instance into a plain frame. Returns the resulting frame's id / name / type. */
export const createDetachInstanceHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { instanceId?: unknown };
    if (typeof p.instanceId !== 'string') {
      throw new TypeError('detach_instance: instanceId must be a string');
    }

    const instance = await figmaCtx.getNodeByIdAsync(p.instanceId);
    if (instance === null || instance.type !== 'INSTANCE') {
      throw new Error(`detach_instance: node ${p.instanceId} is not an INSTANCE`);
    }
    const frame = (instance as InstanceNode).detachInstance();

    const result: CreateResult = { ok: true, nodeId: frame.id, name: frame.name, type: frame.type };
    return result;
  };
