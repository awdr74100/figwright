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
 * Every key the server puts into a payload bound for the plugin, read from the call sites.
 *
 * Three shapes reach a sandbox handler, and all three had to be covered before this proved
 * anything. Mutation found the first two while it was being written:
 *
 * - `{ ...args, extra: … }` — walked brace to brace, not matched to the first key after the spread. A
 *   second key added beside an existing one is the likeliest careless change, and a first-key-only
 *   regex reports the old key and calls the file clean.
 * - Object literals handed straight to `dispatch(TOOL, { … })` — several tools build the payload for
 *   another tool by hand, so a field added there never passes through `...args` at all.
 * - `someArgs.field = …` on a `Record` built up before dispatch (`contextArgs`, `pluginArgs`).
 *
 * Only top-level keys count in each case: a key nested inside a value belongs to that value's
 * shape, not to the argument list the plugin receives.
 */
const KEY_AT = /^([A-Za-z_$][\w$]*)\s*:/;
const IDENT = /^[\w$]*/;

/** Collect the top-level keys of the object literal that starts at `open`. */
const literalKeys = (source: string, open: number, out: Set<string>): void => {
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
  if (close === -1) return;

  let nested = 0;
  const body = source.slice(open + 1, close);
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '{' || char === '[' || char === '(') nested += 1;
    else if (char === '}' || char === ']' || char === ')') nested -= 1;
    else if (nested === 0 && /[A-Za-z_$]/.test(char ?? '')) {
      const key = KEY_AT.exec(body.slice(i));
      if (key?.[1] !== undefined) {
        out.add(key[1]);
        i += key[0].length - 1;
      } else {
        // Not a key — skip the rest of this identifier so its letters are not re-tested.
        i += (IDENT.exec(body.slice(i))?.[0].length ?? 1) - 1;
      }
    }
  }
};

export const scanInjectedArgs = (source: string): Set<string> => {
  const found = new Set<string>();

  // Spread form: find the literal enclosing the spread.
  for (const spread of source.matchAll(/\.\.\.args\s*,/g)) {
    const open = source.lastIndexOf('{', spread.index);
    if (open !== -1) literalKeys(source, open, found);
  }

  // Literal handed directly to a dispatch call.
  for (const call of source.matchAll(/\bdispatch\w*\s*\(\s*[^,()]+,\s*\{/g)) {
    literalKeys(source, call.index + call[0].length - 1, found);
  }

  // Fields assigned onto a payload object before it is dispatched.
  for (const assign of source.matchAll(/\b\w*[Aa]rgs\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) {
    if (assign[1] !== undefined) found.add(assign[1]);
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
