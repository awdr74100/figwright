import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const LAYOUT_MODES = new Set(['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID']);

type AutoLayoutTarget = {
  layoutMode: string;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  itemSpacing: number;
  primaryAxisAlignItems: string;
  counterAxisAlignItems: string;
  layoutWrap: string;
  counterAxisSpacing: number | null;
  counterAxisAlignContent: string;
  gridRowCount: number;
  gridColumnCount: number;
  gridRowGap: number;
  gridColumnGap: number;
};

export const createSetAutoLayoutHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as Record<string, unknown>;
    if (typeof p.nodeId !== 'string')
      throw new TypeError('set_auto_layout: nodeId must be a string');
    if (typeof p.layoutMode !== 'string' || !LAYOUT_MODES.has(p.layoutMode)) {
      throw new TypeError(
        'set_auto_layout: layoutMode must be NONE / HORIZONTAL / VERTICAL / GRID',
      );
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('layoutMode' in node)) {
      throw new Error(`set_auto_layout: node ${p.nodeId} not found or has no auto layout`);
    }
    const target = node as unknown as AutoLayoutTarget;

    // Wrap cross-axis (counterAxisSpacing / counterAxisAlignContent → CSS row-gap /
    // align-content) is only meaningful on a wrapping flex. Validate BEFORE any mutation —
    // this is a contradiction in the inputs, and rejecting it after layoutWrap was already
    // applied would leave a partial change behind (caught live). Rejected loudly rather than
    // deferred to Figma, whose silent ignore is the worst failure mode for an authoring tool.
    const wantsCrossAxis =
      p.counterAxisSpacing !== undefined || p.counterAxisAlignContent !== undefined;
    if (wantsCrossAxis && (p.layoutMode === 'HORIZONTAL' || p.layoutMode === 'VERTICAL')) {
      const effectiveWrap = typeof p.layoutWrap === 'string' ? p.layoutWrap : target.layoutWrap;
      if (effectiveWrap !== 'WRAP') {
        throw new Error(
          'set_auto_layout: counterAxisSpacing / counterAxisAlignContent apply only to a ' +
            'wrapping flex — pass layoutWrap: "WRAP" (in this call or before)',
        );
      }
    }

    // Set the mode first: grid counts / gaps only become writable once layoutMode is GRID.
    target.layoutMode = p.layoutMode;

    if (p.layoutMode !== 'NONE') {
      // padding is common to HORIZONTAL / VERTICAL / GRID
      for (const key of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) {
        if (typeof p[key] === 'number') target[key] = p[key] as number;
      }
      if (p.layoutMode === 'GRID') {
        for (const key of [
          'gridRowCount',
          'gridColumnCount',
          'gridRowGap',
          'gridColumnGap',
        ] as const) {
          if (typeof p[key] === 'number') target[key] = p[key] as number;
        }
      } else {
        if (typeof p.itemSpacing === 'number') target.itemSpacing = p.itemSpacing;
        if (typeof p.primaryAxisAlignItems === 'string')
          target.primaryAxisAlignItems = p.primaryAxisAlignItems;
        if (typeof p.counterAxisAlignItems === 'string')
          target.counterAxisAlignItems = p.counterAxisAlignItems;
        if (typeof p.layoutWrap === 'string') target.layoutWrap = p.layoutWrap;
        // Wrap cross-axis, validated up front; applied after layoutWrap so enabling wrap and
        // setting its row gap works in one call.
        if (typeof p.counterAxisSpacing === 'number')
          target.counterAxisSpacing = p.counterAxisSpacing;
        if (typeof p.counterAxisAlignContent === 'string')
          target.counterAxisAlignContent = p.counterAxisAlignContent;
      }
    }

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
