import type { CreateResult, SerializedPaint } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaPaintsBound } from './bindings.js';
import { placeNode } from './place.js';
import { CAPTION_FONT } from './text-sublayer.js';

const TOOL = 'create_connector';

/**
 * A ConnectorEndpoint from the wire's { endpointNodeId?, magnet?, position? }. Measured on
 * 2026-11-21 in FigJam: a `position` with an `endpointNodeId` is an offset in px from that node's
 * top-left (outside it allowed), and a `position` alone is in the connector's parent's coordinates
 * — it moves with the parent.
 */
const toEndpoint = (raw: unknown, side: 'connectorStart' | 'connectorEnd'): ConnectorEndpoint => {
  const p = (raw ?? {}) as { endpointNodeId?: unknown; magnet?: unknown; position?: unknown };
  const hasNodeId = typeof p.endpointNodeId === 'string';
  const hasPosition = typeof p.position === 'object' && p.position !== null;
  if (!hasNodeId && !hasPosition) {
    throw new TypeError(`${TOOL}: ${side} needs endpointNodeId, position or both`);
  }
  if (hasPosition && p.magnet !== undefined) {
    throw new TypeError(
      `${TOOL}: ${side} takes a magnet or a position, not both — a position already says where on the node it attaches`,
    );
  }
  if (hasPosition) {
    const pos = p.position as { x?: unknown; y?: unknown };
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      throw new TypeError(`${TOOL}: ${side}.position must be { x, y } finite numbers`);
    }
    const position = { x: pos.x as number, y: pos.y as number };
    return hasNodeId ? { position, endpointNodeId: p.endpointNodeId as string } : { position };
  }
  // Figma requires a magnet with a bare node id; AUTO lets it pick the nearest side.
  const magnet = typeof p.magnet === 'string' ? p.magnet : 'AUTO';
  return {
    endpointNodeId: p.endpointNodeId as string,
    magnet: magnet as ConnectorEndpointEndpointNodeIdAndMagnet['magnet'],
  };
};

export const createCreateConnectorHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      parentId?: unknown;
      name?: unknown;
      connectorStart?: unknown;
      connectorEnd?: unknown;
      connectorLineType?: unknown;
      connectorStartStrokeCap?: unknown;
      connectorEndStrokeCap?: unknown;
      strokes?: unknown;
      strokeWeight?: unknown;
      text?: unknown;
    };
    // Figma Design and Dev Mode have no connectors: the API is missing, and its bare "not a
    // function" would say nothing about why (measured).
    if (typeof (figmaCtx as { createConnector?: unknown }).createConnector !== 'function') {
      throw new Error(
        `${TOOL}: connectors are FigJam layers, and this file is not a FigJam board — in Figma ` +
          'Design draw an arrow with create_vector, an arrow strokeCap on the end vertex of its ' +
          'vectorNetwork',
      );
    }
    if (p.connectorStart === undefined) throw new TypeError(`${TOOL}: connectorStart is required`);
    if (p.connectorEnd === undefined) throw new TypeError(`${TOOL}: connectorEnd is required`);
    if (
      p.strokeWeight !== undefined &&
      (typeof p.strokeWeight !== 'number' || !Number.isFinite(p.strokeWeight) || p.strokeWeight < 0)
    ) {
      throw new TypeError(`${TOOL}: strokeWeight must be a non-negative number`);
    }
    if (p.text !== undefined && typeof p.text !== 'string') {
      throw new TypeError(`${TOOL}: text must be a string`);
    }
    const connectorStart = toEndpoint(p.connectorStart, 'connectorStart');
    const connectorEnd = toEndpoint(p.connectorEnd, 'connectorEnd');

    // Everything that can be checked or fetched is, before the connector exists. An end's node is
    // not looked up here: a lookup of an id the file does not hold goes to Figma's server and can
    // stall for 10 s (measured), while assigning it is refused at once — so that refusal, caught
    // below, is the check.
    const strokes = Array.isArray(p.strokes)
      ? await toFigmaPaintsBound(figmaCtx, p.strokes as SerializedPaint[], TOOL)
      : undefined;
    // A new connector's label names no font, and Figma writes it in FigJam's caption face, which has
    // to be loaded first (measured: its refusal names Inter Medium).
    if (typeof p.text === 'string') await figmaCtx.loadFontAsync(CAPTION_FONT);

    const connector = figmaCtx.createConnector();
    try {
      for (const [side, end] of [
        ['connectorStart', connectorStart],
        ['connectorEnd', connectorEnd],
      ] as const) {
        try {
          connector[side] = end;
        } catch (error) {
          const id = 'endpointNodeId' in end ? end.endpointNodeId : undefined;
          throw new Error(
            id === undefined
              ? `${TOOL}: Figma refused ${side}: ${String(error)}`
              : `${TOOL}: ${side}.endpointNodeId ${id} is not a node this connector can attach to ` +
                  `(Figma: ${error instanceof Error ? error.message : String(error)})`,
            { cause: error },
          );
        }
      }
      if (typeof p.name === 'string') connector.name = p.name;
      if (typeof p.connectorLineType === 'string') {
        connector.connectorLineType = p.connectorLineType as ConnectorNode['connectorLineType'];
      }
      if (typeof p.connectorStartStrokeCap === 'string') {
        connector.connectorStartStrokeCap = p.connectorStartStrokeCap as ConnectorStrokeCap;
      }
      if (typeof p.connectorEndStrokeCap === 'string') {
        connector.connectorEndStrokeCap = p.connectorEndStrokeCap as ConnectorStrokeCap;
      }
      if (strokes !== undefined) connector.strokes = strokes;
      if (typeof p.strokeWeight === 'number') connector.strokeWeight = p.strokeWeight;
      if (typeof p.text === 'string') connector.text.characters = p.text;
    } catch (error) {
      connector.remove();
      throw error;
    }
    // Removes the connector itself if the parent refuses it.
    await placeNode(figmaCtx, connector, p.parentId, TOOL);

    const result: CreateResult = {
      ok: true,
      nodeId: connector.id,
      name: connector.name,
      type: connector.type,
    };
    return result;
  };
