import type { DeleteMeasurementResult, MeasurementResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { findMeasurement, pageOf, serializeMeasurement } from '../measurements.js';

const SIDES = ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] as const;

const checkSide = (side: unknown, key: string, tool: string): MeasurementSide => {
  if (!SIDES.includes(side as MeasurementSide)) {
    throw new TypeError(`${tool}: ${key} must be one of ${SIDES.join(' / ')}`);
  }
  return side as MeasurementSide;
};

/** An offset as Figma takes it; its range (INNER -1…1) is Figma's to refuse, in its own words. */
const checkOffset = (raw: unknown, tool: string): MeasurementOffset | undefined => {
  if (raw === undefined) return undefined;
  const o = raw as { type?: unknown; relative?: unknown; fixed?: unknown } | null;
  if (o?.type === 'INNER' && typeof o.relative === 'number') {
    return { type: 'INNER', relative: o.relative };
  }
  if (o?.type === 'OUTER' && typeof o.fixed === 'number') return { type: 'OUTER', fixed: o.fixed };
  throw new TypeError(
    `${tool}: offset must be { type: "INNER", relative } (-1…1 along the span) or ` +
      '{ type: "OUTER", fixed } (a distance outside it)',
  );
};

const checkText = (raw: unknown, tool: string): string | undefined => {
  if (raw !== undefined && typeof raw !== 'string') {
    throw new TypeError(`${tool}: freeText must be a string`);
  }
  return raw;
};

const resultOf = (page: PageNode, m: Measurement): MeasurementResult => {
  const { id, ...rest } = serializeMeasurement(m);
  return { ok: true, measurementId: id, pageId: page.id, ...rest };
};

/**
 * Draw a measurement between two node edges, on the page the nodes are on — never by switching the
 * user's current page (measurements.ts).
 */
export const createAddMeasurementHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const tool = 'add_measurement';
    const p = (params ?? {}) as Record<string, unknown>;
    if (typeof p.startNodeId !== 'string')
      throw new TypeError(`${tool}: startNodeId must be a string`);
    if (typeof p.endNodeId !== 'string') throw new TypeError(`${tool}: endNodeId must be a string`);
    const startSide = checkSide(p.startSide, 'startSide', tool);
    const endSide = checkSide(p.endSide, 'endSide', tool);
    const offset = checkOffset(p.offset, tool);
    const freeText = checkText(p.freeText, tool);

    const start = await figmaCtx.getNodeByIdAsync(p.startNodeId);
    if (start === null) throw new Error(`${tool}: node ${p.startNodeId} not found`);
    const end = await figmaCtx.getNodeByIdAsync(p.endNodeId);
    if (end === null) throw new Error(`${tool}: node ${p.endNodeId} not found`);
    const page = pageOf(start);
    const endPage = pageOf(end);
    if (page === null || endPage === null) {
      throw new Error(`${tool}: ${page === null ? start.id : end.id} is not on a page`);
    }
    if (page !== endPage) {
      throw new Error(
        `${tool}: ${start.id} is on page "${page.name}" and ${end.id} on page "${endPage.name}" — ` +
          'a measurement joins two nodes on one page',
      );
    }

    const options: { offset?: MeasurementOffset; freeText?: string } = {};
    if (offset !== undefined) options.offset = offset;
    if (freeText !== undefined) options.freeText = freeText;
    const measurement = page.addMeasurement(
      { node: start as SceneNode, side: startSide },
      { node: end as SceneNode, side: endSide },
      options,
    );
    return resultOf(page, measurement);
  };

/** Move a measurement's line (its offset) or change its text; either may be omitted. */
export const createUpdateMeasurementHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const tool = 'update_measurement';
    const p = (params ?? {}) as Record<string, unknown>;
    if (typeof p.measurementId !== 'string') {
      throw new TypeError(`${tool}: measurementId must be a string`);
    }
    const offset = checkOffset(p.offset, tool);
    const freeText = checkText(p.freeText, tool);
    const { page, measurement } = await findMeasurement(figmaCtx, p.measurementId, tool);
    if (offset === undefined && freeText === undefined) return resultOf(page, measurement);
    const change: { offset?: MeasurementOffset; freeText?: string } = {};
    if (offset !== undefined) change.offset = offset;
    if (freeText !== undefined) change.freeText = freeText;
    return resultOf(page, page.editMeasurement(p.measurementId, change));
  };

export const createDeleteMeasurementHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const tool = 'delete_measurement';
    const p = (params ?? {}) as Record<string, unknown>;
    if (typeof p.measurementId !== 'string') {
      throw new TypeError(`${tool}: measurementId must be a string`);
    }
    const { page } = await findMeasurement(figmaCtx, p.measurementId, tool);
    page.deleteMeasurement(p.measurementId);
    const result: DeleteMeasurementResult = {
      ok: true,
      measurementId: p.measurementId,
      pageId: page.id,
    };
    return result;
  };
