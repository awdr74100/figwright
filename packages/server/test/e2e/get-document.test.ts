import {
  type GetDocumentResult,
  GetDocumentResultSchema,
  MIXED,
  type SerializedNode,
} from '@figwright/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';

import { dispatchTool } from '../../src/dispatch.js';
import { GET_DOCUMENT_TOOL_NAME } from '../../src/tools/get-document.js';
import {
  closeSocket,
  connectFakePlugin,
  type LeaderHarness,
  startLeader,
  stopLeader,
} from './_helpers.js';

const harnesses: LeaderHarness[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets) closeSocket(ws);
  sockets.length = 0;
  await Promise.all(harnesses.map(stopLeader));
  harnesses.length = 0;
});

const node = (overrides: Partial<SerializedNode> = {}): SerializedNode => ({
  id: '1:2',
  name: 'Rect',
  type: 'RECTANGLE',
  visible: true,
  locked: false,
  parentId: '1:1',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  ...overrides,
});

describe('e2e get_document', () => {
  it('round-trips a recursive tree from sandbox back to MCP caller', async () => {
    const h = await startLeader();
    harnesses.push(h);

    const tree: GetDocumentResult = {
      pageId: 'page-1',
      pageName: 'Cover',
      children: [
        {
          ...node({ id: '1:2', type: 'FRAME', parentId: null }),
          rotation: 0,
          opacity: 1,
          cornerRadius: 8,
          fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 1, b: 1 } }],
          children: [
            node({ id: '1:3', type: 'TEXT', parentId: '1:2' }),
            {
              ...node({ id: '1:4', type: 'RECTANGLE', parentId: '1:2' }),
              cornerRadius: MIXED,
              fills: MIXED,
            },
          ],
        },
      ],
    };

    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [GET_DOCUMENT_TOOL_NAME]: () => tree },
      }),
    );

    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_DOCUMENT_TOOL_NAME,
      {},
    )) as unknown;

    expect(GetDocumentResultSchema.parse(result)).toEqual(tree);
  });

  it('returns empty children when page has no nodes', async () => {
    const h = await startLeader();
    harnesses.push(h);

    const empty: GetDocumentResult = { pageId: 'page-1', pageName: 'Cover', children: [] };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [GET_DOCUMENT_TOOL_NAME]: () => empty },
      }),
    );

    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_DOCUMENT_TOOL_NAME,
      {},
    )) as GetDocumentResult;
    expect(result.children).toEqual([]);
  });
});
