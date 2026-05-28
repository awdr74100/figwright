import { z } from 'zod';

import { analyzeProject, type ProjectProfile } from '../profile/profile.js';
import { scanComponents, type ScannedComponent } from '../scan/scan.js';
import { specToToolDefinition, type ToolSpec } from './spec.js';

export const SCAN_COMPONENTS_TOOL_NAME = 'scan_components';

const inputShape = {
  rootDir: z.string().describe('Project root to scan; defaults to the server cwd').optional(),
  extensions: z
    .array(z.string())
    .describe('Component file extensions to scan; defaults to the detected profile')
    .optional(),
};

export const scanComponentsTool: ToolSpec = {
  name: SCAN_COMPONENTS_TOOL_NAME,
  description:
    'Scan the local project for existing UI components so they can be reused instead of regenerated. ' +
    'Runs on the server filesystem, not in Figma. Identifies components by AST signature (exported, ' +
    'PascalCase, function-ish) rather than by folder layout, so any structure works. React (.tsx/.jsx) ' +
    'is parsed for name + props; Vue/Svelte yield filename-derived names. extensions defaults to the ' +
    "detected profile's; rootDir defaults to the server cwd. Returns { components, profile }.",
  inputShape,
  kind: 'local',
};

export const scanComponentsToolDefinition = specToToolDefinition(scanComponentsTool);

export interface ScanComponentsResult {
  components: ScannedComponent[];
  profile: ProjectProfile;
}

export const handleScanComponents = async (rawArgs: unknown): Promise<ScanComponentsResult> => {
  const args = z.object(inputShape).parse(rawArgs);
  const rootDir = args.rootDir ?? process.cwd();
  const profile = await analyzeProject(rootDir);
  const extensions = args.extensions ?? profile.componentExtensions;
  const components = await scanComponents(rootDir, extensions);
  return { components, profile };
};
