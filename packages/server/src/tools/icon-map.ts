import type { GetDesignContextResult } from '@figma-mcp-relay/shared';
import { z } from 'zod';

import { detectIconLibraries, scanRepoSvgs } from '../icons/repo-icons.js';
import { collectFigmaIcons, type IconMapping, joinIcons } from '../join/icon-map.js';
import { analyzeProject, type ProjectProfile, readProjectDeps } from '../profile/profile.js';
import { GET_DESIGN_CONTEXT_TOOL_NAME } from './get-design-context.js';
import type { ToolSpec } from './spec.js';

export const ICON_MAP_TOOL_NAME = 'icon_map';

const DEFAULT_THRESHOLD = 0.7;

const inputShape = {
  nodeId: z.string().describe('Root node id; omit to use the selection or current page').optional(),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence at/above which a match counts as a reliable reuse (default 0.7)')
    .optional(),
  rootDir: z.string().describe('Project root to scan; defaults to the server cwd').optional(),
};

export interface IconMapResult {
  mappings: IconMapping[];
  /**
   * Figma icon names with no `.svg` match — export fresh (get_screenshot SVG) or use an icon
   * library.
   */
  unmapped: string[];
  /**
   * Icon component libraries detected in the project (lucide / heroicons / iconify …). The
   * alternative route for unmapped icons: import from one of these instead of exporting. Empty when
   * none installed, in which case unmapped icons fall back to a fresh get_screenshot SVG export.
   */
  iconLibraries: string[];
  profile: ProjectProfile;
  svgFileCount: number;
}

export const iconMapTool: ToolSpec = {
  name: ICON_MAP_TOOL_NAME,
  description:
    "Map the Figma icon nodes in a selection/subtree to the project's existing `.svg` files, so codegen " +
    'reuses the designer-curated asset instead of re-exporting a duplicate. Joins the grounded Figma icon ' +
    'names against the repo svg files (gitignore-aware scan), name-based and near-exact (a wrong icon is a ' +
    'silent visual bug, so unsure matches fall through to a fresh export rather than mis-reuse). Each match ' +
    'reports the file path, the color contract read from the file (currentColor / fixed / multi-color), and ' +
    'how to recolor it in this project (currentColor → text-{token}, gated on the svg mode since currentColor ' +
    'dies through an <img>). It does not fabricate the import line — compose it from the file path and ' +
    'profile.svg (importHint gives the loader form: svgr `?react` / vite-svg-loader `?component` / ' +
    "`{ ReactComponent }` / url `<img>`), mirroring the project's existing imports for the alias/relative " +
    'path. Unmatched icons are returned in `unmapped`; `iconLibraries` lists any installed icon component ' +
    'library (lucide / heroicons / iconify) as the alternative to a fresh export. rootDir defaults to the ' +
    'server cwd. Returns { mappings, unmapped, iconLibraries, profile }.',
  inputShape,
  kind: 'local',
};
export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Orchestrate the icon join: pull the grounded Figma tree (reusing get_design_context — no
 * dedicated plugin handler), scan the repo's `.svg` files + detect icon libraries, and join.
 * Filesystem + dispatch live here; the matching itself is pure (join/icon-map.ts).
 */
export const handleIconMap = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
): Promise<IconMapResult> => {
  const args = z.object(inputShape).parse(rawArgs);
  const rootDir = args.rootDir ?? process.cwd();
  const threshold = args.threshold ?? DEFAULT_THRESHOLD;

  const contextArgs: Record<string, unknown> = { detail: 'full', dedupeComponents: true };
  if (args.nodeId !== undefined) contextArgs.nodeId = args.nodeId;

  const [context, profile, svgs, deps] = await Promise.all([
    dispatch(GET_DESIGN_CONTEXT_TOOL_NAME, contextArgs) as Promise<GetDesignContextResult>,
    analyzeProject(rootDir),
    scanRepoSvgs(rootDir),
    readProjectDeps(rootDir),
  ]);

  const icons = collectFigmaIcons(context.nodes);
  const mappings = joinIcons(icons, svgs, {
    threshold,
    svg: profile.svg,
    tailwind: profile.styling.system === 'tailwind',
  });
  const unmapped = mappings.filter(m => m.status === 'unmapped').map(m => m.name);

  return {
    mappings,
    unmapped,
    iconLibraries: detectIconLibraries(deps),
    profile,
    svgFileCount: svgs.length,
  };
};
