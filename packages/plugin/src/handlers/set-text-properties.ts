import type { TextPropertiesResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaFontName } from './convert.js';
import { enclosingInstance, explain } from './resize-nodes.js';
import { sameSize } from './size.js';
import {
  boxNeedsResize,
  readTextBox,
  resizeTakes,
  type TextBox,
  writeTextBox,
} from './text-box.js';
import { isTextLike, unsupportedOnPath } from './text-like.js';

type AutoResize = TextNode['textAutoResize'];

const boxSide = (value: unknown, field: string, tool: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.01) {
    throw new TypeError(`${tool}: ${field} must be a number of at least 0.01`);
  }
  return value;
};

/**
 * Validate a text box size, refusing one the same call's textAutoResize would undo:
 * WIDTH_AND_HEIGHT sizes both sides to the text, and HEIGHT sizes the height, so whichever ran last
 * would otherwise silently win. Exported so create_text can refuse before the node exists.
 */
export const checkTextBox = (
  p: { width?: unknown; height?: unknown; textAutoResize?: unknown },
  tool: string,
): { width: number | undefined; height: number | undefined } => {
  const width = boxSide(p.width, 'width', tool);
  const height = boxSide(p.height, 'height', tool);
  const autoResize = p.textAutoResize;
  const overridden: string[] = [];
  if (width !== undefined && autoResize === 'WIDTH_AND_HEIGHT') overridden.push('width');
  if (height !== undefined && (autoResize === 'WIDTH_AND_HEIGHT' || autoResize === 'HEIGHT')) {
    overridden.push('height');
  }
  if (overridden.length > 0) {
    throw new TypeError(
      `${tool}: ${overridden.join(' and ')} conflicts with textAutoResize ` +
        `${autoResize as string}, which sizes it to the text — drop one (width alone wraps the ` +
        'text and grows its height; width and height together make a fixed box)',
    );
  }
  return { width, height };
};

/**
 * The box a call asks for, with everything it leaves out kept as it is.
 *
 * The mode: a named textAutoResize wins (TRUNCATE being a fixed box with the ellipsis on). Without
 * one, a new height fixes the box, since auto height would discard it; a new width keeps the text
 * wrapping — auto-width text becomes auto height (a width it would discard at once is no width at
 * all) and a box already fixed stays fixed; and otherwise the mode stays.
 *
 * The ellipsis: the one passed, else TRUNCATE's, else the one it has — kept however the mode moves.
 * maxLines: the one passed (the caller leaves out one the box would not show, see
 * {@link unshownMaxLines}), else the one it has, as far as Figma keeps one at all — only on
 * auto-sized text with the ellipsis on, so a box being fixed, or having its ellipsis turned off,
 * ends with none; and ellipsis turned on for auto-sized text that had none takes the single line
 * Figma gives it (all measured).
 *
 * The height of a fixed box: the one passed, else the one it has when it was fixed already and
 * nothing asked to re-fit it, else the height its text needs at the target width (`measure`) — a
 * box being fixed from auto height, or a width passed with NONE named.
 *
 * Decided from `prior`, the box before this call wrote anything; the unpassed sides come from
 * `current`, the text's size as it stands when the box is written — after the typography that sizes
 * it.
 */
export const targetBox = (
  prior: TextBox,
  current: { width: number; height: number },
  p: { textAutoResize?: unknown; textTruncation?: unknown; maxLines?: unknown },
  width: number | undefined,
  height: number | undefined,
): { box: TextBox; measure: boolean } => {
  const requested = p.textAutoResize as AutoResize | undefined;
  const wasFixed = prior.autoResize === 'NONE';

  let autoResize: TextBox['autoResize'];
  if (requested !== undefined) autoResize = requested === 'TRUNCATE' ? 'NONE' : requested;
  else if (height !== undefined || wasFixed) autoResize = 'NONE';
  else autoResize = width !== undefined ? 'HEIGHT' : prior.autoResize;

  const truncation =
    (p.textTruncation as TextBox['truncation'] | undefined) ??
    (requested === 'TRUNCATE' ? 'ENDING' : prior.truncation);
  let maxLines: number | null;
  if (p.maxLines !== undefined) maxLines = p.maxLines as number | null;
  else if (autoResize === 'NONE' || truncation === 'DISABLED') maxLines = null;
  else if (prior.truncation === 'DISABLED') maxLines = 1;
  else maxLines = prior.maxLines;

  const box: TextBox = {
    autoResize,
    width: width ?? current.width,
    height: height ?? current.height,
    truncation,
    maxLines,
  };
  const measure =
    autoResize === 'NONE' &&
    height === undefined &&
    (!wasFixed || (width !== undefined && requested !== undefined));
  return { box, measure };
};

/**
 * Why the box this call lands on would not show `maxLines`, or undefined when it would. Figma shows
 * a line count only on auto-sized text with the ellipsis on, and drops it anywhere else without an
 * error (measured) — nor does one written there show up later, once the box is auto-sized with the
 * ellipsis on (measured, three runs each). The rest of the call still applies, as it always did;
 * the line count is left out and the caller told why, instead of the old silent ok.
 */
export const unshownMaxLines = (box: TextBox, maxLines: unknown): string | undefined => {
  if (typeof maxLines !== 'number') return undefined;
  if (box.autoResize === 'NONE') {
    return (
      `maxLines ${maxLines} was not applied — a fixed box shows no line count (it truncates at ` +
      'its own edge); pass textAutoResize HEIGHT for one'
    );
  }
  if (box.truncation !== 'ENDING') {
    return (
      `maxLines ${maxLines} was not applied — it needs textTruncation ENDING, which is what cuts ` +
      'the text at that line; pass it in the same call'
    );
  }
  return undefined;
};

/**
 * Set a TEXT node's typography + layout/overflow props. Figma requires every font on the node —
 * plus the target fontName, if changing it — to be loaded before _any_ of them is written: the
 * layout/overflow three (textAutoResize/truncation/maxLines) are refused the same way typography
 * is, despite reading as node-level settings. Typography goes first so the box is sized for it; the
 * box — size, auto-resize and line clamp, which Figma couples — goes through writeTextBox.
 */
export const createSetTextPropertiesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      fontName?: unknown;
      fontSize?: unknown;
      lineHeight?: unknown;
      letterSpacing?: unknown;
      textCase?: unknown;
      textDecoration?: unknown;
      paragraphSpacing?: unknown;
      paragraphIndent?: unknown;
      textWrapStyle?: unknown;
      textAlignHorizontal?: unknown;
      textAlignVertical?: unknown;
      textTruncation?: unknown;
      maxLines?: unknown;
      textAutoResize?: unknown;
      width?: unknown;
      height?: unknown;
    };
    if (typeof p.nodeId !== 'string')
      throw new TypeError('set_text_properties: nodeId must be a string');
    const { width, height } = checkTextBox(p, 'set_text_properties');
    if (
      p.paragraphSpacing !== undefined &&
      (typeof p.paragraphSpacing !== 'number' || p.paragraphSpacing < 0)
    ) {
      throw new TypeError('set_text_properties: paragraphSpacing must be a non-negative number');
    }
    if (
      p.paragraphIndent !== undefined &&
      (typeof p.paragraphIndent !== 'number' || p.paragraphIndent < 0)
    ) {
      throw new TypeError('set_text_properties: paragraphIndent must be a non-negative number');
    }
    if (p.textWrapStyle !== undefined && typeof p.textWrapStyle !== 'string') {
      throw new TypeError('set_text_properties: textWrapStyle must be a string');
    }
    if (p.textAlignHorizontal !== undefined && typeof p.textAlignHorizontal !== 'string') {
      throw new TypeError('set_text_properties: textAlignHorizontal must be a string');
    }
    if (p.textAlignVertical !== undefined && typeof p.textAlignVertical !== 'string') {
      throw new TypeError('set_text_properties: textAlignVertical must be a string');
    }
    if (p.textAutoResize !== undefined && typeof p.textAutoResize !== 'string') {
      throw new TypeError('set_text_properties: textAutoResize must be a string');
    }
    if (p.textTruncation !== undefined && typeof p.textTruncation !== 'string') {
      throw new TypeError('set_text_properties: textTruncation must be a string');
    }
    if (p.maxLines !== undefined && p.maxLines !== null && typeof p.maxLines !== 'number') {
      throw new TypeError('set_text_properties: maxLines must be a number or null');
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (!isTextLike(node)) {
      throw new Error(`set_text_properties: node ${p.nodeId} is not a TEXT node or text on a path`);
    }
    // Refused before anything is written, so a path never takes half of a call.
    const missing = node.type === 'TEXT_PATH' ? unsupportedOnPath(p) : [];
    if (missing.length > 0) {
      throw new Error(
        `set_text_properties: ${p.nodeId} is text on a path, which has no ${missing.join(', ')} ` +
          '(its text follows the path, so there are no lines, boxes or paragraphs to set)',
      );
    }
    if (node.type === 'TEXT_PATH' && (width !== undefined || height !== undefined)) {
      throw new Error(
        `set_text_properties: ${p.nodeId} is text on a path, which has no text box to size — its ` +
          'text follows the path, so reshape the path itself instead',
      );
    }
    // The fields a path lacks were refused above, so the box-level writes below only reach TEXT.
    const text = node as TextNode;

    // Every write below needs the node's font(s) loaded — the layout/overflow three included, which
    // is not obvious and was got wrong here: Figma rejects `maxLines`, `textTruncation` and
    // `textAutoResize` with `Cannot write to node with unloaded font` just as it rejects a
    // typography write, so `{nodeId, maxLines: 3}` threw while `{nodeId, fontSize: 24, maxLines: 3}`
    // succeeded. Nothing in the type checker or a mocked test can see that; the batch inverse that
    // restores these same fields has always reloaded the captured fonts first.
    //
    // Load the node's current font(s) — every one of them when the node is mixed, so a range-wide
    // mutation succeeds — plus the new fontName, if one is being assigned. Skipped only when there
    // is nothing to write at all, which is the one case that touches no text.
    const fontName =
      p.fontName === undefined ? undefined : toFigmaFontName(p.fontName as Record<string, unknown>);

    const willWrite =
      p.fontName !== undefined ||
      p.fontSize !== undefined ||
      p.lineHeight !== undefined ||
      p.letterSpacing !== undefined ||
      p.textCase !== undefined ||
      p.textDecoration !== undefined ||
      p.paragraphSpacing !== undefined ||
      p.paragraphIndent !== undefined ||
      p.textWrapStyle !== undefined ||
      p.textAlignHorizontal !== undefined ||
      p.textAlignVertical !== undefined ||
      p.textAutoResize !== undefined ||
      p.textTruncation !== undefined ||
      p.maxLines !== undefined ||
      width !== undefined ||
      height !== undefined;
    if (willWrite) {
      const fonts: FontNameInput[] =
        text.fontName === figmaCtx.mixed && text.characters.length > 0
          ? [...text.getRangeAllFontNames(0, text.characters.length)]
          : [text.fontName as FontName];
      // Copied above: getRangeAllFontNames hands back a frozen array (measured — see
      // set-text-range.ts), so pushing onto it threw on every mixed-font node given a fontName.
      if (fontName !== undefined) fonts.push(fontName);
      await Promise.all(fonts.map(font => figmaCtx.loadFontAsync(font)));
    }

    const before = { width: text.width, height: text.height };
    const prior = readTextBox(text);
    // Figma keeps one truncation limit on a text, a line count or a maxHeight: setting maxLines clears
    // a maxHeight bound the call never named (measured), so it is read back and named below.
    const maxHeightBefore = text.maxHeight;
    const touchesBox =
      width !== undefined ||
      height !== undefined ||
      p.textAutoResize !== undefined ||
      p.textTruncation !== undefined ||
      p.maxLines !== undefined;
    const resize = (w: number, h: number): void => text.resize(w, h);
    const unshown = touchesBox
      ? unshownMaxLines(targetBox(prior, before, p, width, height).box, p.maxLines)
      : undefined;
    // The box is planned without a line count it would not show, so the rest still lands.
    const boxParams = unshown === undefined ? p : { ...p, maxLines: undefined };
    if (touchesBox) {
      const plan = targetBox(prior, before, boxParams, width, height);
      // Inside an instance Figma may ignore a resize outright, and the writes around it would still
      // land: a label left FIXED that no longer hugs its text, a fixed box left in auto height
      // (both measured). So when this box write needs a resize, whether Figma applies one here is
      // asked before anything is written, and a no leaves the layer as it was.
      if (
        enclosingInstance(text) !== null &&
        boxNeedsResize(prior, plan.box, plan.measure) &&
        !resizeTakes(text, resize)
      ) {
        const requested = { width: width ?? before.width, height: height ?? before.height };
        throw new Error(
          `set_text_properties: ${p.nodeId} cannot take this box change, which needs a resize ` +
            '(a new size, or re-fitting it at a new width) — ' +
            explain(text, requested, before, before),
        );
      }
    }

    // `fontName` is declared as `FontName` (style required) even though the API accepts a
    // `FontNameInput` — its own JSDoc says so, and that is the only way to express "the instance
    // closest to these axis values" without knowing the family's style names. The typings never
    // widened the property alongside the setters, hence the cast.
    if (fontName !== undefined) text.fontName = fontName as FontName;
    if (p.fontSize !== undefined) text.fontSize = p.fontSize as number;
    if (p.lineHeight !== undefined) text.lineHeight = p.lineHeight as LineHeight;
    if (p.letterSpacing !== undefined) text.letterSpacing = p.letterSpacing as LetterSpacing;
    if (p.textCase !== undefined) text.textCase = p.textCase as TextNode['textCase'];
    if (p.textDecoration !== undefined)
      text.textDecoration = p.textDecoration as TextNode['textDecoration'];
    if (p.paragraphSpacing !== undefined) text.paragraphSpacing = p.paragraphSpacing as number;
    if (p.paragraphIndent !== undefined) text.paragraphIndent = p.paragraphIndent as number;
    if (p.textWrapStyle !== undefined)
      text.textWrapStyle = p.textWrapStyle as TextNode['textWrapStyle'];
    if (p.textAlignHorizontal !== undefined)
      text.textAlignHorizontal = p.textAlignHorizontal as TextNode['textAlignHorizontal'];
    if (p.textAlignVertical !== undefined)
      text.textAlignVertical = p.textAlignVertical as TextNode['textAlignVertical'];

    const notes: string[] = unshown === undefined ? [] : [unshown];
    // The size the box is meant to end at: a fixed box's both sides, auto height's width — the
    // ones passed, and the ones a box being fixed was measured at.
    let expected: { width: number; height: number } | null = null;
    if (touchesBox) {
      const target = targetBox(
        prior,
        { width: text.width, height: text.height },
        boxParams,
        width,
        height,
      );
      if (target.measure) {
        // The fixed box takes the height its text shows at the target width — not whatever height
        // it had before — so it is laid out in auto height first and read. Laid out as it showed
        // until now: auto-sized text with its own clamp (fixing a two-line clamp keeps two lines,
        // where turning the ellipsis on first would have Figma clamp it to one), a fixed box with
        // none (re-fitted at a new width, it shows all its text).
        const wasAuto = prior.autoResize !== 'NONE';
        writeTextBox(
          text,
          {
            ...target.box,
            autoResize: 'HEIGHT',
            truncation: wasAuto ? prior.truncation : 'DISABLED',
            maxLines: wasAuto ? prior.maxLines : null,
          },
          resize,
        );
        target.box.height = text.height;
      }
      writeTextBox(text, target.box, resize);
      // Read back rather than trusted: each rule writeTextBox works around was found by a write
      // that answered ok and landed elsewhere.
      const end = readTextBox(text);
      const missed = (['autoResize', 'truncation', 'maxLines'] as const)
        .filter(k => end[k] !== target.box[k])
        .map(
          k =>
            `${k === 'autoResize' ? 'textAutoResize' : k === 'truncation' ? 'textTruncation' : k} ${String(end[k])}`,
        );
      if (missed.length > 0) {
        notes.push(`the box ended with ${missed.join(', ')} — Figma did not apply what was asked`);
      }
      if (target.box.autoResize === 'NONE') {
        expected = { width: target.box.width, height: target.box.height };
      } else if (target.box.autoResize === 'HEIGHT') {
        expected = { width: target.box.width, height: text.height };
      }
    }

    if (typeof maxHeightBefore === 'number' && text.maxHeight !== maxHeightBefore) {
      notes.push(
        typeof text.maxLines === 'number'
          ? `maxHeight ${maxHeightBefore} was cleared — a text truncates at one limit, a line count ` +
              `or a maxHeight, and maxLines ${text.maxLines} replaced it`
          : `maxHeight ${maxHeightBefore} was cleared — Figma reads it as ${String(text.maxHeight)}`,
      );
    }
    const after = { width: text.width, height: text.height };
    if (
      expected !== null &&
      !(sameSize(after.width, expected.width) && sameSize(after.height, expected.height))
    ) {
      // FigJam keeps a fixed text box at least as tall as its text (measured: 20, 30 and 31 all came
      // back at the 45 its lines need, 100 stayed 100) — a clamp's shorter look cannot be fixed there.
      const figjamFloor =
        figmaCtx.editorType === 'figjam' &&
        sameSize(after.width, expected.width) &&
        after.height > expected.height;
      notes.unshift(
        figjamFloor
          ? `FigJam keeps a fixed text box at least as tall as its text, so it is ${after.width} × ` +
              `${after.height}, not the ${expected.height} asked or shown before`
          : explain(text, expected, before, after),
      );
    }
    const result: TextPropertiesResult = {
      ok: true,
      nodeId: text.id,
      ...after,
      ...(notes.length > 0 && { adjusted: notes.join('; ') }),
    };
    return result;
  };
