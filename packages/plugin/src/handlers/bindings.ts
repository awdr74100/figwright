import type {
  SerializedBindings,
  SerializedEffect,
  SerializedLayoutGrid,
  SerializedPaint,
} from '@figwright/shared';

import { toFigmaEffect, toFigmaLayoutGrid } from './convert.js';
import { toFigmaPaint } from './set-fills.js';

// Write side of the variable bindings serializePaint / serializeEffect / serializeLayoutGrid read
// (issue #164). Without this a read → edit → write round trip replaces a token reference with the
// frozen literal sitting next to it, and the style silently stops tracking its variable.
//
// Figma will happily accept a binding embedded in a plain object literal — that is the only way to
// bind a gradient stop, which has no setter — but measured against a live file, that path validates
// almost nothing: an id matching no variable, and a variable of the wrong resolved type, are both
// taken without complaint and then render as white. So bindings go through the official
// `setBoundVariableFor*` setters wherever one exists, which reject both, and the one case with no
// setter (a gradient stop) is checked here instead.
//
// Each function resolves every id first and only then builds the result, so a bad id throws before
// anything reaches the document rather than leaving a half-written node or a half-built style.

/** A serialized object's bindings, or undefined when it carries none. */
const bindingsOf = (src: unknown): SerializedBindings | undefined => {
  const raw = (src as { boundVariables?: unknown }).boundVariables;
  return typeof raw === 'object' && raw !== null ? (raw as SerializedBindings) : undefined;
};

/**
 * Every variable id a serialized array references, in the order encountered. Read defensively (the
 * idiom serializer.ts uses in the other direction) because only some members of the paint union
 * declare `boundVariables` at all — an IMAGE or PATTERN paint has no bindable field.
 */
const idsIn = (sources: readonly unknown[]): string[] =>
  sources.flatMap(src => Object.values(bindingsOf(src) ?? {}));

/**
 * Resolve ids → Variables, failing loudly on the first that resolves to nothing. Figma does not do
 * this for us on the literal path: an unknown id is stored as-is and the value renders white, which
 * is exactly the silent breakage this turns into an error.
 */
const resolveVariables = async (
  figmaCtx: typeof figma,
  ids: readonly string[],
  where: string,
): Promise<Map<string, Variable>> => {
  const unique = [...new Set(ids)];
  const resolved = await Promise.all(
    unique.map(async id => figmaCtx.variables.getVariableByIdAsync(id)),
  );
  const table = new Map<string, Variable>();
  for (const [i, variable] of resolved.entries()) {
    const id = unique[i] as string;
    if (variable === null) throw new Error(`${where}: variable ${id} not found`);
    table.set(id, variable);
  }
  return table;
};

const variableFor = (table: ReadonlyMap<string, Variable>, id: string): Variable =>
  table.get(id) as Variable;

/**
 * Bind a gradient stop's colour by embedding the alias, the only route Figma offers —
 * `setBoundVariableForPaint` takes a SolidPaint. That skips its type check, so make the same one
 * here: a non-COLOR variable bound to a stop is accepted silently and paints the stop white.
 * Unknown field names need no check; Figma rejects those on assignment even on this path.
 */
const boundStop = (
  stop: ColorStop,
  bindings: SerializedBindings,
  table: ReadonlyMap<string, Variable>,
  where: string,
): ColorStop => {
  const aliases: Record<string, VariableAlias> = {};
  for (const [field, id] of Object.entries(bindings)) {
    const variable = variableFor(table, id);
    if (field === 'color' && variable.resolvedType !== 'COLOR') {
      throw new Error(
        `${where}: a gradient stop colour takes a COLOR variable; ${variable.name} is ${variable.resolvedType}`,
      );
    }
    aliases[field] = { type: 'VARIABLE_ALIAS', id };
  }
  return { ...stop, boundVariables: aliases } as ColorStop;
};

/** Serialized paints → Figma paints, with each paint's (and each gradient stop's) bindings applied. */
export const toFigmaPaintsBound = async (
  figmaCtx: typeof figma,
  paints: readonly SerializedPaint[],
  where: string,
): Promise<Paint[]> => {
  const stopBindings = paints.flatMap(src =>
    'gradientStops' in src ? idsIn(src.gradientStops) : [],
  );
  const table = await resolveVariables(figmaCtx, [...idsIn(paints), ...stopBindings], where);

  return paints.map(src => {
    const paint = toFigmaPaint(src);
    if (src.type === 'SOLID' && src.boundVariables !== undefined) {
      let bound = paint as SolidPaint;
      for (const [field, id] of Object.entries(src.boundVariables)) {
        bound = figmaCtx.variables.setBoundVariableForPaint(
          bound,
          field as VariableBindablePaintField,
          variableFor(table, id),
        );
      }
      return bound;
    }
    if ('gradientStops' in src && 'gradientStops' in paint) {
      const stops = paint.gradientStops.map((stop, i) => {
        const bindings = src.gradientStops[i]?.boundVariables;
        return bindings === undefined ? stop : boundStop(stop, bindings, table, where);
      });
      return { ...paint, gradientStops: stops } as GradientPaint;
    }
    return paint;
  });
};

/** Serialized effects → Figma effects, with each effect's per-field bindings applied. */
export const toFigmaEffectsBound = async (
  figmaCtx: typeof figma,
  effects: readonly SerializedEffect[],
  where: string,
): Promise<Effect[]> => {
  const table = await resolveVariables(figmaCtx, idsIn(effects), where);
  return effects.map(src => {
    let effect = toFigmaEffect(src);
    for (const [field, id] of Object.entries(src.boundVariables ?? {})) {
      effect = figmaCtx.variables.setBoundVariableForEffect(
        effect,
        field as VariableBindableEffectField,
        variableFor(table, id),
      );
    }
    return effect;
  });
};

/** Serialized layout grids → Figma layout grids, with each grid's per-field bindings applied. */
export const toFigmaLayoutGridsBound = async (
  figmaCtx: typeof figma,
  grids: readonly SerializedLayoutGrid[],
  where: string,
): Promise<LayoutGrid[]> => {
  const table = await resolveVariables(figmaCtx, idsIn(grids), where);
  return grids.map(src => {
    let grid = toFigmaLayoutGrid(src);
    for (const [field, id] of Object.entries(src.boundVariables ?? {})) {
      grid = figmaCtx.variables.setBoundVariableForLayoutGrid(
        grid,
        field as VariableBindableLayoutGridField,
        variableFor(table, id),
      );
    }
    return grid;
  });
};
