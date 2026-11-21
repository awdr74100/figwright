import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { keptEdges, replaceRange } from './text-edit.js';
import { isTextLike } from './text-like.js';
import { facesToLoad, textHostOf } from './text-sublayer.js';

export const createSetTextHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; characters?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_text: nodeId must be a string');
    if (typeof p.characters !== 'string')
      throw new TypeError('set_text: characters must be a string');

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    const text = node === null ? null : isTextLike(node) ? node : textHostOf(node);
    if (node === null || text === null) {
      throw new Error(
        `set_text: node ${p.nodeId} is not a TEXT node, text on a path, or a FigJam sticky, shape ` +
          'with text, table cell or connector',
      );
    }

    // Figma requires every font in the node to be loaded before mutating characters — and a
    // connector's label not written yet names no font, so it takes the one FigJam writes it in.
    await Promise.all(facesToLoad(figmaCtx.mixed, text).map(font => figmaCtx.loadFontAsync(font)));

    // Only what differs is rewritten: whole runs the old and new strings share at either end are
    // kept, so fixing a typo leaves a bold word or a coloured price suffix as it was. An empty node
    // has no style to keep and nothing to copy one from, so it takes the plain assignment.
    const before = text.characters;
    if (before.length === 0) {
      text.characters = p.characters;
    } else {
      const { prefix, suffix } = keptEdges(text, p.characters);
      replaceRange(
        text,
        prefix,
        before.length - suffix,
        p.characters.slice(prefix, p.characters.length - suffix),
      );
    }

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
