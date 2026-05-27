import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  DesignContextNode,
  GetDesignContextResult,
  GetLocalComponentsResult,
} from '@figma-mcp-relay/shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

import {
  collectFigmaComponents,
  type ComponentMapping,
  type ComponentSetIndex,
  joinComponents,
  parseMapFile,
} from '../join/component-map.js';
import { analyzeProject, type ProjectProfile } from '../profile/profile.js';
import { scanComponents } from '../scan/scan.js';
import { GET_DESIGN_CONTEXT_TOOL_NAME } from './get-design-context.js';
import { GET_LOCAL_COMPONENTS_TOOL_NAME } from './get-local-components.js';

export const COMPONENT_MAP_TOOL_NAME = 'component_map';

const DEFAULT_THRESHOLD = 0.7;
const MAP_FILE = 'docs/figma-component-map.md';

export const ComponentMapInputSchema = v.object({
  nodeId: v.optional(v.string()),
  threshold: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
  rootDir: v.optional(v.string()),
});
export type ComponentMapInput = v.InferOutput<typeof ComponentMapInputSchema>;

export interface ComponentMapResult {
  mappings: ComponentMapping[];
  /** Distinct Figma component names with no code candidate ≥ 0.5 — the "to build" list. */
  unmapped: string[];
  profile: ProjectProfile;
  scannedComponentCount: number;
}

export const componentMapToolDefinition: Tool = {
  name: COMPONENT_MAP_TOOL_NAME,
  description:
    'Map the Figma component instances in a selection/subtree to existing local code components, so ' +
    'they can be reused instead of regenerated. Joins the grounded Figma component names (and their ' +
    'variant axes) against an AST scan of the project; an explicit docs/figma-component-map.md row ' +
    'overrides the fuzzy match. Each distinct component is mapped once with all its instance ids. ' +
    'Returns { mappings (candidate + confidence + status high/medium/low/unmapped), unmapped, profile }.',
  inputSchema: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'Root node id; omit to use the selection or current page',
      },
      threshold: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Confidence at/above which a match counts as a reliable reuse (default 0.7)',
      },
      rootDir: { type: 'string', description: 'Project root to scan; defaults to the server cwd' },
    },
    additionalProperties: false,
  },
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
  const args = v.parse(ComponentMapInputSchema, rawArgs);
  const rootDir = args.rootDir ?? process.cwd();
  const threshold = args.threshold ?? DEFAULT_THRESHOLD;

  const contextArgs: Record<string, unknown> = { detail: 'full', dedupeComponents: true };
  if (args.nodeId !== undefined) contextArgs.nodeId = args.nodeId;

  const [context, profile, overrides, localComponents] = await Promise.all([
    dispatch(GET_DESIGN_CONTEXT_TOOL_NAME, contextArgs) as Promise<GetDesignContextResult>,
    analyzeProject(rootDir),
    readOverrides(rootDir),
    dispatch(GET_LOCAL_COMPONENTS_TOOL_NAME, {}) as Promise<GetLocalComponentsResult>,
  ]);

  const scanned = await scanComponents(rootDir, profile.componentExtensions);

  // Map every variant component id to its set, so collectFigmaComponents can group instances by the
  // set (and name them "btn/Default", not "Size=Medium, …"). Library/external instances aren't local,
  // so they fall back to the main/node name inside collectFigmaComponents.
  const setIndex: ComponentSetIndex = new Map(
    localComponents.componentSets.flatMap(set =>
      set.componentIds.map(id => [id, { id: set.id, name: set.name }] as const),
    ),
  );

  const usages = context.nodes.flatMap((n: DesignContextNode) =>
    collectFigmaComponents(n, setIndex),
  );
  const mappings = joinComponents(usages, scanned, {
    threshold,
    ...(overrides.size > 0 ? { overrides } : {}),
  });
  const unmapped = mappings.filter(m => m.status === 'unmapped').map(m => m.figmaComponentName);

  return { mappings, unmapped, profile, scannedComponentCount: scanned.length };
};
