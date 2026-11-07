/**
 * Why a text's line count is gone after a write that did not name it, or undefined when it is not.
 * Figma keeps one truncation limit on a text — a line count or a maxHeight, setting either clears
 * the other — and a fixed box truncates at its own edge, showing no line count (both measured), so
 * a maxHeight, a FIXED / FILL height or a resize to a new height clears a maxLines the caller never
 * mentioned.
 */
export const clearedMaxLines = (text: TextNode, before: number | null): string | undefined => {
  if (before === null || text.maxLines === before) return undefined;
  const why =
    typeof text.maxHeight === 'number'
      ? `a text truncates at one limit, a line count or a maxHeight, and maxHeight ${text.maxHeight} ` +
        'replaced it'
      : text.textAutoResize === 'NONE' || text.textAutoResize === 'TRUNCATE'
        ? 'the box is now a fixed height, which truncates at its own edge and shows no line count'
        : `Figma reads it as ${String(text.maxLines)}`;
  return `maxLines ${before} was cleared — ${why}`;
};
