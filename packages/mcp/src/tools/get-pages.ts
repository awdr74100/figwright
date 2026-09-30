import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_PAGES_TOOL_NAME = 'get_pages';

export const getPagesTool: ToolSpec = {
  name: GET_PAGES_TOOL_NAME,
  description:
    'Return every page in the active Figma file as { id, name, flows }. flows lists the prototype ' +
    'flows Presentation view offers on that page, as { nodeId, name } in order: nodeId is the ' +
    "flow's starting frame, and the first flow is the one Presentation view opens by default. " +
    'An empty flows means the page has none a plugin can see (a flow whose frame is hidden, ' +
    'grouped or nested is invisible until that frame is visible and top-level again). Change ' +
    'flows with update_flows.',
  inputSchema: z.object({}),
  kind: 'read',
};
