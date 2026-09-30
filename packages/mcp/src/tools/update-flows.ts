import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const UPDATE_FLOWS_TOOL_NAME = 'update_flows';

export const updateFlowsTool: ToolSpec = {
  name: UPDATE_FLOWS_TOOL_NAME,
  description:
    "Rename, add, remove or reorder a page's prototype flows — the named starting points " +
    "Presentation view lists (get_pages shows each page's flows). A flow's name is its own: it is " +
    'not the frame name (rename_node) or the page name (rename_page). Flows are addressed by their ' +
    "starting frame's nodeId, never by name, since several flows may share one. Only the flows " +
    'named are touched; every other flow keeps its name and place. flows renames a flow in place, ' +
    'or makes a frame a new flow appended at the end; remove stops a frame being a flow (the frame ' +
    'and its reactions stay); order moves flows to the front, and the first flow is the one ' +
    'Presentation view opens by default. A flow starts on a visible top-level frame, component or ' +
    'instance of that page (directly on it or in a section). A flow whose frame is hidden, grouped ' +
    'or nested is invisible to plugins until that frame is visible and top-level again, so it can ' +
    'be neither listed nor changed. The list is checked before and read back after the write: any ' +
    'argument that cannot apply leaves the page unchanged, and the error names the frame and why. ' +
    'Returns { ok, pageId, flows } with the full list as it now stands.',
  inputSchema: z.object({
    pageId: z.string().describe('Page whose flows to change, from get_pages'),
    flows: z
      .array(
        z.object({
          nodeId: z.string().describe('Starting frame of the flow'),
          name: z.string().min(1).describe('Flow name, e.g. "Sign up"'),
        }),
      )
      .optional()
      .describe('Flows to rename, or frames to make new flows'),
    remove: z
      .array(z.string())
      .optional()
      .describe('Starting frames whose flow to remove; the frames themselves are kept'),
    order: z
      .array(z.string())
      .optional()
      .describe(
        'Starting frames to move to the front, in this order; the first becomes the default flow',
      ),
  }),
  kind: 'write',
};
