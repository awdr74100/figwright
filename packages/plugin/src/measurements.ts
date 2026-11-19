import type { SerializedMeasurement } from '@figwright/shared';

/**
 * Dev Mode measurements — the dimension lines a designer draws between two node edges, or across
 * one node. Measured on 2026-11-20:
 *
 * - They work in Figma Design, though the typings say "only available in Dev Mode". FigJam has
 *   getMeasurements (always empty) and no addMeasurement.
 * - They live on a page, and that page's own methods read, add, edit and delete them from anywhere:
 *   only `figma.currentPage.addMeasurement` with another page's nodes is refused ("Start node is
 *   not on the current page"). So a write goes to the page its nodes are on, and the user's current
 *   page is never switched.
 * - Figma refuses, in clear words of its own: two sides on different axes, a node measured against
 *   its own same side ("can't point to itself"), a GROUP, SECTION or PAGE, an INNER offset outside
 *   -1…1, an unknown side or offset type, an id it cannot find. One node's two opposite sides is a
 *   measurement across it.
 * - `freeText` is kept exactly as sent — not trimmed, line breaks as they were.
 * - A measurement holds no distance; Figma draws it from the nodes. Removing a node removes the
 *   measurements on it.
 */

/** The page a node is on, or null for one not in the document (a removed node). */
export const pageOf = (node: BaseNode): PageNode | null => {
  for (let n: BaseNode | null | undefined = node; n !== null && n !== undefined; n = n.parent) {
    if (n.type === 'PAGE') return n;
  }
  return null;
};

export const serializeMeasurement = (m: Measurement): SerializedMeasurement => {
  const out: SerializedMeasurement = {
    id: m.id,
    start: { nodeId: m.start.node.id, side: m.start.side },
    end: { nodeId: m.end.node.id, side: m.end.side },
    offset:
      m.offset.type === 'INNER'
        ? { type: 'INNER', relative: m.offset.relative }
        : { type: 'OUTER', fixed: m.offset.fixed },
  };
  if (m.freeText !== '') out.freeText = m.freeText;
  return out;
};

/**
 * A measurement by id, and the page it is on: the current page first — where an agent's
 * measurements almost always are — then the others, each loaded only if it has to be searched.
 */
export const findMeasurement = async (
  figmaCtx: typeof figma,
  id: string,
  tool: string,
): Promise<{ page: PageNode; measurement: Measurement }> => {
  const current = figmaCtx.currentPage;
  const pages = [current, ...figmaCtx.root.children.filter(p => p !== current)];
  for (const page of pages) {
    // eslint-disable-next-line no-await-in-loop -- one page at a time, stopping at the first hit
    if (page !== current) await page.loadAsync();
    const measurement = page.getMeasurements().find(m => m.id === id);
    if (measurement !== undefined) return { page, measurement };
  }
  throw new Error(`${tool}: no measurement ${id} in this file`);
};
