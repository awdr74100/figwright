import type { ResizeNodesResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import {
  captureGeometry,
  fontsOf,
  loadFonts,
  restoreGeometry,
  same,
  type GeometrySnapshot,
} from './batch-snapshot.js';
import { sameSize } from './size.js';
import { clearedMaxLines } from './text-limit.js';

interface Box {
  width: number;
  height: number;
}

type Adjusted = NonNullable<ResizeNodesResult['adjusted']>[number];

export const enclosingInstance = (node: BaseNode): BaseNode | null => {
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
export const explain = (node: BaseNode, requested: Box, before: Box, after: Box): string => {
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
 *
 * A resize Figma holds at its size still leaves a mark: a HUG / FILL axis turns FIXED and an
 * auto-sized text a fixed box, whether or not the size moved (measured — a bound holding a frame, a
 * text, an auto-layout child). A node whose size did not move at all is therefore put back as it
 * was, so the error, or the size `adjusted` reports it kept, is the whole story.
 */
const putBack = async (
  figmaCtx: typeof figma,
  node: SceneNode,
  snapshot: GeometrySnapshot,
): Promise<string | undefined> => {
  const moved = (): string[] => {
    const now = captureGeometry(node).layout;
    return Object.keys(snapshot.layout).filter(k => !same(now[k], snapshot.layout[k]));
  };
  // Nothing to put back (a layer inside an instance, where Figma ignores the resize outright) means
  // nothing is written — not even a font load that could fail.
  if (moved().length === 0) return undefined;
  try {
    if (node.type === 'TEXT') await loadFonts(figmaCtx, fontsOf(figmaCtx, node));
    restoreGeometry(node, snapshot);
  } catch (error) {
    return `its sizing could not be put back: ${error instanceof Error ? error.message : String(error)}`;
  }
  const left = moved();
  if (left.length === 0) return undefined;
  const now = captureGeometry(node).layout;
  return `it was left with ${left.map(k => `${k} ${JSON.stringify(now[k])}`).join(', ')}`;
};

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
    const geometry = targets.map(({ node }) => captureGeometry(node as unknown as SceneNode));
    // A text's line count, to tell whether its resize cleared it (see clearedMaxLines).
    const maxLinesBefore = targets.map(({ node }) => (node.type === 'TEXT' ? node.maxLines : null));
    for (const { node } of targets) node.resize(requested.width, heightOf(node));

    const affected: string[] = [];
    const adjusted: Adjusted[] = [];
    const cleared: { nodeId: string; reason: string }[] = [];
    let changedAny = false;
    const held: number[] = [];
    targets.forEach(({ id, node }, i) => {
      const lost = node.type === 'TEXT' ? clearedMaxLines(node, maxLinesBefore[i]!) : undefined;
      if (lost !== undefined) cleared.push({ nodeId: id, reason: lost });
      const after: Box = { width: node.width, height: node.height };
      const was = before[i]!;
      if (!sameSize(after.width, was.width) || !sameSize(after.height, was.height))
        changedAny = true;
      else if (!sameSize(after.width, requested.width) || !sameSize(after.height, requested.height))
        held.push(i);
      if (sameSize(after.width, requested.width) && sameSize(after.height, requested.height)) {
        affected.push(id);
      } else {
        adjusted.push({ nodeId: id, ...after, reason: explain(node, requested, was, after) });
      }
    });

    for (const i of held) {
      const { id, node } = targets[i]!;
      // eslint-disable-next-line no-await-in-loop -- a font load per held text, in order
      const residue = await putBack(figmaCtx, node as unknown as SceneNode, geometry[i]!);
      const entry = residue === undefined ? undefined : adjusted.find(a => a.nodeId === id);
      if (entry !== undefined) entry.reason += `; ${residue}`;
    }

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
      ...(cleared.length > 0 && { cleared }),
    };
    return result;
  };
