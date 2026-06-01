import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GetDesignContextResult } from '@figma-mcp-relay/shared';
import { z } from 'zod';

import {
  collectFigmaComponents,
  type ComponentMapping,
  joinComponents,
  parseMapFile,
} from '../join/component-map.js';
import { analyzeProject, type ProjectProfile } from '../profile/profile.js';
import { scanComponents } from '../scan/scan.js';
import { GET_DESIGN_CONTEXT_TOOL_NAME } from './get-design-context.js';
import type { ToolSpec } from './spec.js';

export const COMPONENT_MAP_TOOL_NAME = 'component_map';

const DEFAULT_THRESHOLD = 0.7;
const MAP_FILE = 'docs/figma-component-map.md';

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

export interface ComponentMapResult {
  mappings: ComponentMapping[];
  /** Distinct Figma component names with no code candidate ≥ 0.5 — the "to build" list. */
  unmapped: string[];
  profile: ProjectProfile;
  scannedComponentCount: number;
}

export const componentMapTool: ToolSpec = {
  name: COMPONENT_MAP_TOOL_NAME,
  description:
    'Map the Figma component instances in a selection/subtree to existing local code components, so ' +
    'they can be reused instead of regenerated. Joins the grounded Figma component names (and their ' +
    'variant axes) against an AST scan of the project; an explicit docs/figma-component-map.md row ' +
    'overrides the fuzzy match. Each distinct component is mapped once with all its instance ids. ' +
    'A mapped candidate also reports matchedProps (Figma axes the component already has) and ' +
    'unmatchedProps (axes it lacks → component-extension TODOs). ' +
    'Returns { mappings (candidate + confidence + status high/medium/low/unmapped), unmapped, profile }.',
  inputShape,
  kind: 'local',
};
export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

const readOverrides = async (rootDir: string): Promise<ReturnType<typeof parseMapFile>> => {
  try {
    return parseMapFile(await readFile(join(rootDir, MAP_FILE), 'utf8'));
  } catch {
    return new Map();
  }
};

/**
 * Orchestrate the join: pull the grounded Figma tree (reusing get_design_context — no dedicated
 * plugin handler), scan the local project, read any explicit map file, and join. Filesystem +
 * dispatch live here; the matching itself is pure (join/component-map.ts).
 */
export const handleComponentMap = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
): Promise<ComponentMapResult> => {
  const args = z.object(inputShape).parse(rawArgs);
  const rootDir = args.rootDir ?? process.cwd();
  const threshold = args.threshold ?? DEFAULT_THRESHOLD;

  const contextArgs: Record<string, unknown> = { detail: 'full', dedupeComponents: true };
  if (args.nodeId !== undefined) contextArgs.nodeId = args.nodeId;

  // No doc-wide get_local_components here: get_design_context now carries each variant instance's
  // owning COMPONENT_SET (id + name) on its mainComponent, so collectFigmaComponents can group/name
  // by the set directly. The old scan called findAllWithCriteria over the whole document (68s+ /
  // 30s-timeout on large multi-page files) just to recover those set names.
  const [context, profile, overrides] = await Promise.all([
    dispatch(GET_DESIGN_CONTEXT_TOOL_NAME, contextArgs) as Promise<GetDesignContextResult>,
    analyzeProject(rootDir),
    readOverrides(rootDir),
  ]);

  const scanned = await scanComponents(rootDir, profile.componentExtensions);

  const usages = collectFigmaComponents(context.nodes);
  const mappings = joinComponents(usages, scanned, {
    threshold,
    ...(overrides.size > 0 ? { overrides } : {}),
  });
  const unmapped = mappings.filter(m => m.status === 'unmapped').map(m => m.figmaComponentName);

  return { mappings, unmapped, profile, scannedComponentCount: scanned.length };
};
