import type { GetAnnotationsResult, NodeAnnotations } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { pageOf, serializeMeasurement } from '../measurements.js';
import { serializeAnnotation } from '../serializer.js';
import { walk } from '../traverse.js';

const hasAnnotations = (
  node: BaseNode,
): node is BaseNode & { annotations: readonly Annotation[] } =>
  'annotations' in node && Array.isArray((node as { annotations?: unknown }).annotations);

export const createGetAnnotationsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const nodeId = (params as { nodeId?: unknown } | null)?.nodeId;
    if (nodeId !== undefined && typeof nodeId !== 'string') {
      throw new TypeError('get_annotations: nodeId must be a string');
    }

    const out: NodeAnnotations[] = [];
    const collect = (node: BaseNode): void => {
      if (hasAnnotations(node) && node.annotations.length > 0) {
        out.push({
          nodeId: node.id,
          nodeName: node.name,
          annotations: node.annotations.map(serializeAnnotation),
        });
      }
    };

    // The page whose measurements this read reports, and which of them: the node's page, filtered
    // to the ones on that node (getMeasurementsForNode refuses a node off the current page —
    // measured), or the current page whole.
    let measured: { page: PageNode; touching?: string } | null = null;
    if (typeof nodeId === 'string') {
      const node = await figmaCtx.getNodeByIdAsync(nodeId);
      if (node !== null) {
        collect(node);
        const page = pageOf(node);
        if (page !== null) measured = { page, touching: node.id };
      }
    } else {
      for (const node of walk(figmaCtx.currentPage.children)) collect(node);
      measured = { page: figmaCtx.currentPage };
    }

    const result: GetAnnotationsResult = { annotations: out };
    // Every category, not only the ones cited: a write names a category by id, and a file holds a
    // handful. One call (under a millisecond, measured). FigJam has no annotations API at all, and a
    // read there must keep answering as it did, so the table is left out rather than failing it.
    const api = (figmaCtx as { annotations?: AnnotationsAPI }).annotations;
    if (api !== undefined) {
      result.categories = (await api.getAnnotationCategoriesAsync()).map(c => ({
        id: c.id,
        label: c.label,
        color: c.color,
        isPreset: c.isPreset,
      }));
    }
    // Opt-in: reading them costs a trip per end of each measurement (measured: a page with 16 made a
    // scan 3.7 → 4.8 ms), and a read that did not ask must cost what it did. Even when asked, only
    // reported when there are any. FigJam has getMeasurements too, always empty (measured).
    const wantsMeasurements = (params as { measurements?: unknown } | null)?.measurements === true;
    if (
      wantsMeasurements &&
      measured !== null &&
      typeof measured.page.getMeasurements === 'function'
    ) {
      const { page, touching } = measured;
      const list = page
        .getMeasurements()
        .filter(
          m => touching === undefined || m.start.node.id === touching || m.end.node.id === touching,
        )
        .map(serializeMeasurement);
      if (list.length > 0) result.measurements = list;
    }
    return result;
  };
