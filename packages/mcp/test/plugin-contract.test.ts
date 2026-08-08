import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MIN_PLUGIN_VERSION } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { ALL_TOOL_SPECS } from '../src/tools/registry.js';
import {
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
