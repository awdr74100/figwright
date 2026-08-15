import type { MutateResult, SerializedLineHeight, SerializedPaint } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaLineHeight } from './convert.js';
import { toFigmaPaint } from './set-fills.js';

interface RangeInput {
  start: number;
  end: number;
  fontName?: { family: string; style: string };
  fontSize?: number;
  fills?: SerializedPaint[];
  textDecoration?: string;
  textCase?: string;
  lineHeight?: SerializedLineHeight;
  letterSpacing?: { unit: string; value: number };
  hyperlink?: { type: string; value: string } | null;
  listOptions?: string;
  indentation?: number;
  textWrapStyle?: string;
  textStyleId?: string;
  fillStyleId?: string;
  boundVariables?: Record<string, string | null>;
}

/**
 * Style character ranges of a TEXT node — the write-side mirror of a read segment. Every per-run
 * property maps to its setRange* method; ranges apply in array order so a later range overrides an
 * earlier one where they overlap. Fonts are loaded up front (all fonts already on the node plus any
 * target fontName), since every range mutation requires the affected fonts loaded — exactly like
 * set_text_properties, but per range. Style-id / variable bindings use the async setters and
 * resolve the variable id to a Variable (like bind_variable_to_node); binding is applied last so it
 * wins over a direct value on the same field.
 */
export const createSetTextRangeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; ranges?: unknown };
    if (typeof p.nodeId !== 'string') {
      throw new TypeError('set_text_range: nodeId must be a string');
    }
    if (!Array.isArray(p.ranges)) {
      throw new TypeError('set_text_range: ranges must be an array');
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || node.type !== 'TEXT') {
      throw new Error(`set_text_range: node ${p.nodeId} is not a TEXT node`);
    }
    const text = node as TextNode;
    const len = text.characters.length;

    const ranges = p.ranges as RangeInput[];
    // Validate every range up front so a bad range fails before any partial mutation.
    for (const r of ranges) {
      if (typeof r.start !== 'number' || typeof r.end !== 'number') {
        throw new TypeError('set_text_range: each range needs numeric start and end');
      }
      if (r.start < 0 || r.end > len || r.start >= r.end) {
        throw new RangeError(
          `set_text_range: range ${r.start}–${r.end} is out of bounds or empty (text length ${len})`,
        );
      }
    }

    // Every range mutation needs the fonts it touches loaded. Load all fonts currently on the node
    // plus any target fontName a range assigns, deduped, before mutating. getRangeAllFontNames
    // returns a non-extensible (frozen) array in Figma's runtime, so copy into a fresh array before
    // pushing the target fonts (a plain push throws "object is not extensible").
    const fonts: FontName[] = [
      ...(len > 0 ? text.getRangeAllFontNames(0, len) : [text.fontName as FontName]),
    ];
    for (const r of ranges) if (r.fontName) fonts.push(r.fontName);
    const seen = new Set<string>();
    const uniqueFonts = fonts.filter(f => {
      const key = `${f.family} ${f.style}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await Promise.all(uniqueFonts.map(f => figmaCtx.loadFontAsync(f)));

    /* eslint-disable no-await-in-loop -- ranges apply in order (a later range overrides an earlier
       one on overlap), and within a range the async style/variable bindings must land after the
       direct values, so these awaits are intentionally sequential. */
    for (const r of ranges) {
      const { start, end } = r;
      // Direct values first.
      if (r.fontName !== undefined) text.setRangeFontName(start, end, r.fontName);
      if (r.fontSize !== undefined) text.setRangeFontSize(start, end, r.fontSize);
      if (r.fills !== undefined) text.setRangeFills(start, end, r.fills.map(toFigmaPaint));
      if (r.textDecoration !== undefined) {
        text.setRangeTextDecoration(start, end, r.textDecoration as TextDecoration);
      }
      if (r.textCase !== undefined) text.setRangeTextCase(start, end, r.textCase as TextCase);
      if (r.lineHeight !== undefined) {
        text.setRangeLineHeight(start, end, toFigmaLineHeight(r.lineHeight));
      }
      if (r.letterSpacing !== undefined) {
        text.setRangeLetterSpacing(start, end, r.letterSpacing as LetterSpacing);
      }
      if (r.hyperlink !== undefined) {
        text.setRangeHyperlink(start, end, r.hyperlink as HyperlinkTarget | null);
      }
      if (r.listOptions !== undefined) {
        text.setRangeListOptions(start, end, { type: r.listOptions as TextListOptions['type'] });
      }
      if (r.indentation !== undefined) text.setRangeIndentation(start, end, r.indentation);
      // Paragraph-scoped, unlike every other field here: Figma applies it to whole paragraphs the
      // range touches, so a range covering one character still restyles that character's paragraph.
      if (r.textWrapStyle !== undefined) {
        text.setRangeTextWrapStyle(start, end, r.textWrapStyle as TextWrapStyle);
      }
      // Design-system bindings: shared styles (async setters), then variable bindings last so a bound
      // variable wins over a direct value set on the same field above.
      if (r.textStyleId !== undefined)
        await text.setRangeTextStyleIdAsync(start, end, r.textStyleId);
      if (r.fillStyleId !== undefined)
        await text.setRangeFillStyleIdAsync(start, end, r.fillStyleId);
      if (r.boundVariables !== undefined) {
        for (const [field, variableId] of Object.entries(r.boundVariables)) {
          let variable: Variable | null = null;
          if (typeof variableId === 'string') {
            variable = await figmaCtx.variables.getVariableByIdAsync(variableId);
            if (variable === null) {
              throw new Error(`set_text_range: variable ${variableId} not found`);
            }
          }
          if (field === 'fills') {
            // A colour binding lives on the paint, not the node/run — setRangeBoundVariable rejects
            // `fills`. Bind the variable onto the run's current fill via setBoundVariableForPaint
            // (the range analogue of bind_variable_to_paint), preserving its colour, and write it back.
            const current = text.getRangeFills(start, end);
            const base: SolidPaint =
              Array.isArray(current) && current[0]?.type === 'SOLID'
                ? current[0]
                : { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };
            const bound = figmaCtx.variables.setBoundVariableForPaint(base, 'color', variable);
            text.setRangeFills(start, end, [bound]);
          } else {
            text.setRangeBoundVariable(start, end, field as VariableBindableTextField, variable);
          }
        }
      }
    }
    /* eslint-enable no-await-in-loop */

    const result: MutateResult = { ok: true, nodeId: text.id };
    return result;
  };
