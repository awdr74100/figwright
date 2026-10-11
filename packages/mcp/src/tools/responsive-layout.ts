import { ResponsiveLayoutConfigureInputSchema } from '@figwright/shared';
import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const configureResponsiveLayoutTool: ToolSpec = {
  name: 'configure_responsive_layout',
  kind: 'write',
  inputSchema: ResponsiveLayoutConfigureInputSchema,
  description:
    'Maintain explicit responsive rules while the plugin is open. First use_file and confirm page/root/target IDs. Disabled by default; no panel editing. Each ordinary FRAME root supplies width (not viewport); standard-v1 thresholds are base=0, sm=640, md=768, lg=1024, xl=1280, 2xl=1536. Preserve existing custom thresholds; config/root breakpointValues override names, or choose none and numeric rules. Base owns fields; only the selected breakpoint overrides them, without accumulated history. Supports protected FRAME layout, existing GRID tracks, complete-node visibility and public INSTANCE BOOLEAN/VARIANT properties, not component internals or content fitting. Roots cannot overlap or control their own width. Other pages pause; disable stops future writes without rollback. Returns accepted/applied plus per-root status/errors: inspect them, not just acceptance. New config must target the current page; enabled without config toggles saved rules.',
};
export const getResponsiveLayoutTool: ToolSpec = {
  name: 'get_responsive_layout',
  kind: 'read',
  inputSchema: z.strictObject({}),
  description:
    'Read saved responsive configuration, effective thresholds and per-root active/paused/disabled/error state without scanning or modifying the design. Select the intended file with use_file first. The plugin must stay open for automatic rules to run. Inspect errors and reconfigure explicitly to retry a failed root.',
};
