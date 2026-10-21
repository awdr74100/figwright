/**
 * A node whose characters and runs the text tools edit: a TEXT node, or text set along a path
 * (Figma Draw's TEXT_PATH). A path carries the run-level half of a TEXT node's API — characters,
 * fonts, size, case, tracking, links, fills, styles and bindings — and none of the box-level half.
 */
export type TextLike = TextNode | TextPathNode;

export const isTextLike = (node: BaseNode | null): node is TextLike =>
  node?.type === 'TEXT' || node?.type === 'TEXT_PATH';

/**
 * Text settings a TEXT node has and text on a path does not draw. On the node the property is
 * missing (writing it throws `object is not extensible`); per run it is accepted, read back and
 * never rendered (measured) — so a write tool refuses these on a path rather than answer ok.
 */
export const NOT_ON_A_PATH: ReadonlySet<string> = new Set([
  'lineHeight',
  'textDecoration',
  'textDecorationStyle',
  'textDecorationOffset',
  'textDecorationThickness',
  'textDecorationColor',
  'textDecorationSkipInk',
  'paragraphSpacing',
  'paragraphIndent',
  'listOptions',
  'listSpacing',
  'indentation',
  'textWrapStyle',
  'textAutoResize',
  'textTruncation',
  'maxLines',
  'leadingTrim',
  'hangingPunctuation',
  'hangingList',
]);

/** The `NOT_ON_A_PATH` keys a call actually sets, for a refusal that names them. */
export const unsupportedOnPath = (params: Record<string, unknown>): string[] =>
  Object.keys(params).filter(k => NOT_ON_A_PATH.has(k) && params[k] !== undefined);
