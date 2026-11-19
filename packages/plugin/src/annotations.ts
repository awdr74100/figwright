import { plainToMarkdown, quoteForMessage } from './documentation.js';

/**
 * Annotation writes, shared by set_annotations and its batch inverse.
 *
 * What Figma does with an annotation, all measured on 2026-11-20:
 *
 * - It keeps `label` and `labelMarkdown` both and returns both on a read, but a write takes exactly
 *   one ("Only one of label or labelMarkdown should be given").
 * - A plain label is trimmed, its line breaks become `\n`, everything from a NUL is dropped, and the
 *   markdown made from it escapes `\ * _ ` ~` — the same rule as a component description's
 *   (plainToMarkdown, exact on all 437 strings tried).
 * - Markdown is rewritten into Figma's own form (`_it_` → `*it*`), and a paragraph break in it reads
 *   back in the plain label as three newlines.
 * - So neither side alone writes back every annotation as it was: the markdown of a label written as
 *   plain text holds its three newlines literally, and written back as markdown each turns into
 *   five. An annotation is therefore written back by the side it was written with — plain when its
 *   markdown is what its plain label makes, markdown otherwise — which round-trips every case
 *   tried.
 * - An annotation needs a label, markdown or a pinned property; '' and {} are refused. A label of
 *   only spaces is accepted and stored as an empty one.
 * - A categoryId that names no category is accepted silently, and stays on the annotation.
 * - A pinned property is accepted only where the node has it set: strokes on a node with a stroke,
 *   itemSpacing / padding / alignItems on auto layout, the grid fields on a grid or its child,
 *   opacity below 1, the font fields on text. Figma's refusal names the node's type, not that.
 */

/** One annotation as a write sends it to Figma. */
export interface AnnotationInput {
  label?: string;
  labelMarkdown?: string;
  categoryId?: string;
  properties?: { type: AnnotationPropertyType }[];
}

/** One annotation as a call gives it: the read shape, so what get_annotations returns writes back. */
export interface AnnotationArg {
  label?: string;
  labelMarkdown?: string;
  categoryId?: string;
  properties?: string[];
}

/** A node that keeps annotations. GROUP, SECTION, BOOLEAN_OPERATION, SLICE and PAGE have none. */
export type AnnotatableNode = BaseNode & { annotations: ReadonlyArray<Annotation> };

export const isAnnotatable = (node: BaseNode): node is AnnotatableNode => 'annotations' in node;

/**
 * The side an annotation is written back by: plain when its markdown is what its plain label makes,
 * markdown otherwise. Both read back exactly as they were (measured).
 */
export const writableAnnotation = (a: Annotation | AnnotationArg): AnnotationInput => {
  const out: AnnotationInput = {};
  const { label, labelMarkdown } = a;
  if (
    label !== undefined &&
    (labelMarkdown === undefined || labelMarkdown === plainToMarkdown(label))
  ) {
    out.label = label;
  } else if (labelMarkdown !== undefined) {
    out.labelMarkdown = labelMarkdown;
  }
  if (a.categoryId !== undefined) out.categoryId = a.categoryId;
  if (a.properties !== undefined && a.properties.length > 0) {
    out.properties = a.properties.map(p => ({
      type: (typeof p === 'string' ? p : p.type) as AnnotationPropertyType,
    }));
  }
  return out;
};

/** Check a call's annotations before anything is looked up. */
export const parseAnnotations = (raw: unknown, tool: string): AnnotationArg[] => {
  if (!Array.isArray(raw)) throw new TypeError(`${tool}: annotations must be an array`);
  return raw.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new TypeError(`${tool}: annotations[${i}] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    const out: AnnotationArg = {};
    for (const key of ['label', 'labelMarkdown', 'categoryId'] as const) {
      if (e[key] === undefined) continue;
      if (typeof e[key] !== 'string') {
        throw new TypeError(`${tool}: annotations[${i}].${key} must be a string`);
      }
      out[key] = e[key];
    }
    // Stored as an empty annotation where '' is refused — what Figma calls "no content".
    if (out.label !== undefined && out.label !== '' && out.label.trim() === '') {
      throw new TypeError(
        `${tool}: annotations[${i}].label is only whitespace, which Figma stores as an empty ` +
          'annotation — give it text, or leave the annotation out',
      );
    }
    if (e.properties !== undefined) {
      if (!Array.isArray(e.properties) || e.properties.some(p => typeof p !== 'string')) {
        throw new TypeError(`${tool}: annotations[${i}].properties must be an array of names`);
      }
      out.properties = [...(e.properties as string[])];
    }
    return out;
  });
};

/** The categories the call names that no category in the file has, and the node did not carry. */
export const unknownCategories = async (
  figmaCtx: typeof figma,
  annotations: readonly AnnotationArg[],
  current: ReadonlyArray<Annotation>,
): Promise<string[]> => {
  // A category deleted since an annotation was made leaves its id behind (measured). Writing that
  // annotation back is not inventing a category, so an id the node already carries passes.
  const carried = new Set(current.map(a => a.categoryId).filter(id => id !== undefined));
  const asked = [...new Set(annotations.map(a => a.categoryId).filter(id => id !== undefined))];
  const unknown: string[] = [];
  for (const id of asked) {
    if (carried.has(id)) continue;
    // eslint-disable-next-line no-await-in-loop -- a handful of distinct ids at most
    if ((await figmaCtx.annotations.getAnnotationCategoryByIdAsync(id)) === null) unknown.push(id);
  }
  return unknown;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Figma's refusal of a pinned property names the node's type; say what it actually checks. */
export const explainAnnotationError = (error: unknown, tool: string): Error => {
  const message = messageOf(error);
  if (/Invalid property "[^"]+" for an? /.test(message)) {
    return new Error(
      `${message} (${tool}: Figma pins a property only where the node has it set — strokes on a ` +
        'node with a stroke, effects with an effect, cornerRadius with a radius, itemSpacing / ' +
        'padding / alignItems / layoutMode on auto layout, the grid fields on a grid or its ' +
        'child, opacity below 1, the font fields on text)',
      { cause: error },
    );
  }
  return error instanceof Error ? error : new Error(message);
};

/**
 * Write a node's annotations as a call gave them, and say what Figma stored differently. A pair
 * whose label and markdown disagree is written as markdown and then refused when the label it makes
 * is not the label given — the node is left as it was.
 */
export const writeAnnotations = (
  node: AnnotatableNode,
  annotations: readonly AnnotationArg[],
  tool: string,
): string[] => {
  const before = node.annotations;
  const inputs = annotations.map(writableAnnotation);
  node.annotations = inputs;
  const stored = node.annotations;
  const notes: string[] = [];
  annotations.forEach((given, i) => {
    const got = stored[i];
    if (got === undefined) return;
    const sent = inputs[i];
    if (given.label !== undefined && given.labelMarkdown !== undefined) {
      if (sent?.labelMarkdown !== undefined && got.label !== given.label) {
        restoreAnnotations(node, before);
        throw new Error(
          `${tool}: annotations[${i}] gives a label and markdown that disagree — that markdown ` +
            `reads as ${quoteForMessage(got.label ?? '')}, not ${quoteForMessage(given.label)}. ` +
            'Send one of them: label for plain text, labelMarkdown to keep formatting. Nothing ' +
            'was changed.',
        );
      }
      return;
    }
    if (sent?.label !== undefined && got.label !== sent.label) {
      notes.push(
        `annotations[${i}].label was stored as ${quoteForMessage(got.label ?? '')} (Figma trims ` +
          'surrounding whitespace, stores line breaks as \\n and drops everything from a NUL ' +
          'character on)',
      );
    }
    if (sent?.labelMarkdown !== undefined && got.labelMarkdown !== sent.labelMarkdown) {
      notes.push(
        `annotations[${i}].labelMarkdown was stored as ` +
          `${quoteForMessage(got.labelMarkdown ?? '')} (Figma rewrites markdown into its own form)`,
      );
    }
  });
  return notes;
};

const same = (a: ReadonlyArray<Annotation>, b: ReadonlyArray<Annotation>): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Put a node's annotations back as a snapshot recorded them. Returns a note when they still differ
 * — the caller reports it rather than claiming a clean restore.
 */
export const restoreAnnotations = (
  node: AnnotatableNode,
  snapshot: ReadonlyArray<Annotation>,
): string | undefined => {
  if (same(node.annotations, snapshot)) return undefined;
  node.annotations = snapshot.map(writableAnnotation);
  return same(node.annotations, snapshot)
    ? undefined
    : `annotations could not be put back exactly (now ${JSON.stringify(node.annotations)})`;
};
