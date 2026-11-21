/**
 * FigJam's sticky, shape with text, table cell and connector keep their words in a `text` sublayer,
 * not a TEXT child. Measured on 2026-11-21 in FigJam:
 *
 * - The sublayer has an id, but `getNodeByIdAsync` does not find it, and neither a scene walk nor a
 *   search for TEXT reaches it — so the tools take the container's id.
 * - It carries the run-level half of a TEXT node's API: `characters`, every styled-segment field and
 *   the range setters for them. It has no box (no width, height or auto-resize) and no node-level
 *   variable bindings.
 * - FigJam writes it in Inter Medium. A connector with no label yet reports an empty font (family
 *   `''`), and writing one needs Inter Medium loaded — Figma's own refusal names it.
 */
export const TEXT_SUBLAYER_TYPES: ReadonlySet<string> = new Set([
  'STICKY',
  'SHAPE_WITH_TEXT',
  'TABLE_CELL',
  'CONNECTOR',
]);

/** The text sublayer of a sticky, shape with text, table cell or connector; null for any other. */
export const textHostOf = (node: BaseNode): TextSublayerNode | null =>
  TEXT_SUBLAYER_TYPES.has(node.type) ? (node as unknown as { text: TextSublayerNode }).text : null;

/** FigJam's caption face: what it writes a sublayer's words in, and an empty label takes. */
export const CAPTION_FONT: FontName = { family: 'Inter', style: 'Medium' };

/**
 * The faces a write to a text needs loaded — its own, or, for a label not written yet (family
 * `''`), the caption face Figma will write it in. A TEXT node always names a real face, so for one
 * this is exactly its faces.
 */
export const facesToLoad = (
  mixed: symbol,
  text: Pick<TextNode, 'fontName' | 'characters' | 'getRangeAllFontNames'>,
): FontName[] => {
  if (text.fontName === mixed && text.characters.length > 0) {
    return [...text.getRangeAllFontNames(0, text.characters.length)];
  }
  const face = text.fontName as FontName;
  return face.family === '' ? [CAPTION_FONT] : [face];
};

/**
 * Appended where a text-styling tool refuses a node: a FigJam caption's words can still be
 * rewritten, with set_text — the one text tool that reaches them.
 */
export const captionHint = (node: BaseNode | null): string =>
  node !== null && TEXT_SUBLAYER_TYPES.has(node.type)
    ? ` — a FigJam ${node.type}'s words are rewritten with set_text, which is the one text tool that reaches them`
    : '';
