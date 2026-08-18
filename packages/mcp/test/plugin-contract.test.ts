import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MIN_PLUGIN_VERSION } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { ALL_TOOL_SPECS } from '../src/tools/registry.js';
import {
  collect,
  derivePluginContract,
  diffContracts,
  type PluginToolContract,
  scanInjectedArgs,
} from './plugin-contract.js';

// The gate that keeps MIN_PLUGIN_VERSION from going the way of PROTOCOL_VERSION, which sat at its
// initial value through every release because no gate ever asked about it. Nothing here can decide
// whether a change is backward-compatible — only a human knows that — so this does the one thing a
// gate can: it makes the argument surface a plugin has to keep up with impossible to change
// silently, and states, per change, which class it falls into.
//
// Recorded alongside the floor it belongs to, so "the tools changed but the floor didn't" is a
// visible fact in the diff rather than something a reviewer has to reconstruct.

const CONTRACT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'plugin-contract.json');

interface RecordedContract {
  minPluginVersion: string;
  tools: PluginToolContract;
}

const write = (contract: RecordedContract): void => {
  writeFileSync(CONTRACT_PATH, `${JSON.stringify(contract, null, 2)}\n`);
};

const derived = derivePluginContract();

// Re-record only when asked. Done here rather than inside a test so the assertions below stay
// unconditional — the report is what gets asserted, not the control flow around it.
//
// Deliberately NOT "write it if it is missing": a gate that regenerates its own baseline passes
// while proving nothing, which is how a deleted or badly-merged file would turn every subsequent
// argument change invisible. Missing is a failure, and says how to fix it.
if (process.env.UPDATE_PLUGIN_CONTRACT === '1') {
  write({ minPluginVersion: MIN_PLUGIN_VERSION, tools: derived });
}
if (!existsSync(CONTRACT_PATH)) {
  throw new Error(
    `${CONTRACT_PATH} is missing — it is committed, so this is a deleted or unmerged file, not a ` +
      'first run. Restore it from git; regenerate only if you know the recorded surface is wrong: ' +
      'UPDATE_PLUGIN_CONTRACT=1 pnpm test plugin-contract && pnpm format',
  );
}

const recorded = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as RecordedContract;

/** The drift report a developer has to act on, or '' when the surface is unchanged. */
const driftReport = (): string => {
  const drift = diffContracts(recorded.tools, derived);
  if (
    drift.addedTools.length === 0 &&
    drift.removedTools.length === 0 &&
    drift.addedArgs.length === 0 &&
    drift.removedArgs.length === 0
  ) {
    return '';
  }

  const lines = [
    'The plugin-facing argument surface changed. Decide what it means, then re-record:',
    '',
  ];

  if (drift.addedArgs.length > 0) {
    lines.push(
      `  SILENT on older plugins — ${drift.addedArgs.length} new argument(s) on existing tools:`,
      ...drift.addedArgs.map(a => `    + ${a}`),
      '    A handler that predates these drops them and still answers { ok: true }.',
      `    Raise MIN_PLUGIN_VERSION (now ${MIN_PLUGIN_VERSION}) to the version that ships them.`,
      '',
    );
  }
  if (drift.removedArgs.length > 0 || drift.removedTools.length > 0) {
    lines.push(
      '  REMOVED — a plugin still sending/expecting these is now wrong:',
      ...drift.removedArgs.map(a => `    - ${a}`),
      ...drift.removedTools.map(t => `    - ${t} (whole tool)`),
      '    Raise MIN_PLUGIN_VERSION.',
      '',
    );
  }
  if (drift.addedTools.length > 0) {
    lines.push(
      '  LOUD on older plugins — new tools:',
      ...drift.addedTools.map(t => `    + ${t}`),
      '    An older plugin answers METHOD_NOT_FOUND, which is visible rather than silent, so this',
      '    class alone does not require raising the floor.',
      '',
    );
  }

  lines.push(
    `  Recorded floor: ${recorded.minPluginVersion}   Current floor: ${MIN_PLUGIN_VERSION}`,
    '  Re-record with: UPDATE_PLUGIN_CONTRACT=1 pnpm test plugin-contract && pnpm format',
  );
  return lines.join('\n');
};

describe('plugin argument contract', () => {
  it('matches the recorded contract', () => {
    expect(driftReport()).toBe('');
  });

  it('was recorded against the floor in force', () => {
    // Catches a re-record that kept a stale floor, and a floor raised without re-recording.
    expect(recorded.minPluginVersion).toBe(MIN_PLUGIN_VERSION);
  });

  it('covers every tool that reaches the plugin, and nothing that does not', () => {
    // Guards the derivation itself: were `kind` filtering to silently return nothing, the test above
    // would pass forever against an empty contract.
    expect(Object.keys(derived).length).toBeGreaterThan(100);
    expect(derived).not.toHaveProperty('analyze_project');
    expect(derived.set_layout_props).toContain('layoutSizingHorizontal');
    expect(derived.get_screenshot).toContain('forVision');
  });

  it('makes every local tool state whether it has a sandbox handler of its own', () => {
    // The hole this closes: `kind === 'local'` used to mean "skip", so export_pdf / export_video /
    // save_image_fills sent arguments to their own sandbox handlers that nothing here recorded. A
    // new local tool must not be able to opt out of that by saying nothing, so an absent
    // declaration is a failure — `null` is how a tool says it reuses another tool's handler.
    const undeclared = ALL_TOOL_SPECS.filter(
      spec => spec.kind === 'local' && spec.serverOnlyArgs === undefined,
    ).map(spec => spec.name);
    expect(undeclared).toEqual([]);

    // Pins both halves of the split so neither side can quietly empty out.
    const owns = ALL_TOOL_SPECS.filter(
      spec =>
        spec.kind === 'local' && spec.serverOnlyArgs !== undefined && spec.serverOnlyArgs !== null,
    ).map(spec => spec.name);
    expect(owns.toSorted()).toEqual(['export_pdf', 'export_video', 'save_image_fills']);
    for (const name of owns) expect(derived).toHaveProperty(name);
    // save_screenshots dispatches get_screenshot, so its arguments live under that entry, not here.
    expect(derived).not.toHaveProperty('save_screenshots');
  });

  it('only excludes arguments the tool actually has', () => {
    // A stale or misspelled exclusion silently widens the hole it was meant to describe: the field
    // it names is gone or never existed, and the real server-only field flows into the contract
    // unnoticed. Checked against the schema rather than trusted.
    for (const spec of ALL_TOOL_SPECS) {
      const serverOnly = spec.serverOnlyArgs;
      if (serverOnly === undefined || serverOnly === null) continue;
      const own = new Set<string>();
      collect(spec.inputSchema, '', own);
      for (const arg of serverOnly) {
        expect({ tool: spec.name, arg, inSchema: own.has(arg) }).toEqual({
          tool: spec.name,
          arg,
          inSchema: true,
        });
      }
    }
  });

  it('records every argument a handler-owning local tool is seen to dispatch', () => {
    // The recorded entry is derived from the schema, which is one step removed from what the
    // handler actually sends. This reads the send site back: every argument the scan finds in the
    // tool's own file has to appear in that tool's entry, so a renamed or hand-added field cannot
    // sit in the code while the contract describes something else. A lower bound by nature — the
    // scan cannot see through a spread of a variable — but it is read from the real call site.
    const toolsRoot = join(dirname(fileURLToPath(import.meta.url)), '../src/tools');
    for (const spec of ALL_TOOL_SPECS) {
      if (
        spec.kind !== 'local' ||
        spec.serverOnlyArgs === undefined ||
        spec.serverOnlyArgs === null
      )
        continue;
      const file = join(toolsRoot, `${spec.name.replaceAll('_', '-')}.ts`);
      const seen = [...scanInjectedArgs(readFileSync(file, 'utf8'))].toSorted();
      const recordedArgs = new Set(derived[spec.name] ?? []);
      expect({ tool: spec.name, missing: seen.filter(arg => !recordedArgs.has(arg)) }).toEqual({
        tool: spec.name,
        missing: [],
      });
      // Vacuous if the scan found nothing — every one of these hand-builds a payload.
      expect(seen.length).toBeGreaterThan(0);
    }
  });

  it('descends into nested and array arguments', () => {
    // `batch` is the reason this matters: its per-op fields arrived nested, and a v0.3.0 plugin
    // drops them exactly as silently as a top-level argument.
    const batch = derived.batch ?? [];
    expect(batch.some(path => path.includes('[]'))).toBe(true);
  });

  it('has a declaration for every argument the server injects into a dispatch', () => {
    // The contract above can only record injected arguments that a spec declares. This is what
    // notices a *new* injection: it reads the dispatch sites themselves, so adding
    // `{ ...args, somethingNew: true }` without declaring it fails here rather than shipping as an
    // argument nothing in this repo knows a plugin has to understand.
    //
    // Whole `src` tree, not just index.ts: `budget` is injected from tools/design-context-guard.ts,
    // and a scan pointed at one file reports the sites it can see and calls that complete.
    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '../src');
    const injected = new Set<string>();
    for (const entry of readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })) {
      if (!entry.endsWith('.ts')) continue;
      for (const arg of scanInjectedArgs(readFileSync(join(srcRoot, entry), 'utf8'))) {
        injected.add(arg);
      }
    }

    // Guard the scan against passing vacuously: naming the known injections pins both that it found
    // the sites and that it reads whole literals. Mutation found both failure modes — a
    // first-key-only regex missed an argument added beside `forVision`, and an index.ts-only scan
    // never saw `budget` at all.
    expect(injected).toContain('forVision');
    expect(injected).toContain('budget');
    expect(injected).toContain('requestId');

    const declared = new Set(ALL_TOOL_SPECS.flatMap(spec => spec.injectedArgs ?? []));
    // requestId is derived from `kind === 'write'` at the dispatch site, not declared per spec.
    declared.add('requestId');
    // A key that is already some tool's own argument is a default being materialised before
    // dispatch (`detail`, `dedupeComponents`), not a new argument the plugin has to learn. This is
    // the deliberate limit of the scan: it catches invented names, not a known name reused.
    for (const paths of Object.values(derived)) {
      for (const path of paths) declared.add(path.split('.')[0] ?? path);
    }

    expect([...injected].filter(arg => !declared.has(arg))).toEqual([]);
  });
});
