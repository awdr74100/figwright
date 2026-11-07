import type { MutateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createApplyStyleToNodeHandler } from '../../src/handlers/apply-style-to-node.js';

const PAINT = { id: 'S:paint,', type: 'PAINT' };
const EFFECT = { id: 'S:effect,', type: 'EFFECT' };

/** A figma whose getStyleByIdAsync matches ids exactly, as Figma's does (measured). */
const fakeFigma = (node: unknown, styles: { id: string; type: string }[] = [PAINT, EFFECT]) =>
  ({
    getNodeByIdAsync: async () => node,
    getStyleByIdAsync: async (id: string) => styles.find(s => s.id === id) ?? null,
  }) as unknown as typeof figma;

/**
 * A node whose fill-style setter behaves like Figma's (measured): a known id applies, a well-formed
 * unknown one (deleted, or never there) throws, and one it cannot parse — "S:none", or a real id
 * without its trailing comma — removes the style and answers ok.
 */
const styledNode = (fillStyleId = '', known = [PAINT.id]) => {
  const node = {
    id: '1:1',
    fillStyleId,
    setFillStyleIdAsync: vi.fn<(id: string) => Promise<void>>(async id => {
      if (id === '' || known.includes(id)) node.fillStyleId = id;
      else if (/^S:[0-9a-z]+,/.test(id)) throw new Error('Cannot set style successfully');
      else node.fillStyleId = '';
    }),
  };
  return node;
};

describe('apply_style_to_node handler', () => {
  it('applies a style by its exact id and reads it back', async () => {
    const node = styledNode();
    const result = (await createApplyStyleToNodeHandler(fakeFigma(node))({
      nodeId: '1:1',
      styleId: 'S:paint,',
      field: 'fill',
    })) as MutateResult;

    expect(node.setFillStyleIdAsync).toHaveBeenCalledWith('S:paint,');
    expect(node.fillStyleId).toBe('S:paint,');
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('removes the style for "", without looking one up', async () => {
    const node = styledNode('S:paint,');
    const figmaCtx = fakeFigma(node);
    const lookup = vi.spyOn(figmaCtx, 'getStyleByIdAsync');
    await createApplyStyleToNodeHandler(figmaCtx)({ nodeId: '1:1', styleId: '', field: 'fill' });

    expect(lookup).not.toHaveBeenCalled();
    expect(node.fillStyleId).toBe('');
  });

  // Measured: Figma's setters take an id they cannot parse as a removal and answer ok, so a typo
  // used to strip the node's style while the tool reported success.
  it.each(['S:none', 'garbage', 'S:paint'])(
    'refuses %s, and leaves the node’s style as it was',
    async styleId => {
      const node = styledNode('S:paint,');
      await expect(
        createApplyStyleToNodeHandler(fakeFigma(node))({ nodeId: '1:1', styleId, field: 'fill' }),
      ).rejects.toThrow(/no style .* in this file .*left as it was/);
      expect(node.fillStyleId).toBe('S:paint,');
    },
  );

  it('passes on Figma’s own refusal of a deleted style, the node untouched', async () => {
    const node = styledNode('S:paint,');
    await expect(
      createApplyStyleToNodeHandler(fakeFigma(node))({
        nodeId: '1:1',
        styleId: 'S:deleted,',
        field: 'fill',
      }),
    ).rejects.toThrow(/Cannot set style/);
    expect(node.fillStyleId).toBe('S:paint,');
  });

  // A library style the lookup does not report is still tried, and kept when Figma applies it.
  it('applies a style the lookup does not find when Figma takes it', async () => {
    const node = styledNode('', ['S:library,']);
    await createApplyStyleToNodeHandler(fakeFigma(node))({
      nodeId: '1:1',
      styleId: 'S:library,',
      field: 'fill',
    });
    expect(node.fillStyleId).toBe('S:library,');
  });

  it('refuses a style of the wrong kind for the field, before writing', async () => {
    const node = styledNode();
    await expect(
      createApplyStyleToNodeHandler(fakeFigma(node))({
        nodeId: '1:1',
        styleId: 'S:effect,',
        field: 'fill',
      }),
    ).rejects.toThrow(/S:effect, is a style of type EFFECT; field fill takes type PAINT/);
    expect(node.setFillStyleIdAsync).not.toHaveBeenCalled();
  });

  // A text whose runs carry different styles reads mixed, and no single id would put it back — the
  // setter would strip every run on an id it cannot parse, so such an id is not tried there.
  it('refuses an unknown id on a text with mixed styles without writing anything', async () => {
    const MIXED = Symbol('mixed');
    const node = {
      id: '1:2',
      textStyleId: MIXED as unknown,
      setTextStyleIdAsync: vi.fn<(id: string) => Promise<void>>(async () => {
        node.textStyleId = '';
      }),
    };
    await expect(
      createApplyStyleToNodeHandler(fakeFigma(node))({
        nodeId: '1:2',
        styleId: 'S:none',
        field: 'text',
      }),
    ).rejects.toThrow(/nothing was written, since 1:2's runs carry different text styles/);
    expect(node.setTextStyleIdAsync).not.toHaveBeenCalled();
    expect(node.textStyleId).toBe(MIXED);
  });

  it('reports a style Figma did not apply, rather than answering ok', async () => {
    const node = { ...styledNode(), setFillStyleIdAsync: async () => {} };
    await expect(
      createApplyStyleToNodeHandler(fakeFigma(node))({
        nodeId: '1:1',
        styleId: 'S:paint,',
        field: 'fill',
      }),
    ).rejects.toThrow(/Figma did not apply "S:paint," to 1:1's fill — it reads ""/);
  });

  it('throws on bad field, missing node, or unsupported setter', async () => {
    const node = { id: '1:1' };
    await expect(
      createApplyStyleToNodeHandler(fakeFigma(node))({
        nodeId: '1:1',
        styleId: 'S:paint,',
        field: 'fill',
      }),
    ).rejects.toThrow(/cannot take/);
    await expect(
      createApplyStyleToNodeHandler(fakeFigma(node))({
        nodeId: '1:1',
        styleId: 'S:paint,',
        field: 'bogus',
      }),
    ).rejects.toThrow(/field must be/);
    await expect(
      createApplyStyleToNodeHandler(fakeFigma(null))({
        nodeId: '9:9',
        styleId: 'S:paint,',
        field: 'fill',
      }),
    ).rejects.toThrow(/not found/);
  });
});
