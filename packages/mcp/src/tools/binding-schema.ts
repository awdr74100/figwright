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

/**
 * The same thing for a text style, whose typography values are scalars — there is no per-object
 * level to hang them on, so the style itself carries them. This one accepts null because a text
 * style write is a PATCH (omitted fields stay as they were), so unbinding has to be sayable;
 * `set_text_range` takes the same shape for the same reason.
 */
export const textStyleBindingsSchema = z
  .record(z.string(), z.union([z.string(), z.null()]))
  .describe(
    'Typography bindings as { field: variableId }: fontSize / lineHeight / letterSpacing / ' +
      'paragraphSpacing / paragraphIndent take a FLOAT variable, fontFamily / fontStyle a STRING ' +
      'one, fontWeight a FLOAT. Pass null for a field to unbind it; omit a field to leave it as it ' +
      'is. A bound field wins over a literal passed for the same field in this call.',
  );
