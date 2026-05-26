import { describe, expect, it } from 'vitest';

import { createSandboxHandlers } from '../packages/plugin/src/handlers/registry.js';
import { TOOL_DEFINITIONS, WRITE_TOOL_NAMES } from '../packages/server/src/tools/registry.js';

// Cross-package guard: a tool is wired across ~6 places (server def + ListTools + WRITE set, plugin
// handler + idempotent wrap + batch inverse). Forgetting one fails silently at runtime. These tests
// lock the server's advertised tools and the plugin's handler map to each other, and assert every
// input schema property declares a type (the gap that let set_variable_value ship broken).

// Tools the server handles on its own and never dispatches to the plugin, so they have no sandbox
// handler. save_screenshots is composed server-side from get_screenshot + filesystem writes;
// analyze_project / scan_components / component_map read the local project filesystem (component_map
// also reuses get_design_context internally) and never touch the sandbox.
const SERVER_ONLY_TOOLS = new Set([
  'save_screenshots',
  'analyze_project',
  'scan_components',
  'component_map',
]);

const serverNames = TOOL_DEFINITIONS.map(d => d.name);
const dispatchedNames = serverNames.filter(n => !SERVER_ONLY_TOOLS.has(n));
// Factories only close over figmaCtx; building the map never touches Figma, so a stub is fine here.
const handlerKeys = Object.keys(createSandboxHandlers({} as never));

/** Recursively assert every property object (any depth) declares a `type`. */
const missingType = (schema: unknown, path: string, out: string[]): void => {
  const s = schema as { type?: unknown; properties?: Record<string, unknown>; items?: unknown };
  if (s.properties) {
    for (const [key, prop] of Object.entries(s.properties)) {
      const p = prop as { type?: unknown };
      if (p.type === undefined) out.push(`${path}.${key}`);
      missingType(prop, `${path}.${key}`, out);
    }
  }
  if (s.items) missingType(s.items, `${path}[]`, out);
};

describe('tool registry', () => {
  it('server-dispatched tools and plugin handlers are exactly in sync', () => {
    const onlyServer = dispatchedNames.filter(n => !handlerKeys.includes(n));
    const onlyPlugin = handlerKeys.filter(n => !serverNames.includes(n));
    expect({ onlyServer, onlyPlugin }).toEqual({ onlyServer: [], onlyPlugin: [] });
  });

  it('every server-only tool is still advertised (and stays a known exception)', () => {
    for (const name of SERVER_ONLY_TOOLS) expect(serverNames).toContain(name);
  });

  it('has no duplicate tool names', () => {
    expect(new Set(serverNames).size).toBe(serverNames.length);
    expect(new Set(handlerKeys).size).toBe(handlerKeys.length);
  });

  it('every write tool is advertised and has a handler', () => {
    const writes = [...WRITE_TOOL_NAMES];
    expect(writes.filter(n => !serverNames.includes(n))).toEqual([]);
    expect(writes.filter(n => !handlerKeys.includes(n))).toEqual([]);
  });

  it('every input schema property declares a type (no untyped polymorphic params)', () => {
    const offenders: string[] = [];
    for (const def of TOOL_DEFINITIONS) missingType(def.inputSchema, def.name, offenders);
    expect(offenders).toEqual([]);
  });
});
