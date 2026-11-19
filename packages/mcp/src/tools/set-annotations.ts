import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_ANNOTATIONS_TOOL_NAME = 'set_annotations';

// Figma's AnnotationPropertyType as of plugin-typings 1.142. An enum on the way in, as create_variable
// keeps its scopes: a wrong name is otherwise only a refusal from Figma, and the list is what an
// agent cannot guess. get_annotations reports them back as plain strings.
const ANNOTATION_PROPERTIES = [
  'width',
  'height',
  'maxWidth',
  'minWidth',
  'maxHeight',
  'minHeight',
  'fills',
  'strokes',
  'effects',
  'strokeWeight',
  'cornerRadius',
  'textStyleId',
  'textAlignHorizontal',
  'fontFamily',
  'fontStyle',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'itemSpacing',
  'padding',
  'layoutMode',
  'alignItems',
  'opacity',
  'mainComponent',
  'gridRowGap',
  'gridColumnGap',
  'gridRowCount',
  'gridColumnCount',
  'gridRowAnchorIndex',
  'gridColumnAnchorIndex',
  'gridRowSpan',
  'gridColumnSpan',
] as const;

export const setAnnotationsTool: ToolSpec = {
  name: SET_ANNOTATIONS_TOOL_NAME,
  description:
    "Replace a node's Dev Mode annotations — the notes a designer leaves for whoever builds it " +
    '(read them with get_annotations). The list REPLACES the existing one, so send the ones to keep ' +
    'too, exactly as get_annotations returns them, and [] removes them all. Each annotation has ' +
    'label (plain text) or labelMarkdown (keeps bold, links, lists) — a get_annotations entry ' +
    'carries both and writes back as is — and optionally categoryId (from get_annotations ' +
    'categories, or create_annotation_category) and properties: node fields pinned to the note, ' +
    'which Figma accepts only where the node has them set (strokes with a stroke, padding / ' +
    'itemSpacing on auto layout, the font fields on text). A frame, shape, text, component or ' +
    'instance (and a layer inside one) takes annotations; a group, section, boolean group, slice ' +
    'or page does not. Works in Dev Mode too. Returns { ok, nodeId, annotations, adjusted? } — ' +
    'adjusted says what Figma stored differently (a trimmed label, markdown in its own form).',
  inputSchema: z.object({
    nodeId: z.string().describe('The node to annotate'),
    annotations: z
      .array(
        z.object({
          label: z.string().optional().describe('The note as plain text'),
          labelMarkdown: z
            .string()
            .optional()
            .describe('The note as markdown — **bold**, *italic*, [links](https://…), lists'),
          categoryId: z.string().optional().describe('The category, by id'),
          properties: z
            .array(z.enum(ANNOTATION_PROPERTIES))
            .optional()
            .describe('Node fields to pin to the note, e.g. ["fills", "cornerRadius"]'),
        }),
      )
      .describe('The whole list, replacing the current one'),
  }),
  kind: 'write',
};
