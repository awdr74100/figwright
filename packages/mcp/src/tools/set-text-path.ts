import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_TEXT_PATH_TOOL_NAME = 'set_text_path';

export const setTextPathTool: ToolSpec = {
  name: SET_TEXT_PATH_TOOL_NAME,
  description:
    'Move where text on a path (TEXT_PATH) starts: a segment of its path and 0–1 along it — the ' +
    'same textPathStartData get_node reports. The segments are numbered as create_text_path ' +
    'describes; an index past the last is refused (Figma would silently ignore it). Edit the text ' +
    'itself with set_text / set_text_properties / set_text_range. Returns { ok, nodeId }.',
  inputSchema: z.object({
    nodeId: z.string().describe('The text on a path'),
    startSegment: z.number().int().min(0).optional().describe('Path segment the text starts on'),
    startPosition: z.number().min(0).max(1).optional().describe('How far along that segment, 0–1'),
  }),
  kind: 'write',
};
