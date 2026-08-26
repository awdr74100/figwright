import { z } from 'zod';

import { analyzeProject, type ProjectProfile } from '../profile/profile.js';
import type { ToolSpec } from './spec.js';

export const ANALYZE_PROJECT_TOOL_NAME = 'analyze_project';

const inputSchema = z.object({
  rootDir: z.string().describe('Project root to analyze; defaults to the server cwd').optional(),
});

export const analyzeProjectTool: ToolSpec = {
  name: ANALYZE_PROJECT_TOOL_NAME,
  description:
    'Detect the local project profile (framework, language, styling system, component file ' +
    'extensions, svg handling) by reading manifests and config — the foundation scan_components / component_map ' +
    'switch on. Optional standalone probe: those tools run detection internally and return the same ' +
    'profile, so call this only to inspect detection in isolation (no Figma, no file scan). Runs on ' +
    'the server filesystem. rootDir defaults to the server cwd. Detects Tailwind v3 (config file) and ' +
    'v4 (CSS-first @import/@theme) and reports tailwindVersion, and UnoCSS (uno.config.* / a ' +
    "@unocss package) as styling.system 'unocss'; detects svg loader (svgr / " +
    "vite-svg-loader / …) → svg.mode component vs url + an import hint. Also reads the project's " +
    'own preprocessor stylesheets (.scss/.sass/.less/.styl/.pcss, and SFC <style lang="scss"> ' +
    'blocks) to ' +
    'report styling.classNaming — how it spells a compound BEM-style class: ' +
    "'ampersand' (.card { &__title {} }) or 'flat' (.card__title {}). Match it. When it is absent " +
    'the project has no such habit: declare class names flat and in full, so the class the markup ' +
    'carries is findable by searching for it — a name assembled from & exists only after ' +
    'compilation. Never "flatten" by nesting the full name (.card { .card__title {} }): that ' +
    'compiles to the descendant selector .card .card__title, adding specificity and breaking the ' +
    'moment the element is not a DOM descendant.',
  inputSchema,
  kind: 'local',
  // No sandbox handler of its own; its plugin arguments are recorded under the tool it reuses.
  serverOnlyArgs: null,
};
export const handleAnalyzeProject = async (rawArgs: unknown): Promise<ProjectProfile> => {
  const args = inputSchema.parse(rawArgs);
  return analyzeProject(args.rootDir ?? process.cwd());
};
