import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type GetAnnotationsResult,
  type GetDesignContextResult,
  type GetFontsResult,
  type GetLocalComponentsResult,
  type GetMetadataResult,
  type GetNodeResult,
  type GetNodesInfoResult,
  type GetPagesResult,
  type GetReactionsResult,
  type GetScreenshotResult,
  type GetStylesResult,
  type GetVariableDefsResult,
  type GetViewportResult,
  type ListFilesResult,
  type ScanNodesByTypesResult,
  type ScanTextNodesResult,
  type SearchNodesResult,
  serializeNode,
} from '@figma-mcp-relay/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';

import { dispatchTool } from '../../src/dispatch.js';
import { GET_ANNOTATIONS_TOOL_NAME } from '../../src/tools/get-annotations.js';
import { GET_DESIGN_CONTEXT_TOOL_NAME } from '../../src/tools/get-design-context.js';
import { GET_FONTS_TOOL_NAME } from '../../src/tools/get-fonts.js';
import { GET_LOCAL_COMPONENTS_TOOL_NAME } from '../../src/tools/get-local-components.js';
import { GET_METADATA_TOOL_NAME } from '../../src/tools/get-metadata.js';
import { GET_NODE_TOOL_NAME } from '../../src/tools/get-node.js';
import { GET_NODES_INFO_TOOL_NAME } from '../../src/tools/get-nodes-info.js';
import { GET_PAGES_TOOL_NAME } from '../../src/tools/get-pages.js';
import { GET_REACTIONS_TOOL_NAME } from '../../src/tools/get-reactions.js';
import { GET_SCREENSHOT_TOOL_NAME } from '../../src/tools/get-screenshot.js';
import { GET_STYLES_TOOL_NAME } from '../../src/tools/get-styles.js';
import { GET_VARIABLE_DEFS_TOOL_NAME } from '../../src/tools/get-variable-defs.js';
import { GET_VIEWPORT_TOOL_NAME } from '../../src/tools/get-viewport.js';
import { LIST_FILES_TOOL_NAME } from '../../src/tools/list-files.js';
import { handleSaveScreenshots } from '../../src/tools/save-screenshots.js';
import { SCAN_NODES_BY_TYPES_TOOL_NAME } from '../../src/tools/scan-nodes-by-types.js';
import { SCAN_TEXT_NODES_TOOL_NAME } from '../../src/tools/scan-text-nodes.js';
import { SEARCH_NODES_TOOL_NAME } from '../../src/tools/search-nodes.js';
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

const mockNode = (id: string, parentId: string | null = null) =>
  serializeNode({
    id,
    name: `Node ${id}`,
    type: 'RECTANGLE',
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    parent: parentId === null ? null : { id: parentId },
  });

describe('e2e get_node', () => {
  it('returns serialized node when found', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const sandboxResponse: GetNodeResult = { node: mockNode('1:2', '1:1') };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: {
          [GET_NODE_TOOL_NAME]: params => {
            expect((params as { nodeId: string }).nodeId).toBe('1:2');
            return sandboxResponse;
          },
        },
      }),
    );
    const result = (await dispatchTool({ node: h.node, follower: h.follower }, GET_NODE_TOOL_NAME, {
      nodeId: '1:2',
    })) as GetNodeResult;
    expect(result.node?.id).toBe('1:2');
  });

  it('returns { node: null } when sandbox reports missing', async () => {
    const h = await startLeader();
    harnesses.push(h);
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [GET_NODE_TOOL_NAME]: () => ({ node: null }) satisfies GetNodeResult },
      }),
    );
    const result = (await dispatchTool({ node: h.node, follower: h.follower }, GET_NODE_TOOL_NAME, {
      nodeId: '1:99',
    })) as GetNodeResult;
    expect(result.node).toBeNull();
  });
});

describe('e2e get_nodes_info', () => {
  it('round-trips an array preserving order with null slots', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: GetNodesInfoResult = {
      nodes: [mockNode('1:2'), null, mockNode('1:4')],
    };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [GET_NODES_INFO_TOOL_NAME]: () => response },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_NODES_INFO_TOOL_NAME,
      { nodeIds: ['1:2', '1:3', '1:4'] },
    )) as GetNodesInfoResult;
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0]?.id).toBe('1:2');
    expect(result.nodes[1]).toBeNull();
    expect(result.nodes[2]?.id).toBe('1:4');
  });
});

describe('e2e get_metadata', () => {
  it('returns fileName + currentPage + pages', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: GetMetadataResult = {
      fileName: 'Mockups.fig',
      currentPage: { id: 'p-2', name: 'Details' },
      pages: [
        { id: 'p-1', name: 'Cover' },
        { id: 'p-2', name: 'Details' },
      ],
    };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [GET_METADATA_TOOL_NAME]: () => response },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_METADATA_TOOL_NAME,
      {},
    )) as GetMetadataResult;
    expect(result).toEqual(response);
  });
});

describe('e2e get_pages', () => {
  it('returns page list', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: GetPagesResult = {
      pages: [
        { id: 'p-1', name: 'Cover' },
        { id: 'p-2', name: 'Details' },
      ],
    };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [GET_PAGES_TOOL_NAME]: () => response },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_PAGES_TOOL_NAME,
      {},
    )) as GetPagesResult;
    expect(result.pages).toHaveLength(2);
  });
});

describe('e2e search_nodes', () => {
  it('round-trips name/type args and returns matching nodes', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: SearchNodesResult = { nodes: [mockNode('1:2', '1:1')] };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: {
          [SEARCH_NODES_TOOL_NAME]: params => {
            expect(params).toEqual({ name: 'submit', type: 'TEXT' });
            return response;
          },
        },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      SEARCH_NODES_TOOL_NAME,
      { name: 'submit', type: 'TEXT' },
    )) as SearchNodesResult;
    expect(result.nodes.map(n => n.id)).toEqual(['1:2']);
  });
});

describe('e2e scan_text_nodes', () => {
  it('returns the text node array', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: ScanTextNodesResult = { nodes: [mockNode('1:2'), mockNode('1:3')] };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [SCAN_TEXT_NODES_TOOL_NAME]: () => response },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      SCAN_TEXT_NODES_TOOL_NAME,
      { root: '1:1' },
    )) as ScanTextNodesResult;
    expect(result.nodes).toHaveLength(2);
  });
});

describe('e2e scan_nodes_by_types', () => {
  it('round-trips types arg and returns matching nodes', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: ScanNodesByTypesResult = { nodes: [mockNode('1:2')] };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: {
          [SCAN_NODES_BY_TYPES_TOOL_NAME]: params => {
            expect((params as { types: string[] }).types).toEqual(['COMPONENT']);
            return response;
          },
        },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      SCAN_NODES_BY_TYPES_TOOL_NAME,
      { types: ['COMPONENT'] },
    )) as ScanNodesByTypesResult;
    expect(result.nodes.map(n => n.id)).toEqual(['1:2']);
  });
});

describe('e2e get_styles', () => {
  it('returns the four grouped style categories', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: GetStylesResult = {
      paints: [
        {
          id: 'S:1',
          name: 'Primary',
          key: 'k1',
          description: '',
          paints: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 0, b: 0 } }],
        },
      ],
      texts: [],
      effects: [],
      grids: [],
    };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [GET_STYLES_TOOL_NAME]: () => response },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_STYLES_TOOL_NAME,
      {},
    )) as GetStylesResult;
    expect(result.paints[0]?.name).toBe('Primary');
    expect(result).toEqual(response);
  });
});

describe('e2e get_variable_defs', () => {
  it('returns collections and variables with valuesByMode', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: GetVariableDefsResult = {
      collections: [
        {
          id: 'VC:1',
          name: 'Theme',
          key: 'ck',
          defaultModeId: 'm1',
          modes: [{ modeId: 'm1', name: 'Light' }],
          variableIds: ['V:1'],
        },
      ],
      variables: [
        {
          id: 'V:1',
          name: 'bg',
          key: 'vk',
          resolvedType: 'COLOR',
          collectionId: 'VC:1',
          valuesByMode: { m1: { r: 1, g: 1, b: 1, a: 1 } },
        },
      ],
    };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [GET_VARIABLE_DEFS_TOOL_NAME]: () => response },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_VARIABLE_DEFS_TOOL_NAME,
      {},
    )) as GetVariableDefsResult;
    expect(result).toEqual(response);
  });
});

describe('e2e get_local_components', () => {
  it('returns components and component sets', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: GetLocalComponentsResult = {
      components: [{ id: 'C:1', name: 'Icon', key: 'ck', description: '', parentId: null }],
      componentSets: [
        {
          id: 'CS:1',
          name: 'Button',
          key: 'csk',
          description: '',
          componentIds: ['C:2'],
          variantGroupProperties: { Size: { values: ['S', 'L'] } },
        },
      ],
    };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [GET_LOCAL_COMPONENTS_TOOL_NAME]: () => response },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_LOCAL_COMPONENTS_TOOL_NAME,
      {},
    )) as GetLocalComponentsResult;
    expect(result).toEqual(response);
  });
});

describe('e2e get_viewport', () => {
  it('returns center / zoom / bounds', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: GetViewportResult = {
      center: { x: 0, y: 0 },
      zoom: 1,
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
    };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [GET_VIEWPORT_TOOL_NAME]: () => response },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_VIEWPORT_TOOL_NAME,
      {},
    )) as GetViewportResult;
    expect(result).toEqual(response);
  });
});

describe('e2e get_fonts', () => {
  it('returns frequency-sorted fonts', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: GetFontsResult = {
      fonts: [{ fontName: { family: 'Inter', style: 'Regular' }, count: 3 }],
    };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [GET_FONTS_TOOL_NAME]: () => response },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_FONTS_TOOL_NAME,
      {},
    )) as GetFontsResult;
    expect(result).toEqual(response);
  });
});

describe('e2e get_annotations', () => {
  it('returns annotated nodes', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: GetAnnotationsResult = {
      annotations: [{ nodeId: '1:1', nodeName: 'Card', annotations: [{ label: 'Use token' }] }],
    };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [GET_ANNOTATIONS_TOOL_NAME]: () => response },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_ANNOTATIONS_TOOL_NAME,
      {},
    )) as GetAnnotationsResult;
    expect(result).toEqual(response);
  });
});

describe('e2e get_reactions', () => {
  it('round-trips nodeId and returns reactions', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: GetReactionsResult = {
      nodeId: '1:1',
      reactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'BACK' }] }],
    };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: {
          [GET_REACTIONS_TOOL_NAME]: params => {
            expect((params as { nodeId: string }).nodeId).toBe('1:1');
            return response;
          },
        },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_REACTIONS_TOOL_NAME,
      { nodeId: '1:1' },
    )) as GetReactionsResult;
    expect(result).toEqual(response);
  });
});

describe('e2e list_files', () => {
  it('returns the current file', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: ListFilesResult = {
      files: [
        { fileKey: 'abc', fileName: 'Mockups.fig', currentPage: { id: 'p-1', name: 'Cover' } },
      ],
    };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: { [LIST_FILES_TOOL_NAME]: () => response },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      LIST_FILES_TOOL_NAME,
      {},
    )) as ListFilesResult;
    expect(result).toEqual(response);
  });
});

describe('e2e get_design_context', () => {
  it('round-trips params and returns the depth-limited tree', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: GetDesignContextResult = {
      nodes: [
        {
          id: 'r',
          name: 'Root',
          type: 'FRAME',
          children: [{ id: 'c', name: 'Child', type: 'TEXT' }],
        },
      ],
    };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: {
          [GET_DESIGN_CONTEXT_TOOL_NAME]: params => {
            expect(params).toEqual({ depth: 2, detail: 'compact' });
            return response;
          },
        },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_DESIGN_CONTEXT_TOOL_NAME,
      { depth: 2, detail: 'compact' },
    )) as GetDesignContextResult;
    expect(result.nodes[0]?.children?.[0]?.id).toBe('c');
  });
});

describe('e2e get_screenshot', () => {
  it('round-trips nodeIds and returns base64 images', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const response: GetScreenshotResult = {
      images: [{ nodeId: '1:1', format: 'PNG', base64: 'AAAA' }],
    };
    sockets.push(
      await connectFakePlugin({
        port: h.port,
        handlers: {
          [GET_SCREENSHOT_TOOL_NAME]: params => {
            expect((params as { nodeIds: string[] }).nodeIds).toEqual(['1:1']);
            return response;
          },
        },
      }),
    );
    const result = (await dispatchTool(
      { node: h.node, follower: h.follower },
      GET_SCREENSHOT_TOOL_NAME,
      { nodeIds: ['1:1'] },
    )) as GetScreenshotResult;
    expect(result.images[0]?.base64).toBe('AAAA');
  });
});

describe('e2e save_screenshots', () => {
  it('exports via the plugin and writes the bytes to disk', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const dir = await mkdtemp(join(tmpdir(), 'e2e-save-screenshots-'));
    try {
      const response: GetScreenshotResult = {
        images: [{ nodeId: '1:1', format: 'PNG', base64: 'AAAA' }],
      };
      sockets.push(
        await connectFakePlugin({
          port: h.port,
          handlers: {
            [GET_SCREENSHOT_TOOL_NAME]: params => {
              expect((params as { nodeIds: string[] }).nodeIds).toEqual(['1:1']);
              return response;
            },
          },
        }),
      );

      const result = await handleSaveScreenshots(
        (tool, args) => dispatchTool({ node: h.node, follower: h.follower }, tool, args),
        { nodeIds: ['1:1'], outDir: dir },
      );

      const written = result.saved[0]?.path;
      expect(written).toBe(join(dir, '1-1.png'));
      expect((await readFile(written as string)).toString('base64')).toBe('AAAA');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
