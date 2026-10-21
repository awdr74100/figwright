import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_VECTOR_TOOL_NAME = 'get_vector';

export const getVectorTool: ToolSpec = {
  name: GET_VECTOR_TOOL_NAME,
  description:
    'Read a vector’s geometry — what set_vector takes back: vectorPaths (SVG path data per ' +
    'subpath, measured from the layer’s top-left) and vectorNetwork (vertices, the segments joining ' +
    'them with their Bézier tangents, the regions that fill, and per-vertex caps, joins and ' +
    'corner radii), plus handleMirroring. For a VECTOR or text on a path (TEXT_PATH, read-only); ' +
    'a rectangle, ellipse, polygon, star or line has no editable path — flatten_nodes it into a ' +
    'VECTOR first. Not part of get_node / get_design_context, which stay small; codegen exports ' +
    'vector art rather than rebuilding it from its points. Returns { nodeId, type, width, height, ' +
    'vectorPaths, vectorNetwork, handleMirroring }.',
  inputSchema: z.object({
    nodeId: z.string().describe('A VECTOR or TEXT_PATH node id'),
  }),
  kind: 'read',
};
