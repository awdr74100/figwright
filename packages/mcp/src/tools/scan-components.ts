import { z } from 'zod';

import { analyzeProject, type ProjectProfile } from '../profile/profile.js';
import { scanComponents, type ScannedComponent } from '../scan/scan.js';
import type { ToolSpec } from './spec.js';

export const SCAN_COMPONENTS_TOOL_NAME = 'scan_components';

const inputSchema = z.object({
  rootDir: z.string().describe('Project root to scan; defaults to the server cwd').optional(),
  extensions: z
    .array(z.string())
    .describe('Component file extensions to scan; defaults to the detected profile')
    .optional(),
});

export const scanComponentsTool: ToolSpec = {
  name: SCAN_COMPONENTS_TOOL_NAME,
  description:
    'Scan the local project for existing UI components so they can be reused instead of regenerated. ' +
    'Runs on the server filesystem, not in Figma. Identifies components by AST signature (exported, ' +
    'PascalCase, function-ish) rather than by folder layout, so any structure works. React (.tsx/.jsx) ' +
    'is parsed for name + props; Vue/Svelte derive the name from the file and parse props from the ' +
    '<script> block (defineProps / export let / $props). extensions defaults to the ' +
    "detected profile's; rootDir defaults to the server cwd. Returns { components, profile }.",
  inputSchema,
  kind: 'local',
  // No sandbox handler of its own; its plugin arguments are recorded under the tool it reuses.
  serverOnlyArgs: null,
};
export interface ScanComponentsResult {
  components: ScannedComponent[];
  profile: ProjectProfile;
}

export const handleScanComponents = async (rawArgs: unknown): Promise<ScanComponentsResult> => {
  const args = inputSchema.parse(rawArgs);
  const rootDir = args.rootDir ?? process.cwd();
  const profile = await analyzeProject(rootDir);
  const extensions = args.extensions ?? profile.componentExtensions;
  const components = await scanComponents(rootDir, extensions);
  return { components, profile };
};
