import { z } from 'zod';

/**
 * Variable bindings on the object that owns them — `{ field: variableId }` — as get_node /
 * get_styles report them. Shared by the paint / effect / grid input schemas so a value read out of
 * Figma writes straight back with its bindings intact instead of being flattened to the literal
 * beside it (issue #164).
 *
 * These arrays replace rather than patch: a paint or effect written back WITHOUT `boundVariables`
 * clears whatever it was bound to. (set_text_range is the exception — being a patch, it takes an
 * explicit null to unbind.)
 */
export const boundVariablesSchema = z
  .record(z.string(), z.string())
  .describe(
    'Variable bindings for this object as { field: variableId }, e.g. { "color": "VariableID:5:12" } ' +
      '— round-trips what get_node / get_styles report. The bound field then tracks the variable ' +
      'instead of the literal next to it. Omit to leave the value unbound: writing without it ' +
      'CLEARS any binding the object had.',
  );
