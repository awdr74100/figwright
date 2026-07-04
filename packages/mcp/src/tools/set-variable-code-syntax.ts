import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_VARIABLE_CODE_SYNTAX_TOOL_NAME = 'set_variable_code_syntax';

// A platform declaration: a non-empty name sets it, null removes it, omitted leaves it untouched —
// the same partial-update idiom as set_text_properties.
const platformDeclaration = z.string().min(1).nullable();

export const setVariableCodeSyntaxTool: ToolSpec = {
  name: SET_VARIABLE_CODE_SYNTAX_TOOL_NAME,
  description:
    "Declare a variable's code-side token name per platform (codeSyntax) — the write half of the " +
    'codeSyntax that get_design_context / get_variable_defs surface to codegen as the ' +
    'authoritative name (e.g. WEB: "--color-primary"). Per platform (WEB / ANDROID / iOS): a ' +
    'non-empty string sets the declaration, null removes it, an omitted platform is untouched. ' +
    'When authoring design-system variables from existing code tokens, declare the source token ' +
    'name here so future codegen resolves to the exact token instead of deriving a name. Returns ' +
    '{ ok, variableId, name, codeSyntax } with the declarations now in effect.',
  inputShape: {
    variableId: z.string().describe('Variable id'),
    codeSyntax: z
      .object({
        WEB: platformDeclaration
          .optional()
          .describe('Web/CSS name, e.g. "--color-primary" or "theme.colors.primary"'),
        ANDROID: platformDeclaration.optional().describe('Android resource name'),
        iOS: platformDeclaration.optional().describe('iOS symbol name'),
      })
      .describe('Per-platform declarations: string sets, null removes, omitted is untouched'),
  },
  kind: 'write',
};
