/**
 * The `instructions` string returned with `initialize`, which clients may fold into the model's
 * system prompt.
 *
 * Claude Code users get this guidance from the skills in `skills/`. Every other client — Cursor,
 * Codex, Windsurf — gets nothing, and the prompts that were meant to be the cross-client twin of
 * those skills only help once someone deliberately invokes one. This is the only channel that is
 * always present, so it carries the part of the workflow the tool descriptions structurally cannot:
 * which tool to reach for first, and why.
 *
 * It is deliberately short. Clients may put it in the system prompt of every session, so anything
 * here is paid for on every turn — it earns its place only by describing order and intent, never by
 * restating what a tool's own description already says.
 */
export const SERVER_INSTRUCTIONS = `Figwright connects this codebase to a Figma file in both directions. It needs the Figwright plugin open in Figma; \`ping\` reports whether it is, and design tools cannot work until it is.

Reading a design into code — ground it, never guess it. \`get_design_context\` is the source of truth for every measurement, colour, font and spacing value. Do not read those off an image: \`get_screenshot\` exists to verify what you built, not to measure what to build. Before generating anything, join the design to what this project already has — \`component_map\`, \`token_map\` and \`icon_map\` match Figma components, variables and icons against the local codebase, and a match means reference the existing one rather than write an equivalent. Real pixels (logos, photography) come from \`save_screenshots\` or \`save_image_fills\`; never approximate them in markup.

Writing code into Figma — reuse the file's own design system first. \`get_variable_defs\`, \`scan_components\` and \`get_styles\` show what already exists; instancing a component and binding a variable is always better than drawing a primitive with hardcoded values.`;
