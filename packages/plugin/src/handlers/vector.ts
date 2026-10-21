import type {
  CreateResult,
  GetVectorResult,
  MutateResult,
  SerializedPaint,
} from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { type Affine, compose, invert } from '../draw.js';
import { serializePaint } from '../serializer.js';
import { toFigmaPathData } from '../svg-path.js';
import { toFigmaPaintsBound } from './bindings.js';
import { applyInitialProps } from './initial-props.js';
import { placeNode } from './place.js';

/**
 * A vector's geometry, read and written in the two forms Figma keeps: SVG path data per subpath,
 * and the vector network (vertices joined by segments, which — unlike a path — may branch, and
 * which carries per-vertex caps, joins and corner radii). A read feeds straight into a write.
 */

const round4 = (v: number): number => {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
};

const isZero = (t: Vector | undefined): boolean => t === undefined || (t.x === 0 && t.y === 0);

/** The network on the wire, with Figma's no-op defaults left out (a write fills them back in). */
export const serializeVectorNetwork = (
  network: VectorNetwork,
  ownerSize: { width: number; height: number } | null,
): GetVectorResult['vectorNetwork'] => ({
  vertices: network.vertices.map(v => ({
    x: round4(v.x),
    y: round4(v.y),
    ...(v.strokeCap !== undefined && v.strokeCap !== 'NONE' ? { strokeCap: v.strokeCap } : {}),
    ...(v.strokeJoin !== undefined && v.strokeJoin !== 'MITER' ? { strokeJoin: v.strokeJoin } : {}),
    ...(typeof v.cornerRadius === 'number' && v.cornerRadius !== 0
      ? { cornerRadius: round4(v.cornerRadius) }
      : {}),
    ...(v.handleMirroring !== undefined && v.handleMirroring !== 'NONE'
      ? { handleMirroring: v.handleMirroring }
      : {}),
  })),
  segments: network.segments.map(s => ({
    start: s.start,
    end: s.end,
    ...(isZero(s.tangentStart)
      ? {}
      : { tangentStart: { x: round4(s.tangentStart!.x), y: round4(s.tangentStart!.y) } }),
    ...(isZero(s.tangentEnd)
      ? {}
      : { tangentEnd: { x: round4(s.tangentEnd!.x), y: round4(s.tangentEnd!.y) } }),
  })),
  ...(network.regions !== undefined && network.regions.length > 0
    ? {
        regions: network.regions.map(r => ({
          windingRule: r.windingRule,
          loops: r.loops.map(loop => [...loop]),
          ...(r.fills !== undefined
            ? { fills: r.fills.map(p => serializePaint(p, ownerSize)) }
            : {}),
          ...(typeof r.fillStyleId === 'string' && r.fillStyleId !== ''
            ? { fillStyleId: r.fillStyleId }
            : {}),
        })),
      }
    : {}),
});

interface NetworkInput {
  vertices?: unknown;
  segments?: unknown;
  regions?: unknown;
}

/**
 * A wire network → Figma's, its indices checked first. Figma's own refusal of a segment pointing
 * past the last vertex does not say which segment; this does, and before anything is written.
 */
export const toFigmaVectorNetwork = async (
  figmaCtx: typeof figma,
  raw: unknown,
  tool: string,
): Promise<VectorNetwork> => {
  const n = (raw ?? {}) as NetworkInput;
  if (!Array.isArray(n.vertices) || n.vertices.length === 0) {
    throw new TypeError(`${tool}: vectorNetwork.vertices must be a non-empty array`);
  }
  if (!Array.isArray(n.segments)) {
    throw new TypeError(`${tool}: vectorNetwork.segments must be an array`);
  }
  const vertexCount = n.vertices.length;
  const segments = n.segments as { start?: unknown; end?: unknown }[];
  segments.forEach((s, i) => {
    for (const end of ['start', 'end'] as const) {
      const v = s[end];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= vertexCount) {
        throw new RangeError(
          `${tool}: segments[${i}].${end} must name one of the ${vertexCount} vertices (0–${vertexCount - 1})`,
        );
      }
    }
  });
  const regions = (Array.isArray(n.regions) ? n.regions : []) as {
    windingRule?: unknown;
    loops?: unknown;
    fills?: unknown;
  }[];
  const out: VectorRegion[] = [];
  for (const [i, r] of regions.entries()) {
    if (!Array.isArray(r.loops))
      throw new TypeError(`${tool}: regions[${i}].loops must be an array`);
    for (const loop of r.loops as unknown[]) {
      if (
        !Array.isArray(loop) ||
        loop.some(
          s => typeof s !== 'number' || !Number.isInteger(s) || s < 0 || s >= segments.length,
        )
      ) {
        throw new RangeError(
          `${tool}: regions[${i}].loops must list segment indices (0–${segments.length - 1})`,
        );
      }
    }
    const region: VectorRegion = {
      windingRule: r.windingRule === 'EVENODD' ? 'EVENODD' : 'NONZERO',
      loops: (r.loops as number[][]).map(loop => loop.slice()),
    };
    if (Array.isArray(r.fills)) {
      // eslint-disable-next-line no-await-in-loop -- a handful of regions, bindings resolved in order
      (region as { fills?: readonly Paint[] }).fills = await toFigmaPaintsBound(
        figmaCtx,
        r.fills as SerializedPaint[],
        tool,
      );
    }
    out.push(region);
  }
  return {
    vertices: n.vertices as VectorVertex[],
    segments: segments as VectorSegment[],
    ...(Array.isArray(n.regions) ? { regions: out } : {}),
  };
};

const checkPaths = (raw: unknown, tool: string): VectorPaths => {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new TypeError(`${tool}: vectorPaths must be a non-empty array`);
  }
  return raw.map((p: { windingRule?: unknown; data?: unknown }, i) => {
    if (typeof p.data !== 'string' || p.data.trim() === '') {
      throw new TypeError(`${tool}: vectorPaths[${i}].data must be SVG path data`);
    }
    const rule = p.windingRule ?? 'NONZERO';
    if (rule !== 'NONZERO' && rule !== 'EVENODD' && rule !== 'NONE') {
      throw new TypeError(
        `${tool}: vectorPaths[${i}].windingRule must be NONZERO, EVENODD or NONE`,
      );
    }
    try {
      return { windingRule: rule, data: toFigmaPathData(p.data) };
    } catch (error) {
      throw new SyntaxError(
        `${tool}: vectorPaths[${i}].data is not valid SVG path data: ${(error as Error).message}`,
        { cause: error },
      );
    }
  });
};

/** Exactly one of the two geometries, checked and converted before any node is touched. */
const geometryOf = async (
  figmaCtx: typeof figma,
  p: { vectorPaths?: unknown; vectorNetwork?: unknown },
  tool: string,
): Promise<{ paths: VectorPaths } | { network: VectorNetwork }> => {
  if ((p.vectorPaths === undefined) === (p.vectorNetwork === undefined)) {
    throw new TypeError(`${tool}: give exactly one of vectorPaths or vectorNetwork`);
  }
  return p.vectorPaths !== undefined
    ? { paths: checkPaths(p.vectorPaths, tool) }
    : { network: await toFigmaVectorNetwork(figmaCtx, p.vectorNetwork, tool) };
};

const draw = async (
  node: VectorNode,
  geometry: { paths: VectorPaths } | { network: VectorNetwork },
): Promise<void> => {
  if ('paths' in geometry) node.vectorPaths = geometry.paths;
  else await node.setVectorNetworkAsync(geometry.network);
};

export const createGetVectorHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('get_vector: nodeId must be a string');
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || (node.type !== 'VECTOR' && node.type !== 'TEXT_PATH')) {
      throw new Error(
        `get_vector: node ${p.nodeId} is ${node === null ? 'not found' : `a ${node.type}`} — only a ` +
          'VECTOR or text on a path has a path to read (flatten_nodes turns a shape into a VECTOR)',
      );
    }
    const vector = node as VectorNode | TextPathNode;
    const size = { width: vector.width, height: vector.height };
    const mirroring = vector.handleMirroring;
    const result: GetVectorResult = {
      nodeId: vector.id,
      type: vector.type,
      width: vector.width,
      height: vector.height,
      vectorPaths: vector.vectorPaths.map(path => ({
        windingRule: path.windingRule,
        data: path.data,
      })),
      vectorNetwork: serializeVectorNetwork(vector.vectorNetwork, size),
      handleMirroring: typeof mirroring === 'string' ? mirroring : 'mixed',
    };
    return result;
  };

export const createCreateVectorHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const tool = 'create_vector';
    const p = (params ?? {}) as {
      parentId?: unknown;
      name?: unknown;
      x?: unknown;
      y?: unknown;
      vectorPaths?: unknown;
      vectorNetwork?: unknown;
    };
    const geometry = await geometryOf(figmaCtx, p, tool);
    const vector = figmaCtx.createVector();
    try {
      if (typeof p.name === 'string') vector.name = p.name;
      // x / y place the drawing's origin, set before it is drawn: Figma then fits the node to the
      // drawing by moving it, so a point at (10, 4) lands at (x + 10, y + 4) as with set_vector.
      vector.x = typeof p.x === 'number' ? p.x : 0;
      vector.y = typeof p.y === 'number' ? p.y : 0;
      await draw(vector, geometry);
      await placeNode(figmaCtx, vector, p.parentId, tool);
      await applyInitialProps(figmaCtx, vector, params as Record<string, unknown>, tool);
    } catch (error) {
      // A vector Figma refused to draw (bad path data, a malformed network) is not left behind.
      vector.remove();
      throw error;
    }
    const result: CreateResult = {
      ok: true,
      nodeId: vector.id,
      name: vector.name,
      type: vector.type,
    };
    return result;
  };

export const createSetVectorHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const tool = 'set_vector';
    const p = (params ?? {}) as {
      nodeId?: unknown;
      vectorPaths?: unknown;
      vectorNetwork?: unknown;
    };
    if (typeof p.nodeId !== 'string') throw new TypeError(`${tool}: nodeId must be a string`);
    const geometry = await geometryOf(figmaCtx, p, tool);
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || node.type !== 'VECTOR') {
      throw new Error(
        `${tool}: node ${p.nodeId} is ${node === null ? 'not found' : `a ${node.type}`} — only a ` +
          'VECTOR can be redrawn (flatten_nodes turns a shape into one; a text path keeps its path)',
      );
    }
    await draw(node, geometry);
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };

/**
 * The space a node's relativeTransform is written in, as an absolute map (a group's child uses the
 * group's parent's).
 */
const childSpaceOf = (node: SceneNode): Affine | null => {
  const relative = invert(node.relativeTransform);
  return relative === null ? null : compose(node.absoluteTransform, relative);
};

/**
 * Figma hands an outline to the page with a transform measured from the source's parent's own
 * top-left — for a group, the group's box, not the space its children are placed in — so it would
 * jump. Put it just above the source instead — or above the outermost instance, boolean or repeat
 * group holding it — at the spot the stroke was drawn; in an auto-layout parent it is absolutely
 * positioned, so the flow around it does not move.
 */
/**
 * Containers the outline must not join: an instance takes no new layers, a boolean would merge it
 * into its shape, and a repeat group would repeat it and re-space its copies.
 */
const OUTLINE_ABOVE: ReadonlySet<string> = new Set([
  'INSTANCE',
  'BOOLEAN_OPERATION',
  'TRANSFORM_GROUP',
]);

export const placeOutline = (source: SceneNode, outline: SceneNode): void => {
  const from = source.parent;
  const target =
    from !== null && 'absoluteTransform' in from
      ? compose((from as SceneNode).absoluteTransform, outline.relativeTransform)
      : outline.relativeTransform;
  let anchor = source;
  for (let p = from; p !== null && p.type !== 'PAGE'; p = p.parent) {
    if (OUTLINE_ABOVE.has(p.type)) anchor = p as SceneNode;
  }
  const parent = anchor.parent as (BaseNode & ChildrenMixin) | null;
  if (parent === null) return;
  parent.insertChild(parent.children.indexOf(anchor) + 1, outline);
  if ('layoutMode' in parent && parent.layoutMode !== 'NONE' && 'layoutPositioning' in outline) {
    outline.layoutPositioning = 'ABSOLUTE';
  }
  const space = childSpaceOf(outline);
  const back = space === null ? null : invert(space);
  if (back !== null) outline.relativeTransform = compose(back, target) as Transform;
};

export const createOutlineStrokeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const tool = 'outline_stroke';
    const p = (params ?? {}) as { nodeId?: unknown; name?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError(`${tool}: nodeId must be a string`);
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('outlineStroke' in node)) {
      throw new Error(`${tool}: node ${p.nodeId} not found or has no stroke to outline`);
    }
    const source = node as SceneNode & GeometryMixin;
    // Checked first: on text on a path with nothing to outline, Figma throws about a node that
    // "does not exist" instead of returning null as it does elsewhere.
    const drawn =
      source.strokes.some(paint => paint.visible !== false) && source.strokeWeight !== 0;
    const outline = drawn ? source.outlineStroke() : null;
    if (outline === null) {
      throw new Error(
        `${tool}: node ${p.nodeId} has no stroke to outline — give it one with set_strokes`,
      );
    }
    try {
      placeOutline(source, outline);
    } catch (error) {
      outline.remove();
      throw error;
    }
    if (typeof p.name === 'string') outline.name = p.name;
    const result: CreateResult = {
      ok: true,
      nodeId: outline.id,
      name: outline.name,
      type: outline.type,
    };
    return result;
  };
