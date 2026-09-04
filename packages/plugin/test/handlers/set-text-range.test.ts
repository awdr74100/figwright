import type { MutateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createSetTextRangeHandler } from '../../src/handlers/set-text-range.js';

type Spy = (...args: unknown[]) => void;
type AsyncSpy = (...args: unknown[]) => Promise<void>;

/** A fake TEXT node recording every setRange* call, plus the plumbing the handler needs. */
const makeText = (characters = 'Agree to Terms') => ({
  id: 'T:1',
  type: 'TEXT',
  characters,
  fontName: { family: 'Inter', style: 'Regular' },
  // Frozen like Figma's real runtime return — the handler must copy before pushing target fonts.
  getRangeAllFontNames: vi.fn<() => { family: string; style: string }[]>(
    () =>
      Object.freeze([{ family: 'Inter', style: 'Regular' }]) as { family: string; style: string }[],
  ),
  setRangeFontName: vi.fn<Spy>(),
  setRangeFontSize: vi.fn<Spy>(),
  setRangeTextDecoration: vi.fn<Spy>(),
  setRangeTextCase: vi.fn<Spy>(),
  setRangeLineHeight: vi.fn<Spy>(),
  setRangeLetterSpacing: vi.fn<Spy>(),
  setRangeHyperlink: vi.fn<Spy>(),
  setRangeListOptions: vi.fn<Spy>(),
  setRangeIndentation: vi.fn<Spy>(),
  setRangeTextWrapStyle: vi.fn<Spy>(),
  setRangeTextStyleIdAsync: vi.fn<AsyncSpy>(async () => {}),
  setRangeFillStyleIdAsync: vi.fn<AsyncSpy>(async () => {}),
  setRangeBoundVariable: vi.fn<Spy>(),
  getRangeFills: vi.fn<() => unknown>(() => [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]),
  setRangeFills: vi.fn<Spy>(),
});

const makeFigma = (
  text: ReturnType<typeof makeText> | null,
  variables: Record<string, unknown> = {},
): typeof figma =>
  ({
    getNodeByIdAsync: async (id: string) => (text && id === text.id ? text : null),
    loadFontAsync: vi.fn<AsyncSpy>(async () => {}),
    variables: {
      getVariableByIdAsync: async (id: string) => variables[id] ?? null,
      // Returns a paint carrying the binding, tagged so the test can assert it was written back.
      setBoundVariableForPaint: vi.fn<(...a: unknown[]) => unknown>(
        (paint: unknown, _field: unknown, variable: unknown) => ({
          ...(paint as object),
          boundVariables: { color: variable },
        }),
      ),
    },
  }) as unknown as typeof figma;

describe('set_text_range handler', () => {
  it("carries a run's variable-font axis values into setRangeFontName", async () => {
    const text = makeText();
    const figma = makeFigma(text);
    await createSetTextRangeHandler(figma)({
      nodeId: 'T:1',
      ranges: [
        {
          start: 9,
          end: 14,
          fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 700 } },
        },
      ],
    });
    expect(text.setRangeFontName).toHaveBeenCalledWith(9, 14, {
      family: 'Inter',
      style: 'Regular',
      variationSettings: { wght: 700 },
    });
  });

  it('loads a variable face once per family + style, not once per axis value', async () => {
    // Variation values change what renders, not what loads — two runs at different weights of the
    // same named instance need exactly one load, so the preload must not treat them as two faces.
    const text = makeText();
    const figma = makeFigma(text);
    await createSetTextRangeHandler(figma)({
      nodeId: 'T:1',
      ranges: [
        {
          start: 0,
          end: 5,
          fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 400 } },
        },
        {
          start: 5,
          end: 9,
          fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 700 } },
        },
      ],
    });
    expect(figma.loadFontAsync).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed fontName before any range is written', async () => {
    const text = makeText();
    const figma = makeFigma(text);
    await expect(
      createSetTextRangeHandler(figma)({
        nodeId: 'T:1',
        ranges: [
          { start: 0, end: 5, fontSize: 12 },
          { start: 5, end: 9, fontName: { family: 'Inter', variationSettings: { wght: 'bold' } } },
        ],
      }),
    ).rejects.toThrow(/variationSettings\.wght must be a number/);
    // The first range is valid and comes first — it must not have been applied.
    expect(text.setRangeFontSize).not.toHaveBeenCalled();
  });

  it('applies visual + spacing props to a range and loads the fonts first', async () => {
    const text = makeText();
    const figma = makeFigma(text);
    const result = (await createSetTextRangeHandler(figma)({
      nodeId: 'T:1',
      ranges: [
        {
          start: 9,
          end: 14,
          fontName: { family: 'Inter', style: 'Bold' },
          fontSize: 16,
          fills: [{ type: 'SOLID', color: { r: 0, g: 0.4, b: 1 } }],
          textDecoration: 'UNDERLINE',
          textCase: 'UPPER',
          lineHeight: { unit: 'PIXELS', value: 22 },
          letterSpacing: { unit: 'PERCENT', value: 2 },
        },
      ],
    })) as MutateResult;

    // Node's existing font + the target Bold font both loaded before mutating.
    expect(figma.loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' });
    expect(figma.loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Bold' });
    expect(text.setRangeFontName).toHaveBeenCalledWith(9, 14, { family: 'Inter', style: 'Bold' });
    expect(text.setRangeFontSize).toHaveBeenCalledWith(9, 14, 16);
    expect(text.setRangeFills).toHaveBeenCalledWith(9, 14, [
      { type: 'SOLID', color: { r: 0, g: 0.4, b: 1 }, opacity: undefined, visible: undefined },
    ]);
    expect(text.setRangeTextDecoration).toHaveBeenCalledWith(9, 14, 'UNDERLINE');
    expect(text.setRangeTextCase).toHaveBeenCalledWith(9, 14, 'UPPER');
    expect(text.setRangeLineHeight).toHaveBeenCalledWith(9, 14, { unit: 'PIXELS', value: 22 });
    expect(text.setRangeLetterSpacing).toHaveBeenCalledWith(9, 14, { unit: 'PERCENT', value: 2 });
    expect(result).toEqual({ ok: true, nodeId: 'T:1' });
  });

  it('applies structural props: hyperlink, list options, indentation', async () => {
    const text = makeText();
    await createSetTextRangeHandler(makeFigma(text))({
      nodeId: 'T:1',
      ranges: [
        {
          start: 9,
          end: 14,
          hyperlink: { type: 'URL', value: 'https://x.dev/terms' },
          listOptions: 'ORDERED',
          indentation: 1,
        },
      ],
    });
    expect(text.setRangeHyperlink).toHaveBeenCalledWith(9, 14, {
      type: 'URL',
      value: 'https://x.dev/terms',
    });
    expect(text.setRangeListOptions).toHaveBeenCalledWith(9, 14, { type: 'ORDERED' });
    expect(text.setRangeIndentation).toHaveBeenCalledWith(9, 14, 1);
  });

  it('applies textWrapStyle to the range (paragraph-scoped, unlike the per-character props)', async () => {
    const text = makeText();
    await createSetTextRangeHandler(makeFigma(text))({
      nodeId: 'T:1',
      ranges: [{ start: 9, end: 14, textWrapStyle: 'BALANCE' }],
    });
    // Passed through verbatim: Figma widens it to every paragraph the range touches, so the range
    // selects paragraphs here rather than characters.
    expect(text.setRangeTextWrapStyle).toHaveBeenCalledWith(9, 14, 'BALANCE');
  });

  it('clears a hyperlink when passed null', async () => {
    const text = makeText();
    await createSetTextRangeHandler(makeFigma(text))({
      nodeId: 'T:1',
      ranges: [{ start: 0, end: 5, hyperlink: null }],
    });
    expect(text.setRangeHyperlink).toHaveBeenCalledWith(0, 5, null);
  });

  it('binds shared styles (async) and a non-paint variable field via setRangeBoundVariable', async () => {
    const text = makeText();
    const variable = { id: 'VariableID:size', name: 'font/lg' };
    await createSetTextRangeHandler(makeFigma(text, { 'VariableID:size': variable }))({
      nodeId: 'T:1',
      ranges: [
        {
          start: 9,
          end: 14,
          textStyleId: 'S:link',
          fillStyleId: 'S:brand',
          boundVariables: { fontSize: 'VariableID:size' },
        },
      ],
    });
    expect(text.setRangeTextStyleIdAsync).toHaveBeenCalledWith(9, 14, 'S:link');
    expect(text.setRangeFillStyleIdAsync).toHaveBeenCalledWith(9, 14, 'S:brand');
    // A non-paint field resolves the id and binds via setRangeBoundVariable directly.
    expect(text.setRangeBoundVariable).toHaveBeenCalledWith(9, 14, 'fontSize', variable);
  });

  it('binds a COLOR variable on `fills` through the paint (setRangeBoundVariable rejects fills)', async () => {
    const text = makeText();
    const variable = { id: 'VariableID:primary', name: 'Primary/500' };
    const figma = makeFigma(text, { 'VariableID:primary': variable });
    await createSetTextRangeHandler(figma)({
      nodeId: 'T:1',
      ranges: [{ start: 9, end: 14, boundVariables: { fills: 'VariableID:primary' } }],
    });
    // Colour binding routes through the paint, not setRangeBoundVariable.
    expect(text.setRangeBoundVariable).not.toHaveBeenCalled();
    expect(figma.variables.setBoundVariableForPaint).toHaveBeenCalledWith(
      { type: 'SOLID', color: { r: 0, g: 0, b: 0 } },
      'color',
      variable,
    );
    // The bound paint (carrying the variable) is written back onto the range.
    expect(text.setRangeFills).toHaveBeenCalledWith(9, 14, [
      { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, boundVariables: { color: variable } },
    ]);
  });

  it('unbinds a colour variable on `fills` when the id is null', async () => {
    const text = makeText();
    const figma = makeFigma(text);
    await createSetTextRangeHandler(figma)({
      nodeId: 'T:1',
      ranges: [{ start: 0, end: 5, boundVariables: { fills: null } }],
    });
    expect(figma.variables.setBoundVariableForPaint).toHaveBeenCalledWith(
      { type: 'SOLID', color: { r: 0, g: 0, b: 0 } },
      'color',
      null,
    );
  });

  it('applies multiple ranges in order', async () => {
    const text = makeText();
    await createSetTextRangeHandler(makeFigma(text))({
      nodeId: 'T:1',
      ranges: [
        { start: 0, end: 9, fontSize: 14 },
        { start: 9, end: 14, fontSize: 18 },
      ],
    });
    expect(text.setRangeFontSize).toHaveBeenNthCalledWith(1, 0, 9, 14);
    expect(text.setRangeFontSize).toHaveBeenNthCalledWith(2, 9, 14, 18);
  });

  it('rejects a non-TEXT node, bad ranges, and out-of-bounds / empty ranges', async () => {
    const text = makeText('short'); // length 5
    const figma = makeFigma(text);
    const notText = {
      getNodeByIdAsync: async () => ({ id: 'R:1', type: 'RECTANGLE' }),
    } as unknown as typeof figma;

    await expect(createSetTextRangeHandler(notText)({ nodeId: 'R:1', ranges: [] })).rejects.toThrow(
      /not a TEXT node/,
    );
    await expect(createSetTextRangeHandler(figma)({ nodeId: 'T:1' })).rejects.toThrow(
      /ranges must be an array/,
    );
    await expect(
      createSetTextRangeHandler(figma)({ nodeId: 'T:1', ranges: [{ start: 0, end: 99 }] }),
    ).rejects.toThrow(/out of bounds/);
    await expect(
      createSetTextRangeHandler(figma)({ nodeId: 'T:1', ranges: [{ start: 3, end: 3 }] }),
    ).rejects.toThrow(/out of bounds or empty/);
  });

  it('throws a clear error when a bound variable id does not resolve', async () => {
    const text = makeText();
    await expect(
      createSetTextRangeHandler(makeFigma(text))({
        nodeId: 'T:1',
        ranges: [{ start: 0, end: 5, boundVariables: { fills: 'VariableID:missing' } }],
      }),
    ).rejects.toThrow(/variable VariableID:missing not found/);
  });

  // A run's paints carry bindings of their own, distinct from the range-level `boundVariables`
  // below them — the same shape get_node reports for a mixed TEXT node's segments. Before #164's
  // write half they were dropped here, which turned a token-coloured word into a frozen hex.
  it('carries a binding on a run fill through to setRangeFills', async () => {
    const text = makeText();
    const variable = { id: 'V:1', name: 'color/link', resolvedType: 'COLOR' };
    const figma = makeFigma(text, { 'V:1': variable });
    await createSetTextRangeHandler(figma)({
      nodeId: 'T:1',
      ranges: [
        {
          start: 0,
          end: 5,
          fills: [
            {
              type: 'SOLID',
              visible: true,
              opacity: 1,
              color: { r: 0, g: 0, b: 1 },
              boundVariables: { color: 'V:1' },
            },
          ],
        },
      ],
    });
    expect(text.setRangeFills).toHaveBeenCalledWith(0, 5, [
      expect.objectContaining({ boundVariables: { color: variable } }),
    ]);
  });

  it('rejects a run fill bound to a variable that no longer exists', async () => {
    const text = makeText();
    const figma = makeFigma(text);
    await expect(
      createSetTextRangeHandler(figma)({
        nodeId: 'T:1',
        ranges: [
          {
            start: 0,
            end: 5,
            fills: [
              {
                type: 'SOLID',
                visible: true,
                opacity: 1,
                color: { r: 0, g: 0, b: 1 },
                boundVariables: { color: 'V:gone' },
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow('set_text_range: variable V:gone not found');
    expect(text.setRangeFills).not.toHaveBeenCalled();
  });
});
