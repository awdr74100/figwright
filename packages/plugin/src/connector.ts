import type { SerializedConnectorEndpoint, SerializedNode } from '@figwright/shared';

/** The page a node sits on, or null when it is detached. */
const pageIdOf = (node: BaseNode): string | null => {
  // `?? null`: a node detached from the tree reports no parent at all rather than null.
  for (let up = node.parent ?? null; up !== null; up = up.parent ?? null) {
    if (up.type === 'PAGE') return up.id;
  }
  return null;
};

/**
 * One end in the shape create_connector takes. Measured on 2026-11-21 in FigJam: a floating end
 * reads back as attached to the page (`endpointNodeId` = the page's id) at its `position`, even
 * inside a section, so that id is left out — `{ position }` alone is what floating means here.
 */
const readEndpoint = (
  end: ConnectorEndpoint,
  pageId: string | null,
): SerializedConnectorEndpoint => {
  const out: SerializedConnectorEndpoint = {};
  if ('endpointNodeId' in end && end.endpointNodeId !== pageId) {
    out.endpointNodeId = end.endpointNodeId;
  }
  if ('magnet' in end) out.magnet = end.magnet;
  if ('position' in end) out.position = { x: end.position.x, y: end.position.y };
  return out;
};

/** A FigJam connector's two ends, its path shape and its end caps. */
export const readConnector = (
  node: ConnectorNode,
): Pick<
  SerializedNode,
  | 'connectorStart'
  | 'connectorEnd'
  | 'connectorLineType'
  | 'connectorStartStrokeCap'
  | 'connectorEndStrokeCap'
> => {
  const pageId = pageIdOf(node);
  const out: ReturnType<typeof readConnector> = {};
  if (node.connectorStart !== undefined)
    out.connectorStart = readEndpoint(node.connectorStart, pageId);
  if (node.connectorEnd !== undefined) out.connectorEnd = readEndpoint(node.connectorEnd, pageId);
  if (node.connectorLineType !== undefined) out.connectorLineType = node.connectorLineType;
  if (node.connectorStartStrokeCap !== undefined) {
    out.connectorStartStrokeCap = node.connectorStartStrokeCap;
  }
  if (node.connectorEndStrokeCap !== undefined)
    out.connectorEndStrokeCap = node.connectorEndStrokeCap;
  return out;
};
