import type { AnnotationsResult } from '@figwright/shared';

import {
  explainAnnotationError,
  isAnnotatable,
  parseAnnotations,
  unknownCategories,
  writeAnnotations,
} from '../annotations.js';
import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeAnnotation } from '../serializer.js';

const TOOL = 'set_annotations';

/**
 * Replace a node's Dev Mode annotations — the notes a designer leaves for whoever builds it.
 *
 * Everything Figma would accept and then get wrong is refused first: a node that keeps no
 * annotations (GROUP, SECTION, BOOLEAN_OPERATION, SLICE and PAGE take the write and store nothing —
 * measured), a categoryId that names no category (Figma keeps it, pointing at nothing), and a label
 * of only spaces (stored as an empty annotation). The write itself is one assignment, which Figma
 * takes whole or refuses whole. Allowed in Dev Mode, unlike every other write (measured).
 */
export const createSetAnnotationsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; annotations?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError(`${TOOL}: nodeId must be a string`);
    const annotations = parseAnnotations(p.annotations, TOOL);

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null) throw new Error(`${TOOL}: node ${p.nodeId} not found`);
    if (!isAnnotatable(node)) {
      throw new Error(
        `${TOOL}: node ${node.id} is a ${node.type}, which keeps no annotations — Figma takes the ` +
          'write and stores nothing. Annotate a frame, shape, text, component or instance (a ' +
          "group's or section's children can each carry their own).",
      );
    }

    const unknown = await unknownCategories(figmaCtx, annotations, node.annotations);
    if (unknown.length > 0) {
      const categories = await figmaCtx.annotations.getAnnotationCategoriesAsync();
      const list = categories.map(c => `${c.id} "${c.label}"`).join(', ') || 'none';
      throw new Error(
        `${TOOL}: no annotation category ${unknown.join(', ')} — Figma would keep the id pointing ` +
          `at nothing. Categories in this file: ${list} (create_annotation_category adds one).`,
      );
    }

    let adjusted: string[];
    try {
      adjusted = writeAnnotations(node, annotations, TOOL);
    } catch (error) {
      throw explainAnnotationError(error, TOOL);
    }

    const result: AnnotationsResult = {
      ok: true,
      nodeId: node.id,
      annotations: node.annotations.map(serializeAnnotation),
    };
    if (adjusted.length > 0) result.adjusted = adjusted.join('; ');
    return result;
  };
