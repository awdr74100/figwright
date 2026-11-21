// How `pnpm release` starts pnpm, and what it runs on the bumped version before it offers to push.
//
// release.yml builds and tests the tagged commit before it publishes, and a version bump can break
// a test that passed on every commit before it: v0.8.0's first release job failed because a test
// pinned a plugin to the version being released past, which only the bumped version could reveal.
// So the same two steps run locally first, while the tag is still local and undoing it costs
// nothing. Kept apart from release.mjs, which starts its interactive flow on import, so it can be
// tested.

import { spawnSync } from 'node:child_process';
import process from 'node:process';

/**
 * Run pnpm with `args` in `cwd`, its output on this terminal; resolves to spawnSync's result.
 *
 * `spawn('pnpm')` cannot start pnpm on Windows, where it is a .cmd shim that needs a shell. Run as
 * `pnpm release`, pnpm names itself in npm_execpath: a JS entry when it came from npm or corepack
 * (run on this Node.js), the native binary when installed standalone (run as is — pnpm.exe on
 * Windows). Without it (the script run with plain node), pnpm is looked up on PATH, through a shell
 * on Windows only; every argument here is one this script built, so nothing reaches that shell
 * unchecked.
 */
export const runPnpm = (args, cwd, env = process.env) => {
  const self = env.npm_execpath;
  const options = { cwd, stdio: 'inherit' };
  // Only when it is pnpm: `npm run release` names npm there, which must not be handed pnpm's args.
  if (self !== undefined && isPnpm(self)) {
    return /\.[cm]?js$/i.test(self)
      ? spawnSync(process.execPath, [self, ...args], options)
      : spawnSync(self, args, options);
  }
  return spawnSync('pnpm', args, { ...options, shell: process.platform === 'win32' });
};

/**
 * Judged by the file's own name — …/pnpm/bin/pnpm.cjs, …/node_modules/pnpm/pnpm, C:\…\pnpm.exe —
 * not by a folder on its path: npm installed under a pnpm directory is still npm-cli.js.
 */
const isPnpm = path => /^pnpm(\.exe|\.[cm]?js)?$/i.test(path.split(/[\\/]/).pop() ?? '');

/** Why a pnpm run failed — it could not start, or it exited non-zero — or null when it passed. */
export const pnpmFailure = (args, result) => {
  if (result.error) return `pnpm ${args.join(' ')} could not start: ${result.error.message}`;
  if (result.status !== 0) {
    return `pnpm ${args.join(' ')} failed (exit ${result.status ?? result.signal})`;
  }
  return null;
};

/** The steps release.yml runs that a version bump can break, in its order. */
export const RELEASE_CHECKS = [['build'], ['test']];

/**
 * Run each check in `cwd`, in order, and stop at the first that fails. `run` is injectable for
 * tests. Returns why the first failing check failed, or null when every check passed.
 */
export const runReleaseChecks = (cwd, run = runPnpm) => {
  for (const args of RELEASE_CHECKS) {
    const failure = pnpmFailure(args, run(args, cwd));
    if (failure !== null) return failure;
  }
  return null;
};
