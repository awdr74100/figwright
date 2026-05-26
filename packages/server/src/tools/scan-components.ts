import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

import { analyzeProject, type ProjectProfile } from '../profile/profile.js';
import { scanComponents, type ScannedComponent } from '../scan/scan.js';

export const SCAN_COMPONENTS_TOOL_NAME = 'scan_components';

export const ScanComponentsInputSchema = v.object({
  rootDir: v.optional(v.string()),
  extensions: v.optional(v.array(v.string())),
});
export type ScanComponentsInput = v.InferOutput<typeof ScanComponentsInputSchema>;

export interface ScanComponentsResult {
  components: ScannedComponent[];
  profile: ProjectProfile;
}

export const scanComponentsToolDefinition: Tool = {
  name: SCAN_COMPONENTS_TOOL_NAME,
  description:
    'Scan the local project for existing UI components so they can be reused instead of regenerated. ' +
    'Runs on the server filesystem, not in Figma. Identifies components by AST signature (exported, ' +
    'PascalCase, function-ish) rather than by folder layout, so any structure works. React (.tsx/.jsx) ' +
    'is parsed for name + props; Vue/Svelte yield filename-derived names. extensions defaults to the ' +
    "detected profile's; rootDir defaults to the server cwd. Returns { components, profile }.",
  inputSchema: {
    type: 'object',
    properties: {
      rootDir: { type: 'string', description: 'Project root to scan; defaults to the server cwd' },
      extensions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Component file extensions to scan; defaults to the detected profile',
      },
    },
    additionalProperties: false,
  },
};

export const handleScanComponents = async (rawArgs: unknown): Promise<ScanComponentsResult> => {
  const args = v.parse(ScanComponentsInputSchema, rawArgs);
  const rootDir = args.rootDir ?? process.cwd();
  const profile = await analyzeProject(rootDir);
  const extensions = args.extensions ?? profile.componentExtensions;
  const components = await scanComponents(rootDir, extensions);
  return { components, profile };
};
