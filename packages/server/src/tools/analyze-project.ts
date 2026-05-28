import { z } from 'zod';

import { analyzeProject, type ProjectProfile } from '../profile/profile.js';
import { specToToolDefinition, type ToolSpec } from './spec.js';

export const ANALYZE_PROJECT_TOOL_NAME = 'analyze_project';

const inputShape = {
  rootDir: z.string().describe('Project root to analyze; defaults to the server cwd').optional(),
};

export const analyzeProjectTool: ToolSpec = {
  name: ANALYZE_PROJECT_TOOL_NAME,
  description:
    'Detect the local project profile (framework, language, styling system, component file ' +
    'extensions) by reading manifests and config — the foundation scan_components / component_map ' +
    'switch on. Optional standalone probe: those tools run detection internally and return the same ' +
    'profile, so call this only to inspect detection in isolation (no Figma, no file scan). Runs on ' +
    'the server filesystem. rootDir defaults to the server cwd. Detects Tailwind v3 (config file) and ' +
    'v4 (CSS-first @import/@theme) and reports tailwindVersion.',
  inputShape,
  kind: 'local',
};

export const analyzeProjectToolDefinition = specToToolDefinition(analyzeProjectTool);

export const handleAnalyzeProject = async (rawArgs: unknown): Promise<ProjectProfile> => {
  const args = z.object(inputShape).parse(rawArgs);
  return analyzeProject(args.rootDir ?? process.cwd());
};
