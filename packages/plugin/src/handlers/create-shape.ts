import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { applyInitialProps } from './initial-props.js';
import { placeNode } from './place.js';

const SHAPES = new Set(['LINE', 'POLYGON', 'STAR']);

const optionalNumber = (value: unknown, name: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`create_shape: ${name} must be a number`);
  }
  return value;
};

/**
 * Create a line, polygon or star. Its own arguments are all checked before a node exists, and a
 * style step that is refused removes the node, so a refusal never leaves an orphan on the page. A
 * line is a length — Figma draws it with height 0 — so its height is refused rather than stored as
 * a number that renders as nothing.
 */
export const createCreateShapeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      shape?: unknown;
      parentId?: unknown;
      name?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
      pointCount?: unknown;
      innerRadius?: unknown;
    };
    if (typeof p.shape !== 'string' || !SHAPES.has(p.shape)) {
      throw new TypeError('create_shape: shape must be LINE, POLYGON or STAR');
    }
    const width = optionalNumber(p.width, 'width');
    const height = optionalNumber(p.height, 'height');
    const x = optionalNumber(p.x, 'x');
    const y = optionalNumber(p.y, 'y');
    const pointCount = optionalNumber(p.pointCount, 'pointCount');
    const innerRadius = optionalNumber(p.innerRadius, 'innerRadius');

    if (p.shape === 'LINE') {
      if (height !== undefined) {
        throw new TypeError('create_shape: a LINE has no height — pass width as its length');
      }
      if (pointCount !== undefined || innerRadius !== undefined) {
        throw new TypeError('create_shape: pointCount / innerRadius do not apply to a LINE');
      }
    }
    if (p.shape === 'POLYGON' && innerRadius !== undefined) {
      throw new TypeError('create_shape: innerRadius applies to a STAR only');
    }
    // Figma silently draws 60 for any larger count (measured), so refuse rather than misreport.
    if (
      pointCount !== undefined &&
      (!Number.isInteger(pointCount) || pointCount < 3 || pointCount > 60)
    ) {
      throw new TypeError('create_shape: pointCount must be an integer from 3 to 60');
    }
    // 0 is a star with no area — Figma accepts it and draws nothing.
    if (innerRadius !== undefined && (innerRadius <= 0 || innerRadius > 1)) {
      throw new TypeError('create_shape: innerRadius must be above 0 and at most 1');
    }

    let node: LineNode | PolygonNode | StarNode;
    if (p.shape === 'LINE') {
      node = figmaCtx.createLine();
      if (width !== undefined) node.resize(width, 0);
    } else if (p.shape === 'POLYGON') {
      node = figmaCtx.createPolygon();
      if (pointCount !== undefined) node.pointCount = pointCount;
    } else {
      node = figmaCtx.createStar();
      if (pointCount !== undefined) node.pointCount = pointCount;
      if (innerRadius !== undefined) node.innerRadius = innerRadius;
    }

    if (p.shape !== 'LINE' && (width !== undefined || height !== undefined)) {
      // One dimension given: keep the shape regular rather than leaving the other at its default.
      node.resize(width ?? height!, height ?? width!);
    }
    if (typeof p.name === 'string') node.name = p.name;
    if (x !== undefined) node.x = x;
    if (y !== undefined) node.y = y;

    await placeNode(figmaCtx, node, p.parentId, 'create_shape');
    await applyInitialProps(figmaCtx, node, params as Record<string, unknown>, 'create_shape');

    const result: CreateResult = { ok: true, nodeId: node.id, name: node.name, type: node.type };
    return result;
  };
