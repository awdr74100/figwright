import type { CreateResult, MutateResult, SerializedPaint } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaPaintsBound } from './bindings.js';
import { toFigmaFontName } from './convert.js';
import { writePaints } from './paints.js';

/** What figma.createTextPath accepts (anything else it refuses). */
const PATH_SOURCES = new Set(['VECTOR', 'LINE', 'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR']);

/** A new text path's face until told otherwise (measured — Figma's own default). */
const DEFAULT_FONT: FontName = { family: 'Inter', style: 'Regular' };

/** Containers Figma deletes the moment their last child leaves. */
const SELF_DELETING = new Set(['GROUP', 'BOOLEAN_OPERATION', 'TRANSFORM_GROUP']);

const H_ALIGN = new Set(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']);
const V_ALIGN = new Set(['TOP', 'CENTER', 'BOTTOM']);

const checkStart = (
  tool: string,
  segment: unknown,
  position: unknown,
): { segment?: number; position?: number } => {
  if (
    segment !== undefined &&
    (typeof segment !== 'number' || !Number.isInteger(segment) || segment < 0)
  ) {
    throw new TypeError(`${tool}: startSegment must be a whole number ≥ 0`);
  }
  if (position !== undefined && (typeof position !== 'number' || position < 0 || position > 1)) {
    throw new RangeError(`${tool}: startPosition must be between 0 and 1`);
  }
  return {
    ...(segment === undefined ? {} : { segment: segment as number }),
    ...(position === undefined ? {} : { position: position as number }),
  };
};

/**
 * An index past the last segment is not refused by Figma, it is dropped — at creation the text
 * starts at segment 0, on an existing path the start stays where it was (both measured).
 */
const outOfRange = (
  tool: string,
  id: string,
  segment: number,
  count: number,
  fallback: string,
): Error =>
  new RangeError(
    `${tool}: ${id}'s path has ${count} segment${count === 1 ? '' : 's'} (0–${count - 1}), so ` +
      `startSegment ${segment} does not exist — Figma would silently ${fallback}`,
  );

/**
 * How many segments the path a node becomes will have. Only a vector exposes its network before it
 * is converted; for a shape it is read off a throwaway copy, so a bad start is refused while the
 * source is still untouched (Figma itself silently drops an index past the end).
 */
const segmentsOf = (figmaCtx: typeof figma, node: SceneNode): number => {
  if (node.type === 'VECTOR') return node.vectorNetwork.segments.length;
  const copy = (node as RectangleNode).clone();
  const probe = figmaCtx.createTextPath(copy as unknown as VectorNode, 0, 0);
  const count = probe.vectorNetwork.segments.length;
  probe.remove();
  return count;
};

export const createCreateTextPathHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const tool = 'create_text_path';
    const p = (params ?? {}) as {
      nodeId?: unknown;
      characters?: unknown;
      startSegment?: unknown;
      startPosition?: unknown;
      fontName?: unknown;
      fontSize?: unknown;
      fills?: unknown;
      textAlignHorizontal?: unknown;
      textAlignVertical?: unknown;
      name?: unknown;
    };
    if (typeof p.nodeId !== 'string') throw new TypeError(`${tool}: nodeId must be a string`);
    if (typeof p.characters !== 'string' || p.characters === '') {
      throw new TypeError(`${tool}: characters must be a non-empty string`);
    }
    const start = checkStart(tool, p.startSegment, p.startPosition);
    if (p.fontSize !== undefined && (typeof p.fontSize !== 'number' || p.fontSize <= 0)) {
      throw new TypeError(`${tool}: fontSize must be a positive number`);
    }
    if (p.textAlignHorizontal !== undefined && !H_ALIGN.has(p.textAlignHorizontal as string)) {
      throw new TypeError(`${tool}: textAlignHorizontal must be LEFT, CENTER, RIGHT or JUSTIFIED`);
    }
    if (p.textAlignVertical !== undefined && !V_ALIGN.has(p.textAlignVertical as string)) {
      throw new TypeError(`${tool}: textAlignVertical must be TOP, CENTER or BOTTOM`);
    }
    if (p.fills !== undefined && !Array.isArray(p.fills)) {
      throw new TypeError(`${tool}: fills must be an array`);
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !PATH_SOURCES.has(node.type)) {
      throw new Error(
        `${tool}: node ${p.nodeId} is ${node === null ? 'not found' : `a ${node.type}`} — text ` +
          'can follow a vector, a line or a shape (rectangle, ellipse, polygon, star)',
      );
    }
    const source = node as SceneNode;
    const parent = source.parent;
    if (parent === null || !('insertChild' in parent)) {
      throw new Error(`${tool}: node ${p.nodeId} has no parent to keep the text in`);
    }

    // Everything that can fail is settled before the source is consumed: the faces, the paints, and
    // the start segment.
    const font =
      p.fontName === undefined
        ? undefined
        : (toFigmaFontName(p.fontName as Record<string, unknown>) as FontName);
    await Promise.all(
      [DEFAULT_FONT, ...(font === undefined ? [] : [font])].map(f => figmaCtx.loadFontAsync(f)),
    );
    const fills =
      p.fills === undefined
        ? undefined
        : await toFigmaPaintsBound(figmaCtx, p.fills as SerializedPaint[], tool);
    if (start.segment !== undefined && start.segment > 0) {
      const count = segmentsOf(figmaCtx, source);
      if (start.segment >= count) {
        throw outOfRange(tool, p.nodeId, start.segment, count, 'start the text at segment 0');
      }
    }

    // Figma hands the result to the page, keeping only its local transform — so a shape inside a
    // frame jumps (measured: from 2100,1100 to 300,400). Putting it back at the source's index puts
    // it back where it was drawn.
    const container = parent as BaseNode & ChildrenMixin;
    const index = container.children.indexOf(source);
    // The conversion takes the shape out of its parent, and a group left empty is deleted on the
    // spot — measured: the group went with it and the text had nowhere to go back to. A stand-in
    // keeps a group of one alive until the text takes the shape's place.
    let standIn: SceneNode | null = null;
    if (SELF_DELETING.has(parent.type) && container.children.length === 1) {
      standIn = figmaCtx.createRectangle();
      container.appendChild(standIn);
    }
    const text = figmaCtx.createTextPath(
      source as VectorNode,
      start.segment ?? 0,
      start.position ?? 0,
    );
    container.insertChild(index, text);
    standIn?.remove();
    if (font !== undefined) text.fontName = font;
    if (typeof p.fontSize === 'number') text.fontSize = p.fontSize;
    text.characters = p.characters;
    if (fills !== undefined) await writePaints(text, 'fills', fills);
    if (typeof p.textAlignHorizontal === 'string') {
      text.textAlignHorizontal = p.textAlignHorizontal as TextPathNode['textAlignHorizontal'];
    }
    if (typeof p.textAlignVertical === 'string') {
      text.textAlignVertical = p.textAlignVertical as TextPathNode['textAlignVertical'];
    }
    if (typeof p.name === 'string') text.name = p.name;

    const result: CreateResult = { ok: true, nodeId: text.id, name: text.name, type: text.type };
    return result;
  };

export const createSetTextPathHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const tool = 'set_text_path';
    const p = (params ?? {}) as {
      nodeId?: unknown;
      startSegment?: unknown;
      startPosition?: unknown;
    };
    if (typeof p.nodeId !== 'string') throw new TypeError(`${tool}: nodeId must be a string`);
    const start = checkStart(tool, p.startSegment, p.startPosition);
    if (start.segment === undefined && start.position === undefined) {
      throw new TypeError(`${tool}: give startSegment, startPosition or both`);
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || node.type !== 'TEXT_PATH') {
      throw new Error(
        `${tool}: node ${p.nodeId} is not text on a path (TEXT_PATH) — make one with create_text_path`,
      );
    }
    const count = node.vectorNetwork.segments.length;
    const segment = start.segment ?? node.textPathStartData.segment;
    if (segment >= count) {
      throw outOfRange(tool, p.nodeId, segment, count, 'keep the start where it is');
    }
    node.textPathStartData = {
      segment,
      position: start.position ?? node.textPathStartData.position,
    };

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
