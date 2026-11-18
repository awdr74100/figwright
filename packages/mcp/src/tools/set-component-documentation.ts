import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_COMPONENT_DOCUMENTATION_TOOL_NAME = 'set_component_documentation';

export const setComponentDocumentationTool: ToolSpec = {
  name: SET_COMPONENT_DOCUMENTATION_TOOL_NAME,
  description:
    "Set a component's or component set's documentation: the description Figma shows for it and " +
    'its documentation link. Omit any of description / descriptionMarkdown / documentationLinks ' +
    'to leave it unchanged; supply at least one. description is plain text; descriptionMarkdown ' +
    'keeps formatting (**bold**, [link](url), lists) and paragraphs. To rewrite a description you ' +
    'read, read it with get_local_components documentation: true and send back descriptionMarkdown ' +
    'when it has one: a description typed in Figma reads back with each paragraph break as three ' +
    'newlines, and plain text sent that way shows an extra blank line. So a plain description that ' +
    'would change a description carrying formatting, a link or paragraph breaks is refused, with ' +
    'nothing changed, unless replaceFormatting: true says to replace it anyway. Passing both ' +
    'description and descriptionMarkdown is accepted when they say the same thing, as the reads ' +
    'report them, and refused when they do not. A variant inside a set has its own documentation, ' +
    "separate from the set's. An instance is refused with its main component's id, since that is " +
    'where its documentation lives; a library component is read-only here. Returns { ok, nodeId, ' +
    'adjusted? } — adjusted says what Figma stored differently from what was sent (it trims ' +
    'surrounding whitespace and rewrites markdown into its own form).',
  inputSchema: z.object({
    nodeId: z.string().describe('COMPONENT or COMPONENT_SET node id'),
    description: z
      .string()
      .optional()
      .describe('Plain-text description; "" clears it. Replaces any formatting'),
    descriptionMarkdown: z
      .string()
      .optional()
      .describe('The description as markdown, keeping formatting; "" clears it'),
    documentationLinks: z
      .array(
        z.object({
          uri: z.string().describe('A URL with its scheme, e.g. "https://storybook.example.com/…"'),
        }),
      )
      .max(1)
      .optional()
      .describe("The documentation link — at most one (Figma's limit); [] removes it"),
    replaceFormatting: z
      .boolean()
      .optional()
      .describe(
        'Let a plain description replace one that has formatting, a link or paragraph breaks',
      ),
  }),
  kind: 'write',
};
