import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

import { analyzeProject, type ProjectProfile } from '../profile/profile.js';

export const ANALYZE_PROJECT_TOOL_NAME = 'analyze_project';

export const AnalyzeProjectInputSchema = v.object({
  rootDir: v.optional(v.string()),
});
export type AnalyzeProjectInput = v.InferOutput<typeof AnalyzeProjectInputSchema>;

export const analyzeProjectToolDefinition: Tool = {
  name: ANALYZE_PROJECT_TOOL_NAME,
  description:
    'Detect the local project profile (framework, language, styling system, component file ' +
    'extensions) by reading manifests and config — the foundation scan_components / component_map ' +
    'switch on. Optional standalone probe: those tools run detection internally and return the same ' +
    'profile, so call this only to inspect detection in isolation (no Figma, no file scan). Runs on ' +
    'the server filesystem. rootDir defaults to the server cwd. Detects Tailwind v3 (config file) and ' +
    'v4 (CSS-first @import/@theme) and reports tailwindVersion.',
  inputSchema: {
    type: 'object',
    properties: {
      rootDir: {
        type: 'string',
        description: 'Project root to analyze; defaults to the server cwd',
      },
    },
    additionalProperties: false,
  },
};

export const handleAnalyzeProject = async (rawArgs: unknown): Promise<ProjectProfile> => {
  const args = v.parse(AnalyzeProjectInputSchema, rawArgs);
  return analyzeProject(args.rootDir ?? process.cwd());
};
