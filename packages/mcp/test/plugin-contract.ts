import { z } from 'zod';

import { ALL_TOOL_SPECS } from '../src/tools/registry.js';

/**
 * Derive the argument surface every plugin-dispatched tool sends over the relay.
 *
 * This is the contract a sandbox handler has to keep up with, and the one place skew hides: the
 * server validates arguments with Zod and the handler re-reads them positionally (`const p = params
 * as { nodeId?: unknown; … }`), so an argument an older handler predates is not rejected — it is
 * dropped, and the write still answers `{ ok: true }`. Recording the surface is what turns "someone
 * added a field" from an invisible event into a diff.
 *
 * Paths are dotted and descend through arrays and unions (`track.keyframes[].easing.type`), because
 * a nested addition drops just as silently as a top-level one. `local` tools are excluded: they
 * never reach the plugin.
 *
 * `batch.ops[].params` stops at `unknown` on purpose — it is the union of every other tool's
 * arguments, and each of those tools records its own entry here, so the arguments a batched op
 * carries are covered under the tool it batches rather than duplicated under `batch`.
 */
const collect = (schema: z.ZodType, prefix: string, out: Set<string>): void => {
  const def = schema.def as { type: string; [key: string]: unknown };

  switch (def.type) {
    case 'object': {
      for (const [key, child] of Object.entries((schema as z.ZodObject).shape)) {
        const path = prefix === '' ? key : `${prefix}.${key}`;
        out.add(path);
        collect(child as z.ZodType, path, out);
      }
      return;
    }
    case 'array': {
      collect(def.element as z.ZodType, `${prefix}[]`, out);
      return;
    }
    case 'union': {
      for (const option of def.options as z.ZodType[]) collect(option, prefix, out);
      return;
    }
    case 'record': {
      collect(def.valueType as z.ZodType, `${prefix}[key]`, out);
      return;
    }
    // Wrappers carry the same argument under a modifier; descend without consuming a path segment.
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'catch':
    case 'readonly':
    case 'nonoptional': {
      collect(def.innerType as z.ZodType, prefix, out);
      return;
    }
    case 'pipe': {
      collect(def.in as z.ZodType, prefix, out);
      return;
    }
    case 'lazy': {
      // Recursive schemas would not terminate; the tools that use one describe it inline elsewhere.
      return;
    }
    default:
      // A leaf (string / number / enum / literal / unknown …) — already recorded by its parent.
      return;
  }
};

export type PluginToolContract = Record<string, readonly string[]>;

export const derivePluginContract = (): PluginToolContract => {
  const contract: Record<string, readonly string[]> = {};
  for (const spec of ALL_TOOL_SPECS) {
    if (spec.kind === 'local') continue;
    const paths = new Set<string>();
    collect(spec.inputSchema, '', paths);
    // Server-added arguments reach the same handlers and drop just as silently, but appear in no
    // schema — `forVision` was the worst measured case and would have been invisible here.
    for (const arg of spec.injectedArgs ?? []) paths.add(arg);
    if (spec.kind === 'write') paths.add('requestId');
    contract[spec.name] = [...paths].toSorted();
  }
  return contract;
};

/**
 * Every key the server adds to a dispatch payload, read from the dispatch sites themselves.
 *
 * Walks the braces of each `{ ...args, … }` literal rather than matching the first key after the
 * spread: a second key added to an existing site is exactly the change most likely to be made
 * without thinking about the plugin, and a first-key-only scan reports the old key and calls it
 * clean. (Confirmed by mutation — the naive version passed while an undeclared argument was live.)
 */
export const scanInjectedArgs = (source: string): Set<string> => {
  const found = new Set<string>();

  for (const spread of source.matchAll(/\.\.\.args\s*,/g)) {
    const open = source.lastIndexOf('{', spread.index);
    if (open === -1) continue;

    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) continue;

    // Top level of this literal only: a key nested inside a value belongs to that value's shape,
    // not to the argument list the plugin receives.
    let nested = 0;
    const body = source.slice(open + 1, close);
    for (let i = 0; i < body.length; i += 1) {
      const char = body[i];
      if (char === '{' || char === '[' || char === '(') nested += 1;
      else if (char === '}' || char === ']' || char === ')') nested -= 1;
      else if (nested === 0 && /[A-Za-z_$]/.test(char ?? '')) {
        const key = /^([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(i));
        if (key?.[1] !== undefined) {
          found.add(key[1]);
          i += key[0].length - 1;
        } else {
          // Not a key — skip the rest of this identifier so its letters are not re-tested.
          i += (/^[\w$]*/.exec(body.slice(i))?.[0].length ?? 1) - 1;
        }
      }
    }
  }

  return found;
};

export interface ContractDrift {
  addedTools: string[];
  removedTools: string[];
  /** The dangerous class: an existing tool gained an argument older handlers cannot see. */
  addedArgs: string[];
  removedArgs: string[];
}

export const diffContracts = (
  recorded: PluginToolContract,
  derived: PluginToolContract,
): ContractDrift => {
  const drift: ContractDrift = {
    addedTools: [],
    removedTools: [],
    addedArgs: [],
    removedArgs: [],
  };

  for (const name of Object.keys(derived)) {
    if (!(name in recorded)) {
      drift.addedTools.push(name);
      continue;
    }
    const before = new Set(recorded[name]);
    const after = new Set(derived[name]);
    for (const arg of after) if (!before.has(arg)) drift.addedArgs.push(`${name}.${arg}`);
    for (const arg of before) if (!after.has(arg)) drift.removedArgs.push(`${name}.${arg}`);
  }
  for (const name of Object.keys(recorded)) {
    if (!(name in derived)) drift.removedTools.push(name);
  }

  return drift;
};
