import type {
  GetStylesResult,
  ResolvedToken,
  SerializedBindings,
  SerializedLineHeight,
  SerializedTextStyle,
} from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import {
  collectBindings,
  serializeCodeSyntax,
  serializeEffect,
  serializeFontName,
  serializeLayoutGrid,
  serializePaint,
} from '../serializer.js';

const serializeLineHeight = (lh: LineHeight): SerializedLineHeight =>
  lh.unit === 'AUTO' ? { unit: 'AUTO' } : { unit: lh.unit, value: lh.value };

/**
 * Every variable id the serialized styles reference. Bindings ride on the individual paint /
 * gradient stop / effect / layout grid (Figma keeps them there, not on the style), except for a
 * text style, whose values are scalars and so binds on the style itself.
 *
 * A paint / effect / grid style ALSO exposes a style-level `boundVariables` (`{ paints | effects |
 * layoutGrids: VariableAlias[] }`), which is deliberately not read: measured against a live file it
 * is a flat list of whichever variables happen to be bound somewhere in the array — it says neither
 * which paint/effect nor which field — so it is a strictly lossy summary of what the per-object
 * bindings already carry exactly.
 */
const collectVariableIds = (result: GetStylesResult): Set<string> => {
  const ids = new Set<string>();
  const add = (bindings: SerializedBindings | undefined): void => {
    if (bindings !== undefined) for (const id of Object.values(bindings)) ids.add(id);
  };
  for (const style of result.paints) {
    for (const paint of style.paints) {
      if (paint.type === 'SOLID') add(paint.boundVariables);
      else if ('gradientStops' in paint) for (const s of paint.gradientStops) add(s.boundVariables);
    }
  }
  for (const style of result.texts) add(style.boundVariables);
  for (const style of result.effects) for (const e of style.effects) add(e.boundVariables);
  for (const style of result.grids) for (const g of style.grids) add(g.boundVariables);
  return ids;
};

/**
 * Resolve variable ids → names, mirroring get_design_context's `variables` table so both grounding
 * surfaces speak the same shape. An id that no longer resolves is skipped rather than fatal: the
 * inline value stays as the fallback, exactly as it does today.
 */
const resolveVariables = async (
  figmaCtx: typeof figma,
  ids: ReadonlySet<string>,
): Promise<Record<string, ResolvedToken> | undefined> => {
  const getVar = figmaCtx.variables?.getVariableByIdAsync;
  if (ids.size === 0 || typeof getVar !== 'function') return undefined;
  const ordered = [...ids];
  // Resolved in parallel but assembled in walk order: writing each id as its promise settles would
  // key the table by whichever lookup finished first, so the same document could serialize two
  // different byte sequences on two runs.
  const resolved = await Promise.all(
    ordered.map(async (id): Promise<ResolvedToken | undefined> => {
      try {
        const v = await getVar.call(figmaCtx.variables, id);
        if (v === null) return undefined;
        const token: ResolvedToken = { name: v.name, type: v.resolvedType };
        const codeSyntax = serializeCodeSyntax((v as { codeSyntax?: unknown }).codeSyntax);
        if (codeSyntax !== undefined) token.codeSyntax = codeSyntax;
        return token;
      } catch {
        /* unresolved ref — skip, the inline value remains the fallback */
        return undefined;
      }
    }),
  );
  const variables: Record<string, ResolvedToken> = {};
  for (const [i, id] of ordered.entries()) {
    const token = resolved[i];
    if (token !== undefined) variables[id] = token;
  }
  return Object.keys(variables).length > 0 ? variables : undefined;
};

export const createGetStylesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async () => {
    const [paintStyles, textStyles, effectStyles, gridStyles] = await Promise.all([
      figmaCtx.getLocalPaintStylesAsync(),
      figmaCtx.getLocalTextStylesAsync(),
      figmaCtx.getLocalEffectStylesAsync(),
      figmaCtx.getLocalGridStylesAsync(),
    ]);

    const result: GetStylesResult = {
      paints: paintStyles.map(s => ({
        id: s.id,
        name: s.name,
        key: s.key,
        description: s.description,
        // A paint style belongs to no node, so it has no aspect ratio and no derivable gradient
        // angle — hence the explicit null. Called through an arrow, never point-free: map would
        // otherwise pass the array index as the second argument.
        paints: s.paints.map(p => serializePaint(p, null)),
      })),
      texts: textStyles.map(s => {
        const style: SerializedTextStyle = {
          id: s.id,
          name: s.name,
          key: s.key,
          description: s.description,
          fontName: serializeFontName(s.fontName),
          fontSize: s.fontSize,
          lineHeight: serializeLineHeight(s.lineHeight),
          letterSpacing: { unit: s.letterSpacing.unit, value: s.letterSpacing.value },
          textWrapStyle: s.textWrapStyle,
        };
        // Typography values are scalars, so a text style is the only place its bindings can live —
        // unlike a paint / effect / grid style, where they sit on the individual object.
        const bound = collectBindings(s.boundVariables);
        if (bound !== undefined) style.boundVariables = bound;
        return style;
      }),
      effects: effectStyles.map(s => ({
        id: s.id,
        name: s.name,
        key: s.key,
        description: s.description,
        effects: s.effects.map(serializeEffect),
      })),
      grids: gridStyles.map(s => ({
        id: s.id,
        name: s.name,
        key: s.key,
        description: s.description,
        grids: s.layoutGrids.map(serializeLayoutGrid),
      })),
    };
    // Ids are only worth resolving once the styles are serialized — that's what says which
    // variables this document's styles actually reference. The table goes FIRST so a reader meets
    // `VariableID:5:12` already knowing what it names, instead of after every style that cites it.
    const variables = await resolveVariables(figmaCtx, collectVariableIds(result));
    return variables === undefined ? result : { variables, ...result };
  };
