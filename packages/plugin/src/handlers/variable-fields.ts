import { descriptionStoredNote } from '../documentation.js';

/**
 * The fields of a variable that a write can set besides its values and code syntax, which have
 * tools of their own — shared by create_variable and update_variable, and by update_variable's
 * batch inverse, so the three agree on what each field accepts and how a refusal reads.
 */
export interface VariableFields {
  name?: string;
  description?: string;
  scopes?: string[];
  hiddenFromPublishing?: boolean;
}

/**
 * The scopes Figma accepts on each type, measured 2026-11-20 by setting every scope alone on a
 * variable of each type. Used only to explain a refusal — Figma stays the judge of what it accepts,
 * so a scope a later release adds is not refused here. EASING and TIMING take none.
 */
const SCOPES_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  COLOR: [
    'ALL_SCOPES',
    'ALL_FILLS',
    'FRAME_FILL',
    'SHAPE_FILL',
    'TEXT_FILL',
    'STROKE_COLOR',
    'EFFECT_COLOR',
  ],
  FLOAT: [
    'ALL_SCOPES',
    'TEXT_CONTENT',
    'CORNER_RADIUS',
    'WIDTH_HEIGHT',
    'GAP',
    'STROKE_FLOAT',
    'EFFECT_FLOAT',
    'OPACITY',
    'COLOR_OPACITY',
    'FONT_WEIGHT',
    'FONT_SIZE',
    'LINE_HEIGHT',
    'LETTER_SPACING',
    'PARAGRAPH_SPACING',
    'PARAGRAPH_INDENT',
  ],
  STRING: ['ALL_SCOPES', 'TEXT_CONTENT', 'FONT_FAMILY', 'FONT_STYLE'],
  BOOLEAN: ['ALL_SCOPES'],
};

/** Check a write's variable fields before anything is looked up; undefined fields are left alone. */
export const parseVariableFields = (params: unknown, tool: string): VariableFields => {
  const p = (params ?? {}) as Record<string, unknown>;
  const out: VariableFields = {};
  if (p.name !== undefined) {
    if (typeof p.name !== 'string' || p.name.length === 0) {
      throw new TypeError(`${tool}: name must be a non-empty string`);
    }
    out.name = p.name;
  }
  if (p.description !== undefined) {
    if (typeof p.description !== 'string') {
      throw new TypeError(`${tool}: description must be a string`);
    }
    out.description = p.description;
  }
  if (p.scopes !== undefined) {
    if (!Array.isArray(p.scopes) || p.scopes.some(scope => typeof scope !== 'string')) {
      throw new TypeError(`${tool}: scopes must be an array of scope names`);
    }
    out.scopes = [...(p.scopes as string[])];
  }
  if (p.hiddenFromPublishing !== undefined) {
    if (typeof p.hiddenFromPublishing !== 'boolean') {
      throw new TypeError(`${tool}: hiddenFromPublishing must be a boolean`);
    }
    out.hiddenFromPublishing = p.hiddenFromPublishing;
  }
  return out;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * A refusal made to read as what it is. Figma's own words are kept and lead, so a caller matching
 * on them still matches; what is added says which scopes the type does take, and that a library
 * variable is edited in its library — Figma's message for that names "a remote style or component",
 * which a variable is not.
 */
/** What a refusal's explanation reads off the variable — taken before a new one is removed. */
export interface VariableIdentity {
  id: string;
  name: string;
  resolvedType: string;
  remote: boolean;
}

export const explainVariableError = (
  error: unknown,
  variable: VariableIdentity,
  tool: string,
): Error => {
  const message = messageOf(error);
  if (
    /Invalid scope for this variable type|Cannot set scopes on this variable type/.test(message)
  ) {
    const accepted = SCOPES_BY_TYPE[variable.resolvedType];
    const type = `${/^[AEIOU]/.test(variable.resolvedType) ? 'an' : 'a'} ${variable.resolvedType}`;
    const hint =
      accepted === undefined
        ? `${type} variable takes no scopes`
        : `${type} variable takes ${accepted.join(' / ')}` +
          (variable.resolvedType === 'BOOLEAN' ? '' : ', or [] to be offered nowhere');
    return new Error(`${message} (${tool}: ${hint})`, { cause: error });
  }
  // Figma words the same refusal two ways (both measured on a library variable, 2026-11-20): a
  // property write reports a read-only node, and setVariableCodeSyntax reports "No node found".
  if (variable.remote && /read-only node|No node found/.test(message)) {
    return new Error(
      `${message} (${tool}: variable ${variable.id} "${variable.name}" comes from a library, ` +
        'and a library variable is edited in the library file that publishes it)',
      { cause: error },
    );
  }
  return error instanceof Error ? error : new Error(message);
};

/** The fields a write names, as they are now — what a rollback puts back. */
export const snapshotVariableFields = (
  variable: Variable,
  fields: VariableFields,
): VariableFields => {
  const out: VariableFields = {};
  if (fields.name !== undefined) out.name = variable.name;
  if (fields.description !== undefined) out.description = variable.description;
  if (fields.scopes !== undefined) out.scopes = [...variable.scopes];
  if (fields.hiddenFromPublishing !== undefined) {
    out.hiddenFromPublishing = variable.hiddenFromPublishing;
  }
  return out;
};

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every(x => b.includes(x));

/**
 * Write the fields a call names. The two Figma can refuse on their content — a name (empty path,
 * `.`, `{`, a name already in the collection) and scopes (one the type does not take) — go first,
 * so a refusal lands before anything that cannot fail is written. Returns notes for what was stored
 * differently from what was sent; Figma keeps scopes in its own order, so they are compared as a
 * set.
 */
export const writeVariableFields = (variable: Variable, fields: VariableFields): string[] => {
  const notes: string[] = [];
  if (fields.name !== undefined && variable.name !== fields.name) variable.name = fields.name;
  if (fields.scopes !== undefined && !sameSet(variable.scopes, fields.scopes)) {
    variable.scopes = fields.scopes as VariableScope[];
    if (!sameSet(variable.scopes, fields.scopes)) {
      notes.push(`scopes were stored as ${JSON.stringify(variable.scopes)}`);
    }
  }
  if (fields.description !== undefined && variable.description !== fields.description) {
    variable.description = fields.description;
    if (variable.description !== fields.description) {
      notes.push(descriptionStoredNote(variable.description));
    }
  }
  if (
    fields.hiddenFromPublishing !== undefined &&
    variable.hiddenFromPublishing !== fields.hiddenFromPublishing
  ) {
    variable.hiddenFromPublishing = fields.hiddenFromPublishing;
  }
  return notes;
};

/** The recorded fields that do not hold their recorded value. */
export const variableFieldsResidue = (variable: Variable, before: VariableFields): string[] => {
  const left: string[] = [];
  if (before.name !== undefined && variable.name !== before.name) left.push('name');
  if (before.description !== undefined && variable.description !== before.description) {
    left.push('description');
  }
  if (before.scopes !== undefined && !sameSet(variable.scopes, before.scopes)) left.push('scopes');
  if (
    before.hiddenFromPublishing !== undefined &&
    variable.hiddenFromPublishing !== before.hiddenFromPublishing
  ) {
    left.push('hiddenFromPublishing');
  }
  return left;
};
