import {
  type GetSelectionResult,
  GetSelectionResultSchema,
  serializeNode,
} from '@figma-mcp-relay/shared';
import { parse } from 'valibot';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';

import { dispatchTool } from '../../src/dispatch.js';
import { GET_SELECTION_TOOL_NAME } from '../../src/tools/get-selection.js';

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

describe('e2e get_selection', () => {
  it('round-trips selection from sandbox handler back to MCP caller', async () => {
    const h = await startLeader();
    harnesses.push(h);

    const sandboxResponse: GetSelectionResult = {
      pageId: 'page-1',
      pageName: 'Cover',
      nodes: [
        serializeNode({
          id: '1:2',
          name: 'Rect',
          type: 'RECTANGLE',
          visible: true,
          locked: false,
          x: 10,
          y: 20,
          width: 100,
          height: 50,
          parent: { id: '1:1' },
        }),
        serializeNode({
          id: '1:3',
          name: 'Label',
          type: 'TEXT',
          visible: true,
          locked: false,
          x: 0,
          y: 0,
          width: 80,
          height: 16,
          parent: { id: '1:1' },
        }),
      ],
    };

    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [GET_SELECTION_TOOL_NAME]: () => sandboxResponse },
      }),
    );

    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_SELECTION_TOOL_NAME,
      {},
    )) as unknown;

    expect(parse(GetSelectionResultSchema, result)).toEqual(sandboxResponse);
  });

  it('returns empty selection when sandbox reports no selected nodes', async () => {
    const h = await startLeader();
    harnesses.push(h);

    const empty: GetSelectionResult = { pageId: 'page-1', pageName: 'Cover', nodes: [] };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [GET_SELECTION_TOOL_NAME]: () => empty },
      }),
    );

    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_SELECTION_TOOL_NAME,
      {},
    )) as GetSelectionResult;
    expect(result.nodes).toEqual([]);
  });
});
