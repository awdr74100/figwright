import { parse } from 'valibot';
import { describe, expect, it } from 'vitest';

import {
  GetDocumentResultSchema,
  GetSelectionResultSchema,
  MIXED,
  type SceneNodeLike,
  type SerializedNode,
  SerializedNodeSchema,
  SerializedPaintSchema,
  serializeNode,
} from '../src/serialized-node.js';

const baseInput = (overrides: Partial<SceneNodeLike> = {}): SceneNodeLike => ({
  id: '1:2',
  name: 'Rectangle',
  type: 'RECTANGLE',
  visible: true,
  locked: false,
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  parent: { id: '1:1' },
  ...overrides,
});

describe('serializeNode (base-only factory)', () => {
  it('captures the minimal node fields', () => {
    const out = serializeNode(baseInput());
    expect(out).toEqual({
      id: '1:2',
      name: 'Rectangle',
      type: 'RECTANGLE',
      visible: true,
      locked: false,
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      parentId: '1:1',
    });
    expect(parse(SerializedNodeSchema, out)).toEqual(out);
  });

  it('emits parentId=null when node has no parent', () => {
    const out = serializeNode(baseInput({ parent: null }));
    expect(out.parentId).toBeNull();
  });
});

describe('SerializedNode optional fields', () => {
  it('accepts rotation / opacity / cornerRadius / fills', () => {
    const node: SerializedNode = {
      ...serializeNode(baseInput()),
      rotation: 45,
      opacity: 0.5,
      cornerRadius: 8,
      fills: [
        { type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0 } },
      ],
    };
    expect(parse(SerializedNodeSchema, node)).toEqual(node);
  });

  it("accepts cornerRadius='mixed' and fills='mixed'", () => {
    const node: SerializedNode = {
      ...serializeNode(baseInput()),
      cornerRadius: MIXED,
      fills: MIXED,
    };
    expect(parse(SerializedNodeSchema, node)).toEqual(node);
  });

  it('round-trips a recursive children tree', () => {
    const leaf: SerializedNode = serializeNode(baseInput({ id: '1:3' }));
    const branch: SerializedNode = {
      ...serializeNode(baseInput({ id: '1:2', type: 'FRAME' })),
      children: [leaf],
    };
    const root: SerializedNode = {
      ...serializeNode(baseInput({ id: '1:1', type: 'FRAME', parent: null })),
      children: [branch],
    };
    expect(parse(SerializedNodeSchema, root)).toEqual(root);
  });
});

describe('SerializedPaint variant', () => {
  it('accepts a SOLID paint with color', () => {
    const paint = {
      type: 'SOLID' as const,
      visible: true,
      opacity: 0.8,
      color: { r: 0.1, g: 0.2, b: 0.3 },
    };
    expect(parse(SerializedPaintSchema, paint)).toEqual(paint);
  });

  it('accepts a non-SOLID paint (type only, no color)', () => {
    const paint = { type: 'GRADIENT_LINEAR' as const, visible: false, opacity: 1 };
    expect(parse(SerializedPaintSchema, paint)).toEqual(paint);
  });

  it('rejects SOLID paint missing color', () => {
    expect(() =>
      parse(SerializedPaintSchema, { type: 'SOLID', visible: true, opacity: 1 }),
    ).toThrow(/color/i);
  });
});

describe('GetSelectionResult / GetDocumentResult schemas', () => {
  it('GetSelectionResult round-trips with flat nodes', () => {
    const payload = {
      pageId: 'page-1',
      pageName: 'Cover',
      nodes: [serializeNode(baseInput()), serializeNode(baseInput({ id: '1:3' }))],
    };
    expect(parse(GetSelectionResultSchema, payload)).toEqual(payload);
  });

  it('GetDocumentResult round-trips with recursive children', () => {
    const payload = {
      pageId: 'page-1',
      pageName: 'Cover',
      children: [
        { ...serializeNode(baseInput({ id: '1:2', type: 'FRAME' })), children: [serializeNode(baseInput({ id: '1:3' }))] },
      ],
    };
    expect(parse(GetDocumentResultSchema, payload)).toEqual(payload);
  });
});

describe('GetNode / GetNodesInfo / GetMetadata / GetPages schemas', () => {
  it('GetNodeResult accepts a node or null', async () => {
    const { GetNodeResultSchema } = await import('../src/serialized-node.js');
    expect(parse(GetNodeResultSchema, { node: serializeNode(baseInput()) }).node).not.toBeNull();
    expect(parse(GetNodeResultSchema, { node: null }).node).toBeNull();
  });

  it('GetNodesInfoResult preserves input order with nullable slots', async () => {
    const { GetNodesInfoResultSchema } = await import('../src/serialized-node.js');
    const payload = {
      nodes: [serializeNode(baseInput()), null, serializeNode(baseInput({ id: '1:5' }))],
    };
    expect(parse(GetNodesInfoResultSchema, payload)).toEqual(payload);
  });

  it('GetMetadataResult validates fileName + pages + currentPage', async () => {
    const { GetMetadataResultSchema } = await import('../src/serialized-node.js');
    const payload = {
      fileName: 'My File',
      currentPage: { id: 'p-1', name: 'Cover' },
      pages: [
        { id: 'p-1', name: 'Cover' },
        { id: 'p-2', name: 'Details' },
      ],
    };
    expect(parse(GetMetadataResultSchema, payload)).toEqual(payload);
  });

  it('GetPagesResult validates pages array of {id, name}', async () => {
    const { GetPagesResultSchema } = await import('../src/serialized-node.js');
    const payload = {
      pages: [
        { id: 'p-1', name: 'Cover' },
        { id: 'p-2', name: 'Details' },
      ],
    };
    expect(parse(GetPagesResultSchema, payload)).toEqual(payload);
  });
});
