import { loadFonts, same, writeIfDifferent } from './batch-snapshot.js';

/**
 * What an update to a style can change, recorded so it can be put back — shared by batch rollback
 * and by the update handlers themselves, which use it to land a call whole or not at all.
 *
 * Before the handlers used it, an update that failed part-way answered with an error and left the
 * style half written (measured on main, 2026-11-19): update_paint_style and update_effect_style
 * renamed the style before resolving a missing variable, and update_text_style renamed it, set its
 * size and description, and then failed on the binding. One record of "what the tool can change and
 * how to restore it" serves both callers, so the two cannot drift apart.
 */

type Bag = Record<string, unknown>;

/**
 * The named fields of a style as they are now. A paint, effect or grid style's value is one array,
 * and its bindings ride on the array's items, round-tripping when it is written back (measured).
 * Batch records every field its tool can write; a handler records only the fields its call writes —
 * each is a read through to Figma, and an update that names one field should not pay for three.
 */
export const snapshotStyle = (style: BaseStyle, fields: readonly string[]): Bag => {
  const bag = style as unknown as Bag;
  const values: Bag = {};
  for (const k of fields) values[k] = bag[k];
  return values;
};

/** Write back what a snapshot recorded, field by field, only where it differs. */
export const restoreStyle = (style: BaseStyle, values: Bag): void => {
  for (const [k, v] of Object.entries(values)) writeIfDifferent(style, k, v);
};

/** The recorded fields that do not hold their recorded value. */
export const styleResidue = (style: BaseStyle, values: Bag): string[] =>
  Object.entries(values)
    .filter(([k, v]) => !same((style as unknown as Bag)[k], v))
    .map(([k]) => k);

/** Everything update_text_style (or a binding it applies) can change on a text style. */
export const TEXT_STYLE_PROPS = [
  'name',
  'description',
  'fontName',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'paragraphSpacing',
  'paragraphIndent',
  'textWrapStyle',
];
export const TEXT_STYLE_BINDABLE: readonly VariableBindableTextField[] = [
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'paragraphSpacing',
  'paragraphIndent',
];

/** The typography a text style's literal writes and bindings move — everything but its labels. */
const TEXT_STYLE_TYPOGRAPHY = TEXT_STYLE_PROPS.filter(k => k !== 'name' && k !== 'description');

export interface TextStyleSnapshot {
  values: Bag;
  /** Absent when the call could not move a binding (it wrote only the name / description). */
  bindings?: Record<string, string | null>;
}

const textStyleBinding = (style: TextStyle, field: VariableBindableTextField): string | null =>
  style.boundVariables?.[field]?.id ?? null;

/**
 * A text style's fields as they are now — all of them by default (batch), or the ones a call writes
 * plus its bindings, which a literal write to a bound field can take off. `boundVariables` is read
 * once, not once per field: each read is a trip to Figma that builds a fresh object.
 */
export const snapshotTextStyle = (
  style: TextStyle,
  fields: readonly string[] = TEXT_STYLE_PROPS,
  withBindings = true,
): TextStyleSnapshot => {
  const bag = style as unknown as Bag;
  const values: Bag = {};
  for (const k of fields) values[k] = bag[k];
  if (!withBindings) return { values };
  const bound = style.boundVariables;
  const bindings: Record<string, string | null> = {};
  for (const f of TEXT_STYLE_BINDABLE) bindings[f] = bound?.[f]?.id ?? null;
  return { values, bindings };
};

/**
 * Unbind what was bound since the snapshot, put the raw typography back (fonts loaded — measured to
 * be required even for a size-only write), then re-bind what was unbound.
 */
export const restoreTextStyle = async (
  figmaCtx: typeof figma,
  style: TextStyle,
  snapshot: TextStyleSnapshot,
): Promise<void> => {
  const { bindings } = snapshot;
  // Typography writes need the faces loaded; a name or description does not (measured), and a
  // restore of only those must not fail on a style whose font cannot be loaded.
  if (bindings !== undefined || TEXT_STYLE_TYPOGRAPHY.some(k => k in snapshot.values)) {
    const recorded = (snapshot.values.fontName ?? style.fontName) as FontName;
    await loadFonts(figmaCtx, [recorded, style.fontName]);
  }
  if (bindings !== undefined) {
    for (const f of TEXT_STYLE_BINDABLE) {
      if (bindings[f] === null && textStyleBinding(style, f) !== null)
        style.setBoundVariable(f, null);
    }
  }
  for (const [k, v] of Object.entries(snapshot.values)) writeIfDifferent(style, k, v);
  if (bindings === undefined) return;
  /* eslint-disable no-await-in-loop -- a style has at most eight bindable fields */
  for (const f of TEXT_STYLE_BINDABLE) {
    const id = bindings[f];
    if (id === null || id === undefined || textStyleBinding(style, f) === id) continue;
    const variable = await figmaCtx.variables.getVariableByIdAsync(id);
    if (variable === null) throw new Error(`variable ${id} bound to ${f} no longer exists`);
    style.setBoundVariable(f, variable);
  }
  /* eslint-enable no-await-in-loop */
};

/** The recorded text-style fields and bindings that do not hold their recorded value. */
export const textStyleResidue = (style: TextStyle, snapshot: TextStyleSnapshot): string[] => {
  const { bindings } = snapshot;
  const left = styleResidue(style, snapshot.values);
  if (bindings === undefined) return left;
  return [
    ...left,
    ...TEXT_STYLE_BINDABLE.filter(f => textStyleBinding(style, f) !== bindings[f]).map(
      f => `boundVariables.${f}`,
    ),
  ];
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Run a style update's writes so the call lands whole or not at all: on a failure, put the style
 * back and rethrow the failure. If it cannot be put back exactly, the error says so and names what
 * is left — never a clean refusal over a half-written style. The original error stays the `cause`,
 * so an editor's own refusal (Dev Mode's "read-only mode") is still recognised under it.
 */
export const writeStyleAtomically = async (
  writes: () => Promise<void> | void,
  restore: () => Promise<void> | void,
  residue: () => string[],
): Promise<void> => {
  try {
    await writes();
  } catch (error) {
    let left: string[];
    try {
      await restore();
      left = residue();
    } catch (restoreError) {
      // The call's own failure is the cause — it is what the agent has to act on, and what the
      // editor-context check looks for under the message; the restore's failure is in the text.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(
        `${messageOf(error)} — and the style could not be put back: ${messageOf(restoreError)}`,
        { cause: error },
      );
    }
    if (left.length > 0) {
      throw new Error(
        `${messageOf(error)} — and the style could not be put back exactly: ${left.join(', ')} ` +
          (left.length === 1 ? 'still differs' : 'still differ'),
        { cause: error },
      );
    }
    throw error;
  }
};
