/**
 * Write a node's fills or strokes, PATTERN paints included.
 *
 * The synchronous `fills` / `strokes` setters refuse a PATTERN paint outright — even one read back
 * off the same node and written back unchanged (measured) — so any read-modify-write of a node that
 * already holds a pattern threw before it could save anything else. Only the async setters take one
 * (they load the pattern's source node first). Everything else keeps the synchronous assignment it
 * always had: the async setters yield to the editor before they write, and the callers that read
 * the array they write back rely on nothing awaiting in between.
 */
export const writePaints = async (
  node: BaseNode,
  field: 'fills' | 'strokes',
  paints: readonly Paint[],
): Promise<void> => {
  const target = node as unknown as Partial<MinimalFillsMixin & MinimalStrokesMixin> &
    Record<string, unknown>;
  const setter = field === 'fills' ? target.setFillsAsync : target.setStrokesAsync;
  if (paints.some(p => p.type === 'PATTERN') && typeof setter === 'function') {
    await setter.call(node, paints);
    return;
  }
  target[field] = paints;
};
