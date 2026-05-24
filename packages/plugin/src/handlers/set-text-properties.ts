import type { MutateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * Set a TEXT node's layout/overflow props. These are node-level (not per-run) and don't require a
 * font load, unlike characters/fontSize. Applied in order autoResize → truncation → maxLines because
 * maxLines only takes effect once truncation is ENDING.
 */
export const createSetTextPropertiesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      textTruncation?: unknown;
      maxLines?: unknown;
      textAutoResize?: unknown;
    };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_text_properties: nodeId must be a string');
    if (p.textAutoResize !== undefined && typeof p.textAutoResize !== 'string') {
      throw new TypeError('set_text_properties: textAutoResize must be a string');
    }
    if (p.textTruncation !== undefined && typeof p.textTruncation !== 'string') {
      throw new TypeError('set_text_properties: textTruncation must be a string');
    }
    if (p.maxLines !== undefined && p.maxLines !== null && typeof p.maxLines !== 'number') {
      throw new TypeError('set_text_properties: maxLines must be a number or null');
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || node.type !== 'TEXT') {
      throw new Error(`set_text_properties: node ${p.nodeId} is not a TEXT node`);
    }
    const text = node as TextNode;

    if (p.textAutoResize !== undefined) text.textAutoResize = p.textAutoResize as TextNode['textAutoResize'];
    if (p.textTruncation !== undefined) text.textTruncation = p.textTruncation as TextNode['textTruncation'];
    if (p.maxLines !== undefined) text.maxLines = p.maxLines as number | null;

    const result: MutateResult = { ok: true, nodeId: text.id };
    return result;
  };
