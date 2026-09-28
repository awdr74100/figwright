/**
 * A handful of FigJam-native node types bake their caption into a `text` sublayer instead of a
 * separate TEXT child: `node.text` supports the same characters/font read-write surface as a
 * TextNode (NonResizableTextMixin) but carries no id of its own and isn't reachable by
 * `findAllWithCriteria({ types: ['TEXT'] })` or a scene-tree walk — the caption is otherwise
 * invisible to every tool built around a standalone TEXT node.
 */
export const TEXT_SUBLAYER_TYPES = new Set<string>([
  'STICKY',
  'SHAPE_WITH_TEXT',
  'TABLE_CELL',
  'CONNECTOR',
]);

export type TextHost = Pick<
  TextNode,
  'characters' | 'fontName' | 'getRangeAllFontNames' | 'getStyledTextSegments'
>;

/** The mutable text surface of `node` — itself for a TEXT node, its sublayer for a container type. */
export const getTextHost = (node: BaseNode): TextHost | null => {
  if (node.type === 'TEXT') return node as TextNode;
  if (TEXT_SUBLAYER_TYPES.has(node.type)) {
    return (node as unknown as { text: TextHost }).text;
  }
  return null;
};
