import { describe, expect, it } from 'vitest';

import { GET_ANNOTATIONS_TOOL_NAME, getAnnotationsTool } from '../../src/tools/get-annotations.js';
import {
  GET_DESIGN_CONTEXT_TOOL_NAME,
  getDesignContextTool,
} from '../../src/tools/get-design-context.js';
import { GET_FONTS_TOOL_NAME, getFontsTool } from '../../src/tools/get-fonts.js';
import {
  GET_LOCAL_COMPONENTS_TOOL_NAME,
  getLocalComponentsTool,
} from '../../src/tools/get-local-components.js';
import { GET_METADATA_TOOL_NAME, getMetadataTool } from '../../src/tools/get-metadata.js';
import { GET_NODE_TOOL_NAME, getNodeTool } from '../../src/tools/get-node.js';
import { GET_NODES_INFO_TOOL_NAME, getNodesInfoTool } from '../../src/tools/get-nodes-info.js';
import { GET_PAGES_TOOL_NAME, getPagesTool } from '../../src/tools/get-pages.js';
import { GET_REACTIONS_TOOL_NAME, getReactionsTool } from '../../src/tools/get-reactions.js';
import { GET_SCREENSHOT_TOOL_NAME, getScreenshotTool } from '../../src/tools/get-screenshot.js';
import { GET_STYLES_TOOL_NAME, getStylesTool } from '../../src/tools/get-styles.js';
import {
  GET_VARIABLE_DEFS_TOOL_NAME,
  getVariableDefsTool,
} from '../../src/tools/get-variable-defs.js';
import { GET_VIEWPORT_TOOL_NAME, getViewportTool } from '../../src/tools/get-viewport.js';
import { LIST_FILES_TOOL_NAME, listFilesTool } from '../../src/tools/list-files.js';
import {
  SCAN_NODES_BY_TYPES_TOOL_NAME,
  scanNodesByTypesTool,
} from '../../src/tools/scan-nodes-by-types.js';
import { SCAN_TEXT_NODES_TOOL_NAME, scanTextNodesTool } from '../../src/tools/scan-text-nodes.js';
import { SEARCH_NODES_TOOL_NAME, searchNodesTool } from '../../src/tools/search-nodes.js';
import { toToolDefinition } from '../tool-schema.js';

const getAnnotationsToolDefinition = toToolDefinition(getAnnotationsTool);
const getDesignContextToolDefinition = toToolDefinition(getDesignContextTool);
const getFontsToolDefinition = toToolDefinition(getFontsTool);
const getLocalComponentsToolDefinition = toToolDefinition(getLocalComponentsTool);
const getMetadataToolDefinition = toToolDefinition(getMetadataTool);
const getNodeToolDefinition = toToolDefinition(getNodeTool);
const getNodesInfoToolDefinition = toToolDefinition(getNodesInfoTool);
const getPagesToolDefinition = toToolDefinition(getPagesTool);
const getReactionsToolDefinition = toToolDefinition(getReactionsTool);
const getScreenshotToolDefinition = toToolDefinition(getScreenshotTool);
const getStylesToolDefinition = toToolDefinition(getStylesTool);
const getVariableDefsToolDefinition = toToolDefinition(getVariableDefsTool);
const getViewportToolDefinition = toToolDefinition(getViewportTool);
const listFilesToolDefinition = toToolDefinition(listFilesTool);
const scanNodesByTypesToolDefinition = toToolDefinition(scanNodesByTypesTool);
const scanTextNodesToolDefinition = toToolDefinition(scanTextNodesTool);
const searchNodesToolDefinition = toToolDefinition(searchNodesTool);

describe('M1 read tools — definitions', () => {
  it('get_node declares nodeId string input as required', () => {
    expect(getNodeToolDefinition.name).toBe(GET_NODE_TOOL_NAME);
    expect(getNodeToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      required: ['nodeId'],
      properties: { nodeId: { type: 'string' } },
    });
  });

  it('get_nodes_info declares nodeIds array input as required', () => {
    expect(getNodesInfoToolDefinition.name).toBe(GET_NODES_INFO_TOOL_NAME);
    expect(getNodesInfoToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      required: ['nodeIds'],
      properties: { nodeIds: { type: 'array', items: { type: 'string' } } },
    });
  });

  it('get_metadata declares empty input', () => {
    expect(getMetadataToolDefinition.name).toBe(GET_METADATA_TOOL_NAME);
    expect(getMetadataToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
  });

  it('get_pages declares empty input', () => {
    expect(getPagesToolDefinition.name).toBe(GET_PAGES_TOOL_NAME);
    expect(getPagesToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
  });

  it('search_nodes declares optional name/type/root with nothing required', () => {
    expect(searchNodesToolDefinition.name).toBe(SEARCH_NODES_TOOL_NAME);
    expect(searchNodesToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string' },
        root: { type: 'string' },
      },
    });
    expect(searchNodesToolDefinition.inputSchema.required).toBeUndefined();
  });

  it('scan_text_nodes declares optional root only', () => {
    expect(scanTextNodesToolDefinition.name).toBe(SCAN_TEXT_NODES_TOOL_NAME);
    expect(scanTextNodesToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      properties: { root: { type: 'string' } },
      additionalProperties: false,
    });
    expect(scanTextNodesToolDefinition.inputSchema.required).toBeUndefined();
  });

  it('scan_nodes_by_types requires a types string array', () => {
    expect(scanNodesByTypesToolDefinition.name).toBe(SCAN_NODES_BY_TYPES_TOOL_NAME);
    expect(scanNodesByTypesToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      required: ['types'],
      properties: { types: { type: 'array', items: { type: 'string' } }, root: { type: 'string' } },
    });
  });

  it('get_styles / get_variable_defs / get_local_components declare empty input', () => {
    for (const [name, def] of [
      [GET_STYLES_TOOL_NAME, getStylesToolDefinition],
      [GET_VARIABLE_DEFS_TOOL_NAME, getVariableDefsToolDefinition],
      [GET_LOCAL_COMPONENTS_TOOL_NAME, getLocalComponentsToolDefinition],
    ] as const) {
      expect(def.name).toBe(name);
      expect(def.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(def.inputSchema.required).toBeUndefined();
    }
  });

  it('get_viewport / get_fonts declare empty input', () => {
    for (const [name, def] of [
      [GET_VIEWPORT_TOOL_NAME, getViewportToolDefinition],
      [GET_FONTS_TOOL_NAME, getFontsToolDefinition],
    ] as const) {
      expect(def.name).toBe(name);
      expect(def.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(def.inputSchema.required).toBeUndefined();
    }
  });

  it('get_annotations declares optional nodeId, get_reactions requires nodeId', () => {
    expect(getAnnotationsToolDefinition.name).toBe(GET_ANNOTATIONS_TOOL_NAME);
    expect(getAnnotationsToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      properties: { nodeId: { type: 'string' } },
    });
    expect(getAnnotationsToolDefinition.inputSchema.required).toBeUndefined();

    expect(getReactionsToolDefinition.name).toBe(GET_REACTIONS_TOOL_NAME);
    expect(getReactionsToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      required: ['nodeId'],
      properties: { nodeId: { type: 'string' } },
    });
  });

  it('list_files declares empty input', () => {
    expect(listFilesToolDefinition.name).toBe(LIST_FILES_TOOL_NAME);
    expect(listFilesToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(listFilesToolDefinition.inputSchema.required).toBeUndefined();
  });

  it('get_design_context declares optional nodeId / depth / detail / dedupeComponents', () => {
    expect(getDesignContextToolDefinition.name).toBe(GET_DESIGN_CONTEXT_TOOL_NAME);
    expect(getDesignContextToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        depth: { type: 'number', minimum: 0 },
        detail: { type: 'string', enum: ['minimal', 'compact', 'full'] },
        dedupeComponents: { type: 'boolean' },
      },
    });
    expect(getDesignContextToolDefinition.inputSchema.required).toBeUndefined();
  });

  it('get_screenshot requires nodeIds and declares format / scale', () => {
    expect(getScreenshotToolDefinition.name).toBe(GET_SCREENSHOT_TOOL_NAME);
    expect(getScreenshotToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      required: ['nodeIds'],
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        format: { type: 'string', enum: ['PNG', 'JPG', 'SVG'] },
        scale: { type: 'number', minimum: 0 },
      },
    });
  });
});
