import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * Figma Draw strokes: a brush, a dynamic (hand-drawn) stroke, a width that varies along the path.
 * Figma checks the ranges itself; what it does not say is which field belongs to which kind — it
 * answers a STRETCH brush given a `gap` with a dump of every union branch it tried — so the pairing
 * is checked here, and a refusal names the field.
 */

const STRETCH = new Set([
  'HEIST',
  'BLOCKBUSTER',
  'GRINDHOUSE',
  'BIOPIC',
  'SPAGHETTI_WESTERN',
  'SLASHER',
  'HARDBOILED',
  'VERITE',
  'EPIC',
  'SCREWBALL',
  'ROM_COM',
  'NOIR',
  'PROPAGANDA',
  'MELODRAMA',
  'NEW_WAVE',
]);
const SCATTER = new Set([
  'BUBBLEGUM',
  'WITCH_HOUSE',
  'SHOEGAZE',
  'HONKY_TONK',
  'SCREAMO',
  'DRONE',
  'DOO_WOP',
  'SPOKEN_WORD',
  'VAPORWAVE',
  'OI',
]);

/** The fields each kind takes beyond its type (and brushType / brushName for a brush). */
const FIELDS: Record<string, readonly string[]> = {
  BASIC: [],
  STRETCH: ['direction'],
  SCATTER: ['gap', 'wiggle', 'sizeJitter', 'angularJitter', 'rotation'],
  DYNAMIC: ['frequency', 'wiggle', 'smoothen'],
};
const PRESETS = new Set(['UNIFORM', 'WEDGE', 'TAPER', 'QUARTER_TAPER', 'EYE', 'MIRRORED_TAPER']);

export const toFigmaComplexStroke = (raw: unknown, tool: string): ComplexStrokeProperties => {
  const c = (raw ?? {}) as Record<string, unknown>;
  const kind = c.type === 'BRUSH' ? c.brushType : c.type;
  const allowed = typeof kind === 'string' ? FIELDS[kind] : undefined;
  if (allowed === undefined) {
    throw new TypeError(
      `${tool}: complexStrokeProperties needs type BASIC, DYNAMIC, or BRUSH with brushType ` +
        'STRETCH or SCATTER',
    );
  }
  if (c.type === 'BRUSH') {
    const names = kind === 'STRETCH' ? STRETCH : SCATTER;
    if (typeof c.brushName !== 'string' || !names.has(c.brushName)) {
      throw new TypeError(
        `${tool}: a ${String(kind)} brush needs a brushName from ${[...names].join(', ')}` +
          (c.brushName === 'CUSTOM'
            ? ' (a CUSTOM brush cannot be set through the plugin API)'
            : ''),
      );
    }
  }
  const extra = Object.keys(c).filter(
    k => !['type', 'brushType', 'brushName', ...allowed].includes(k) && c[k] !== undefined,
  );
  if (extra.length > 0) {
    throw new TypeError(
      `${tool}: ${extra.join(', ')} ${extra.length === 1 ? 'does' : 'do'} not apply to a ` +
        `${String(kind)} stroke${allowed.length > 0 ? ` (it takes ${allowed.join(', ')})` : ''}`,
    );
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) if (v !== undefined) out[k] = v;
  return out as unknown as ComplexStrokeProperties;
};

export const toFigmaVariableWidth = (raw: unknown, tool: string): VariableWidthStrokeProperties => {
  const w = (raw ?? {}) as { widthProfile?: unknown; variableWidthPoints?: unknown };
  if (w.widthProfile === 'CUSTOM') {
    if (!Array.isArray(w.variableWidthPoints) || w.variableWidthPoints.length === 0) {
      throw new TypeError(`${tool}: a CUSTOM width profile needs variableWidthPoints`);
    }
    return {
      widthProfile: 'CUSTOM',
      variableWidthPoints: w.variableWidthPoints as VariableWidthPoint[],
    };
  }
  if (typeof w.widthProfile !== 'string' || !PRESETS.has(w.widthProfile)) {
    throw new TypeError(
      `${tool}: widthProfile must be CUSTOM or one of ${[...PRESETS].join(', ')}`,
    );
  }
  // A preset's points are its own (get_node reports them); any given alongside it are not an input.
  return { widthProfile: w.widthProfile as PresetVariableWidthStrokeProperties['widthProfile'] };
};

const hasVisibleStroke = (node: BaseNode): boolean => {
  const strokes = (node as Partial<MinimalStrokesMixin>).strokes;
  return Array.isArray(strokes) && strokes.some(p => p.visible !== false);
};

export const createSetComplexStrokeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const tool = 'set_complex_stroke';
    const p = (params ?? {}) as {
      nodeId?: unknown;
      complexStrokeProperties?: unknown;
      variableWidthStrokeProperties?: unknown;
    };
    if (typeof p.nodeId !== 'string') throw new TypeError(`${tool}: nodeId must be a string`);
    if (p.complexStrokeProperties === undefined && p.variableWidthStrokeProperties === undefined) {
      throw new TypeError(
        `${tool}: give complexStrokeProperties, variableWidthStrokeProperties or both`,
      );
    }
    const complex =
      p.complexStrokeProperties === undefined
        ? undefined
        : toFigmaComplexStroke(p.complexStrokeProperties, tool);
    const widths =
      p.variableWidthStrokeProperties === undefined
        ? undefined
        : toFigmaVariableWidth(p.variableWidthStrokeProperties, tool);

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('complexStrokeProperties' in node)) {
      throw new Error(`${tool}: node ${p.nodeId} not found or has no stroke to restyle`);
    }
    // A brush or a profile on a node with no stroke reads back and draws nothing (measured).
    if (!hasVisibleStroke(node)) {
      throw new Error(
        `${tool}: node ${p.nodeId} has no visible stroke for this to shape — give it one with ` +
          'set_strokes first',
      );
    }
    if (complex?.type === 'BRUSH') await figmaCtx.loadBrushesAsync(complex.brushType);

    const target = node as BaseNode & ComplexStrokesMixin;
    // The width first: it is the write that can still be refused (a branching vector), and
    // nothing has changed yet if it is.
    if (widths !== undefined) {
      try {
        target.variableWidthStrokeProperties = widths;
      } catch (error) {
        if (/complex vector/i.test(String(error))) {
          throw new Error(
            `${tool}: node ${p.nodeId} is a vector that branches, which cannot take a width ` +
              'profile (a brush or a dynamic stroke still can)',
            { cause: error },
          );
        }
        throw error;
      }
    }
    if (complex !== undefined) target.complexStrokeProperties = complex;

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
