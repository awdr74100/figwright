import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  pnpmFailure,
  RELEASE_CHECKS,
  runPnpm,
  runReleaseChecks,
} from '../scripts/release-checks.mjs';

const repoRoot = join(import.meta.dirname, '..');

type Run = (args: string[], cwd: string) => { status: number | null; error?: Error };

describe('the checks pnpm release runs before it offers to push', () => {
  it('runs the build, then the tests, in the repo, and passes when both do', () => {
    const run = vi.fn<Run>(() => ({ status: 0 }));
    expect(runReleaseChecks(repoRoot, run)).toBeNull();
    expect(run.mock.calls).toEqual([
      [['build'], repoRoot],
      [['test'], repoRoot],
    ]);
  });

  it('stops at a failing build, without running the tests', () => {
    const run = vi.fn<Run>(args => ({ status: args[0] === 'build' ? 1 : 0 }));
    expect(runReleaseChecks(repoRoot, run)).toBe('pnpm build failed (exit 1)');
    expect(run).toHaveBeenCalledOnce();
  });

  it('names a failing test run', () => {
    const run = vi.fn<Run>(args => ({ status: args[0] === 'test' ? 1 : 0 }));
    expect(runReleaseChecks(repoRoot, run)).toBe('pnpm test failed (exit 1)');
  });

  it('says when pnpm could not start at all, rather than report a bare exit code', () => {
    const run = vi.fn<Run>(() => ({ status: null, error: new Error('spawn pnpm ENOENT') }));
    expect(runReleaseChecks(repoRoot, run)).toBe('pnpm build could not start: spawn pnpm ENOENT');
  });

  // The point is to run what the release job runs, so it fails here when that would fail there.
  it('are exactly the build and test steps release.yml runs, in its order', () => {
    const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    const steps = [...workflow.matchAll(/^\s*- run: pnpm (build|test)\s*$/gm)].map(m => [m[1]]);
    expect(steps).toEqual(RELEASE_CHECKS);
  });

  it('reads a run that exited by a signal as failed, naming the signal', () => {
    expect(pnpmFailure(['test'], { status: null, signal: 'SIGINT' })).toBe(
      'pnpm test failed (exit SIGINT)',
    );
  });
});

// Started for real, so the CI's Windows runner proves pnpm starts there — spawn('pnpm') does not,
// pnpm being a .cmd shim that needs a shell. Under `pnpm test` npm_execpath names pnpm; without
// it, or naming npm, pnpm is found on PATH.
describe('starting pnpm on this platform', () => {
  it('starts pnpm the way pnpm release is run (npm_execpath naming pnpm)', () => {
    const result = runPnpm(['--version'], repoRoot);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });

  it('starts pnpm, not npm, when npm_execpath names npm (npm run release)', () => {
    const npm = join(repoRoot, 'no-such', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const result = runPnpm(['--version'], repoRoot, { npm_execpath: npm });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });

  it('starts pnpm from PATH when run with plain node', () => {
    const result = runPnpm(['--version'], repoRoot, { PATH: process.env.PATH ?? '' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });
});
