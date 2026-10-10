import type { ResizeNodesResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

// Figma stores sizes as floats; anything closer than its own minimum size (0.01) is the same size.
const SIZE_EPSILON = 0.01;

interface Box {
  width: number;
  height: number;
}

type Adjusted = NonNullable<ResizeNodesResult['adjusted']>[number];

const sameSize = (a: number, b: number): boolean => Math.abs(a - b) < SIZE_EPSILON;

const enclosingInstance = (node: BaseNode): BaseNode | null => {
  for (let parent = node.parent; parent !== null; parent = parent.parent) {
    if (parent.type === 'INSTANCE') return parent;
  }
  return null;
};

const bound = (node: BaseNode, key: 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight') => {
  const value = (node as Partial<Record<typeof key, number | null>>)[key];
  return typeof value === 'number' ? value : null;
};

/**
 * Why a node did not end at the requested size. Only ever called on a node that missed it, so each
 * branch names something that measurably happened, never a rule assumed in advance.
 */
const explain = (node: BaseNode, requested: Box, before: Box, after: Box): string => {
  const instance = enclosingInstance(node);
  if (node.type === 'LINE' && instance === null && sameSize(after.width, requested.width)) {
    return `a line has no height — it was set to length ${after.width} and keeps height 0`;
  }
  if (
    instance !== null &&
    sameSize(after.width, before.width) &&
    sameSize(after.height, before.height)
  ) {
    return (
      `it sits inside instance ${instance.id} ("${instance.name}"), which kept the size its main ` +
      `component gives it and ignored the resize — resize the instance itself, change this layer in ` +
      `the main component, or detach_instance first`
    );
  }
  const held: string[] = [];
  for (const [axis, key] of [
    ['width', 'minWidth'],
    ['width', 'maxWidth'],
    ['height', 'minHeight'],
    ['height', 'maxHeight'],
  ] as const) {
    const value = bound(node, key);
    if (value !== null && !sameSize(after[axis], requested[axis]) && sameSize(after[axis], value)) {
      held.push(`${key} ${value}`);
    }
  }
  if (held.length > 0) {
    return `held by ${held.join(' and ')} — clear or change the bound with set_layout_props first`;
  }
  return `Figma sized it to ${after.width} × ${after.height} instead`;
};

/**
 * Resize every target node to the same width/height. Non-resizable nodes are skipped.
 *
 * `resize()` never reports what it did: inside an instance it is ignored outright (where writing x
 * or rotation to the same layer throws), and a min/max bound clamps it. So every node is read back,
 * and the answer is what Figma actually has — not a prediction of which nodes it will refuse, which
 * would wrongly refuse any instance content Figma does let a plugin resize. A call that changed
 * nothing at all throws, so an error always means nothing was written and a batch rolls back;
 * otherwise `affected` lists the nodes that reached the requested size and `adjusted` accounts for
 * the rest.
 */
export const createResizeNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown; width?: unknown; height?: unknown };
    if (!Array.isArray(p.nodeIds) || p.nodeIds.some(id => typeof id !== 'string')) {
      throw new TypeError('resize_nodes: nodeIds must be a string[]');
    }
    if (
      typeof p.width !== 'number' ||
      typeof p.height !== 'number' ||
      !Number.isFinite(p.width) ||
      !Number.isFinite(p.height) ||
      p.width < 0.01 ||
      p.height < 0
    ) {
      throw new TypeError(
        'resize_nodes: width and height must be finite numbers; width must be at least 0.01 and height non-negative',
      );
    }
    const requested: Box = { width: p.width, height: p.height };
    const ids = p.nodeIds as readonly string[];
    const nodes = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));

    const targets = nodes.flatMap((node, i) =>
      node !== null && typeof (node as { resize?: unknown }).resize === 'function'
        ? [
            {
              id: ids[i]!,
              node: node as BaseNode & Box & { resize: (w: number, h: number) => void },
            },
          ]
        : [],
    );
    // A LINE is a length, not a box: its height is 0 however it is rotated. Figma will store another
    // height, but it draws nothing — measured, a line resized to 250 × 10 rendered as the same
    // hairline while every later read (and the code generated from it) saw a 10px-tall node. So a
    // line always takes height 0, and a request for any other height lands in `adjusted`, saying
    // so. Any other node needs Figma's minimum height, checked for all of them before any write so a
    // refusal never leaves earlier targets resized.
    const heightOf = (node: BaseNode): number => (node.type === 'LINE' ? 0 : requested.height);
    for (const { id, node } of targets) {
      if (node.type !== 'LINE' && requested.height < 0.01) {
        throw new TypeError(
          `resize_nodes: node ${id} (${node.type}) needs a height of at least 0.01 — only a LINE takes height 0`,
        );
      }
    }
    // Every size is captured before any write and read after all of them: one target's resize can
    // move another's (a main component's layer carries its instances' copies with it), so a size read
    // straight after its own write can already be stale by the end of the call.
    const before = targets.map(({ node }): Box => ({ width: node.width, height: node.height }));
    for (const { node } of targets) node.resize(requested.width, heightOf(node));

    const affected: string[] = [];
    const adjusted: Adjusted[] = [];
    let changedAny = false;
    targets.forEach(({ id, node }, i) => {
      const after: Box = { width: node.width, height: node.height };
      const was = before[i]!;
      if (!sameSize(after.width, was.width) || !sameSize(after.height, was.height))
        changedAny = true;
      if (sameSize(after.width, requested.width) && sameSize(after.height, requested.height)) {
        affected.push(id);
      } else {
        adjusted.push({ nodeId: id, ...after, reason: explain(node, requested, was, after) });
      }
    });

    if (affected.length === 0 && adjusted.length > 0 && !changedAny) {
      throw new Error(
        `resize_nodes: nothing was resized — ${adjusted
          .map(a => `${a.nodeId} stayed ${a.width} × ${a.height}: ${a.reason}`)
          .join('; ')}`,
      );
    }

    const result: ResizeNodesResult = {
      ok: true,
      affected,
      ...(adjusted.length > 0 && { adjusted }),
    };
    return result;
  };
