import type { CreateResult, MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { resolveSharedParent } from './boolean-nodes.js';

/**
 * Figma Draw repeat groups (TRANSFORM_GROUP): wrap layers in one, or change how one repeats. The
 * limits checked here are Figma's own — it refuses anything else, but with a validation dump that
 * names the wrong union branch rather than the wrong field.
 */
export const toFigmaModifiers = (raw: unknown, tool: string): TransformModifier[] => {
  if (!Array.isArray(raw)) throw new TypeError(`${tool}: modifiers must be an array`);
  if (raw.length > 2) throw new RangeError(`${tool}: a repeat group takes at most 2 modifiers`);
  return raw.map((value: unknown, i): TransformModifier => {
    const m = (value ?? {}) as Record<string, unknown>;
    const at = `${tool}: modifiers[${i}]`;
    if (m.type !== undefined && m.type !== 'REPEAT')
      throw new TypeError(`${at}.type must be REPEAT`);
    if (m.repeatType !== 'LINEAR' && m.repeatType !== 'RADIAL') {
      throw new TypeError(`${at}.repeatType must be LINEAR or RADIAL`);
    }
    if (typeof m.count !== 'number' || !Number.isInteger(m.count) || m.count < 2 || m.count > 40) {
      throw new RangeError(`${at}.count must be a whole number from 2 to 40`);
    }
    if (typeof m.offset !== 'number' || !Number.isFinite(m.offset)) {
      throw new TypeError(`${at}.offset must be a number`);
    }
    const unitType = m.unitType ?? 'PIXELS';
    if (unitType !== 'PIXELS' && unitType !== 'RELATIVE') {
      throw new TypeError(`${at}.unitType must be PIXELS or RELATIVE`);
    }
    const base = {
      type: 'REPEAT' as const,
      unitType: unitType as 'PIXELS' | 'RELATIVE',
      offset: m.offset,
      count: m.count,
    };
    if (m.repeatType === 'RADIAL') {
      if (m.axis !== undefined) {
        throw new TypeError(`${at}: a RADIAL repeat turns about a centre and takes no axis`);
      }
      return { ...base, repeatType: 'RADIAL' };
    }
    const axis = m.axis ?? 'HORIZONTAL';
    if (axis !== 'HORIZONTAL' && axis !== 'VERTICAL') {
      throw new TypeError(`${at}.axis must be HORIZONTAL or VERTICAL`);
    }
    return { ...base, repeatType: 'LINEAR', axis };
  });
};

export const createRepeatNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown; modifiers?: unknown; name?: unknown };
    if (
      !Array.isArray(p.nodeIds) ||
      p.nodeIds.length === 0 ||
      p.nodeIds.some(id => typeof id !== 'string')
    ) {
      throw new TypeError('repeat_nodes: nodeIds must be a non-empty string[]');
    }
    const modifiers = toFigmaModifiers(p.modifiers, 'repeat_nodes');
    if (modifiers.length === 0) {
      throw new TypeError('repeat_nodes: give at least one modifier — that is what repeats');
    }
    const ids = [...new Set(p.nodeIds as readonly string[])];
    const { nodes, parent, index } = await resolveSharedParent(figmaCtx, ids, 'repeat_nodes');
    const group = figmaCtx.transformGroup(nodes, parent, index, modifiers);
    if (typeof p.name === 'string') group.name = p.name;

    const result: CreateResult = { ok: true, nodeId: group.id, name: group.name, type: group.type };
    return result;
  };

export const createSetRepeatHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; modifiers?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_repeat: nodeId must be a string');
    const modifiers = toFigmaModifiers(p.modifiers, 'set_repeat');
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || node.type !== 'TRANSFORM_GROUP') {
      throw new Error(
        `set_repeat: node ${p.nodeId} is not a repeat group (TRANSFORM_GROUP) — wrap layers in ` +
          'one with repeat_nodes',
      );
    }
    node.transformModifiers = modifiers;

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
