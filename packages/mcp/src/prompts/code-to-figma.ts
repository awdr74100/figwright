import type { GetPromptResult, Prompt } from '@modelcontextprotocol/sdk/types.js';

// The cross-client twin of the figma-build Claude Code skill: a distilled, guided workflow any MCP
// client (Cursor / Windsurf / Claude Desktop) can surface as a slash command. The deep version lives
// in skills/figma-build/SKILL.md; this is intentionally the short form — the build order, the
// reuse/token rules, and the few write-side gotchas a client without the skill needs. Mirror of
// figma_to_code, reversed (code → design instead of design → code).

export const CODE_TO_FIGMA_PROMPT_NAME = 'code_to_figma';

const promptText = (): string =>
  `Build a Figma design from the provided code or description, into the connected Figma file — reuse the file's existing design system, build only what is missing. Don't draw primitives with hardcoded values; ground every decision in the file's own components and tokens. You operate on the connected file (there is no fetch-by-URL); confirm a plugin is connected (ping) before building, and work incrementally — validate each step rather than emitting a whole tree blind.

1. Ground in the design system first (reuse beats regenerate). get_variable_defs — the file's colour / spacing / radius / typography variables (names + values + hex) you bind to. scan_components / get_local_components — existing components to instance instead of rebuilding; match each source UI pattern (a card, a list row, a nav, a button) to one. get_styles — shared paint / text / effect styles to apply. Decide per element: reuse an existing component/variable/style, or build new only what the system genuinely lacks (named to fit its conventions).

2. Container + auto-layout. create_frame, then set_auto_layout (HORIZONTAL / VERTICAL / GRID) with padding / itemSpacing / alignment. Use auto-layout whenever children relate structurally (stacked / side-by-side / gapped) — never absolute x/y for inner layout; absolute coordinates are only for where a top-level container sits on the canvas. Child sizing: append the child into its auto-layout parent FIRST, then set_layout_props — layoutGrow 1 = fill the primary axis, layoutAlign STRETCH = fill the counter axis, layoutGrow 0 = hug. There is no FILL/HUG enum on the write side; express it through layoutGrow + layoutAlign.

3. Reuse components. create_instance (componentId for a local component, componentKey for a published / library one), then set its variant / props. Prefer instancing a real component over rebuilding its internals from primitives.

4. Text. create_text / set_text. A new TEXT node defaults to a fallback font (Inter), NOT the design system's font — set the real family/style with set_text_properties (the font must be available; the plugin loads the node's fonts on edit).

5. Reference tokens, not literals. Colour (fill / stroke): set the paint first (set_fills / set_strokes), then bind_variable_to_paint (target fills|strokes, index, variableId) — NOT bind_variable_to_node, which rejects fills/strokes because Figma stores colour bindings on the paint. Scalars (width / height / padding* / itemSpacing, per-corner radius topLeftRadius…, characters): bind_variable_to_node (field, variableId). Shared styles: apply_style_to_node (field fill / stroke / effect / grid / text). Never hardcode hex/px when a token exists — get_variable_defs tells you what does.

6. Verify visually (close the loop). After each section, get_screenshot the built node and compare it to the source intent; trace each discrepancy, fix, and re-screenshot. An empty:true export means the node rendered nothing (hidden / off-canvas).

Rules: reuse beats regenerate (instance existing components, bind existing variables/styles, build new only what's missing and name it to fit); reference tokens not literals (bind_variable_to_paint for colour, bind_variable_to_node for scalars, apply_style_to_node for shared looks); auto-layout for related children, absolute coordinates only for top-level placement; recognise the source UI pattern and assemble it from the matching components, not primitives; match the file's naming, structure, and design-system conventions.`;

export const codeToFigmaPrompt: {
  definition: Prompt;
  argsSchema: Record<string, never>;
  build: (args: Record<string, string> | undefined) => GetPromptResult;
} = {
  definition: {
    name: CODE_TO_FIGMA_PROMPT_NAME,
    description:
      'Build a Figma design from code or a description in the connected file, reusing the ' +
      'file’s existing components / variables / styles instead of drawing primitives (the ' +
      'cross-client form of the figma-build workflow: get_variable_defs + scan_components + ' +
      'create_instance + bind_variable_to_paint / bind_variable_to_node).',
    arguments: [],
  },
  argsSchema: {},
  build: (): GetPromptResult => ({
    description: 'Code → Figma: build from the design system (reuse components, reference tokens)',
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: promptText() },
      },
    ],
  }),
};
