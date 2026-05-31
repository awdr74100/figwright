import type { GetPromptResult, Prompt } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// The cross-client twin of the figma-codegen Claude Code skill: a distilled, guided workflow any MCP
// client (Cursor / Windsurf / Claude Desktop) can surface as a slash command. The deep version lives
// in packages/skills/figma-codegen/SKILL.md; this is intentionally the short form — it names the
// three grounded tools, their order, and the reuse/token rules, which is what a client without the
// skill needs. Kept short so it tracks the skill's intent without re-deriving its detail.

export const FIGMA_TO_CODE_PROMPT_NAME = 'figma_to_code';

/** Build the guided-workflow text, pointing the three tools at a node id or the current selection. */
const promptText = (nodeId: string | undefined): string => {
  const target = nodeId === undefined ? 'the current Figma selection' : `Figma node ${nodeId}`;
  const arg =
    nodeId === undefined ? '(they default to the current selection)' : `with nodeId "${nodeId}"`;
  return `Generate code for ${target} that matches this project — reuse what already exists, build only what is missing. Do not guess from a screenshot; ground every decision in these three tools, called ${arg}:

1. get_design_context (detail: full, dedupeComponents: true) — the layout tree with tokens resolved to names and each instance's componentProperties. Do not depth-limit a subtree you intend to build from: the first instance of a repeated component keeps its full structure while later ones show "deduped".

2. component_map — every Figma component grouped to a local code component with a status.
   - high / medium: import and reuse candidate.filePath; do not regenerate it.
   - Wire each entry's instances[].props (resolved variant / boolean / text values) onto the reused component — one element per instance, each with its own props.
   - candidate.unmatchedProps are props the design needs but the component lacks → surface them as component-extension TODOs, never fake them with ad-hoc markup.
   - unmapped: build it new in the project's style. For a repeated unmapped component (instanceCount > 1, e.g. a table row), build from its first instance's subtree; drill instances[0].nodeId if it was scoped away.

3. token_map — every Figma variable joined to a project token. Reference candidate.ref (e.g. bg-primary-500 or var(--color-primary-500)), never the raw hex/px. For an unmapped variable, use the value but call out the gap — do not hardcode it silently.

Emit code in the detected stack (the profile is returned on component_map / token_map). Rules: reuse beats regenerate, reference tokens not literals, and mirror the project's existing import style, file layout, and naming.`;
};

export const figmaToCodePrompt: {
  definition: Prompt;
  argsSchema: { nodeId: z.ZodOptional<z.ZodString> };
  build: (args: Record<string, string> | undefined) => GetPromptResult;
} = {
  definition: {
    name: FIGMA_TO_CODE_PROMPT_NAME,
    description:
      'Generate framework-aware code from a Figma selection that reuses the project’s existing ' +
      'components and design tokens instead of regenerating them (the cross-client form of the ' +
      'figma-codegen workflow: get_design_context + component_map + token_map).',
    arguments: [
      {
        name: 'nodeId',
        description: 'Figma node id to generate from; omit to use the current selection',
        required: false,
      },
    ],
  },
  // McpServer.registerPrompt builds the advertised `arguments` list from this shape; prompt args are
  // always strings, so an optional string mirrors the `nodeId` argument above.
  argsSchema: {
    nodeId: z
      .string()
      .optional()
      .describe('Figma node id to generate from; omit to use the current selection'),
  },
  build: (args): GetPromptResult => ({
    description: 'Figma → code via the three grounded tools (reuse components, reference tokens)',
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: promptText(args?.nodeId) },
      },
    ],
  }),
};
