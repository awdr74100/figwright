import type { GetDesignContextResult } from '@figwright/shared';

interface StyledNode {
  styleIds?: Record<string, string>;
  segments?: readonly { styleIds?: Record<string, string> }[];
  children?: readonly unknown[];
}

const stripCommas = (ids: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(ids).map(([slot, id]) => [slot, id.replace(/,+$/, '')]));

/**
 * A get_design_context result in the shape every release up to v0.7.0 gave it. Those cut the
 * trailing comma off every style id ("S:abc," → "S:abc") before looking it up, and Figma finds a
 * local style only by the id with its comma — so no local style ever resolved to a name, and the
 * `styles` map held library styles alone (their ids, "S:key,12:34", never end in a comma).
 *
 * Two callers need that shape exactly: design_diff, to compare a baseline saved by such a release
 * with a fresh capture, and the size guard, whose first over-budget rung is "what this read was
 * before the names" — a read that fit then never loses a level for the names.
 */
export const withLegacyStyleIds = (context: GetDesignContextResult): GetDesignContextResult => {
  const copy = structuredClone(context);
  const visit = (node: StyledNode): void => {
    if (node.styleIds !== undefined) node.styleIds = stripCommas(node.styleIds);
    for (const segment of node.segments ?? []) {
      if (segment.styleIds !== undefined) segment.styleIds = stripCommas(segment.styleIds);
    }
    for (const child of node.children ?? []) visit(child as StyledNode);
  };
  for (const node of copy.nodes) visit(node as StyledNode);
  if (copy.styles !== undefined) {
    const kept = Object.entries(copy.styles).filter(([id]) => !id.endsWith(','));
    if (kept.length === 0) delete copy.styles;
    else copy.styles = Object.fromEntries(kept);
  }
  return copy;
};
