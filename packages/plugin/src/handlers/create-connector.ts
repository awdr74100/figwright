import type { CreateResult, SerializedPaint } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaPaintsBound } from './bindings.js';
import { placeNode } from './place.js';

const DEFAULT_FONT: FontName = { family: 'Inter', style: 'Regular' };

/** Build a ConnectorEndpoint from the loose { endpointNodeId?, magnet?, position? } wire shape. */
const toEndpoint = (raw: unknown, side: 'connectorStart' | 'connectorEnd'): ConnectorEndpoint => {
  const p = (raw ?? {}) as { endpointNodeId?: unknown; magnet?: unknown; position?: unknown };
  const hasNodeId = typeof p.endpointNodeId === 'string';
  const hasPosition = typeof p.position === 'object' && p.position !== null;
  if (!hasNodeId && !hasPosition) {
    throw new TypeError(`create_connector: ${side} needs endpointNodeId and/or position`);
  }
  if (hasPosition) {
    const pos = p.position as { x?: unknown; y?: unknown };
    if (typeof pos.x !== 'number' || typeof pos.y !== 'number') {
      throw new TypeError(`create_connector: ${side}.position must be { x: number, y: number }`);
    }
    return hasNodeId
      ? { position: { x: pos.x, y: pos.y }, endpointNodeId: p.endpointNodeId as string }
      : { position: { x: pos.x, y: pos.y } };
  }
  // endpointNodeId without position: magnet is required by the plugin API, default to AUTO.
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
    if (p.connectorStart === undefined) {
      throw new TypeError('create_connector: connectorStart is required');
    }
    if (p.connectorEnd === undefined) {
      throw new TypeError('create_connector: connectorEnd is required');
    }
    if (
      p.strokeWeight !== undefined &&
      (typeof p.strokeWeight !== 'number' || p.strokeWeight < 0)
    ) {
      throw new TypeError('create_connector: strokeWeight must be a non-negative number');
    }
    if (p.text !== undefined && typeof p.text !== 'string') {
      throw new TypeError('create_connector: text must be a string');
    }

    const connectorStart = toEndpoint(p.connectorStart, 'connectorStart');
    const connectorEnd = toEndpoint(p.connectorEnd, 'connectorEnd');

    const connector = figmaCtx.createConnector();
    connector.connectorStart = connectorStart;
    connector.connectorEnd = connectorEnd;
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
    if (Array.isArray(p.strokes)) {
      connector.strokes = await toFigmaPaintsBound(
        figmaCtx,
        p.strokes as SerializedPaint[],
        'create_connector',
      );
    }
    if (typeof p.strokeWeight === 'number') connector.strokeWeight = p.strokeWeight;
    if (typeof p.text === 'string') {
      // A fresh ConnectorNode's text.fontName is invalid until explicitly set — unlike TextNode,
      // it cannot be read and loaded back. Load the default font, assign it, then write characters.
      await figmaCtx.loadFontAsync(DEFAULT_FONT);
      connector.text.fontName = DEFAULT_FONT;
      connector.text.characters = p.text;
    }

    await placeNode(figmaCtx, connector, p.parentId, 'create_connector');

    const result: CreateResult = {
      ok: true,
      nodeId: connector.id,
      name: connector.name,
      type: connector.type,
    };
    return result;
  };
