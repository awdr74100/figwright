// Pick the next version, then hand it to changelogen.
//
// changelogen infers the bump from Conventional Commits, but `bumpVersion()`
// demotes every bump while the version is still `0.x` — major becomes minor,
// minor becomes patch. So on 0.3.0 a `feat:` release lands on 0.3.1, and even
// `changelogen --release --minor` does, which is why the version used to be
// typed by hand as `-r 0.4.0`. Passing an explicit `-r` is the only way to
// override that before 1.0, so this script asks for it instead: it re-infers
// the bump from the same commits, keeps only the pre-1.0 rule worth keeping
// (breaking → minor, see below), and runs the same command that was in the
// `release` script before.
//
// It writes CHANGELOG.md, commits and tags locally, then offers to push. The
// push is what triggers .github/workflows/release.yml, so it is a separate
// prompt that defaults to no — see the comment above it.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { clearScreenDown, emitKeypressEvents, moveCursor } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';

import { determineSemverChange, getGitDiff, loadChangelogConfig, parseCommits } from 'changelogen';

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(repoRoot, 'packages', 'mcp');

function fail(message) {
  console.error(styleText('red', `✖ ${message}`));
  process.exit(1);
}

/**
 * Walking away from a release is a decision, not a failure — so it says so quietly and exits 130,
 * the conventional code for "ended by SIGINT", rather than looking like something went wrong.
 *
 * Every prompt routes here. `readline/promises` rejects `question()` with an `AbortError` on
 * Ctrl+C, which unhandled prints a stack trace at someone who only meant to back out.
 */
function abort() {
  process.stdout.write('\n');
  console.error(styleText('dim', '  release aborted'));
  process.exit(130);
}

function git(...args) {
  const { status, stdout } = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (status !== 0) fail(`git ${args.join(' ')} failed`);
  return stdout.trim();
}

// Mirrors semver.inc(): on a prerelease, the bump it is already heading for
// just drops the tag (1.0.0-beta.1 → major → 1.0.0, not 2.0.0).
function bump(version, type) {
  const [core, pre] = version.split('-');
  const [major, minor, patch] = core.split('.').map(Number);
  if (type === 'major') return pre && minor === 0 && patch === 0 ? core : `${major + 1}.0.0`;
  if (type === 'minor') return pre && patch === 0 ? core : `${major}.${minor + 1}.0`;
  return pre ? core : `${major}.${minor}.${patch + 1}`;
}

async function selectFromMenu(items, initial) {
  // Releasing is deliberately hands-on: there is no flag that picks the version
  // for you, so without a terminal there is nothing to fall back to.
  if (!process.stdin.isTTY) fail('`pnpm release` needs an interactive terminal');

  let index = initial;
  const draw = redraw => {
    if (redraw) moveCursor(process.stdout, 0, -items.length);
    clearScreenDown(process.stdout);
    for (const [i, item] of items.entries()) {
      const active = i === index;
      const line = `${active ? '❯' : ' '} ${item.label}`;
      process.stdout.write(`${active ? styleText('cyan', line) : line}\n`);
    }
  };

  draw(false);

  return new Promise(resolve => {
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const done = () => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(items[index]);
    };

    const onKey = (str, key) => {
      if (key.name === 'return') return done();
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        process.stdin.setRawMode(false);
        abort();
      } else if (key.name === 'up' || key.name === 'k') {
        index = (index - 1 + items.length) % items.length;
      } else if (key.name === 'down' || key.name === 'j') {
        index = (index + 1) % items.length;
      } else if (/^[1-9]$/.test(str ?? '') && Number(str) <= items.length) {
        index = Number(str) - 1;
        draw(true);
        return done();
      } else {
        return;
      }
      draw(true);
    };

    process.stdin.on('keypress', onKey);
  });
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    // Ctrl+D closes the stream and resolves with nothing. Backing out that way means the same as
    // Ctrl+C, and an empty string here would otherwise be read as a version or as "not yes".
    if (answer === undefined) abort();
    return answer.trim();
  } catch (err) {
    // Ctrl+C. `readline/promises` rejects the question rather than emitting SIGINT, so this is the
    // only place it can be caught — unhandled it prints a stack trace at someone who only meant to
    // back out. Matched on `code`, the documented identifier, with `name` as the fallback.
    const aborted =
      err instanceof Error &&
      (('code' in err && err.code === 'ABORT_ERR') || err.name === 'AbortError');
    if (aborted) abort();
    throw err;
  } finally {
    rl.close();
  }
}

const current = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
if (!SEMVER_RE.test(current))
  fail(`packages/mcp/package.json holds an unparseable version: ${current}`);

// changelogen only stages CHANGELOG.md and package.json, so a dirty tree would
// leave the tag pointing at a commit that misses whatever else is in flight.
const dirty = git('status', '--porcelain');
if (dirty) fail(`working tree is not clean:\n${dirty}`);

// The same commit set changelogen itself would changelog, so the suggestion
// below matches the release you are about to cut.
const config = await loadChangelogConfig(pkgDir, {});
const commits = [];
for (const commit of parseCommits(await getGitDiff(config.from, config.to, config.cwd), config)) {
  const type = commit.type.toLowerCase();
  if (!config.types[type]) continue;
  if (type === 'chore' && commit.scope === 'deps' && !commit.isBreaking) continue;
  commits.push({ ...commit, type });
}
const inferred = determineSemverChange(commits, config) ?? 'patch';

// Pre-1.0 convention: a breaking change bumps the minor, because 0.x makes no
// stability promise to break. changelogen goes one step further and demotes
// minor → patch as well, which is the part worth overriding — it buries a
// release full of features in a patch bump. Only 1.0.0 should be deliberate,
// and it stays one keystroke away in the menu.
const heldBelowOne = current.startsWith('0.') && inferred === 'major';
const suggested = heldBelowOne ? 'minor' : inferred;

const counts = new Map();
for (const commit of commits) counts.set(commit.type, (counts.get(commit.type) ?? 0) + 1);
const summary = [...counts]
  .toSorted(([, a], [, b]) => b - a)
  .map(([type, count]) => `${count} ${type}`)
  .join(', ');

console.log();
console.log(`  current version  ${styleText('bold', `v${current}`)}`);
console.log(
  `  commits          ${styleText(
    'dim',
    `${summary || 'none releasable'} since ${config.from || 'the first commit'}`,
  )}`,
);
console.log(
  `  suggested        ${suggested}${
    heldBelowOne ? styleText('dim', ' — breaking change, held below 1.0.0') : ''
  }`,
);
console.log();

const choices = [
  ...['patch', 'minor', 'major'].map(type => ({
    type,
    version: bump(current, type),
    label: `${type.padEnd(7)} ${bump(current, type).padEnd(10)}${
      type === suggested ? styleText('dim', '(suggested)') : ''
    }`,
  })),
  { type: 'custom', label: `${'custom'.padEnd(7)} …` },
];

const choice = await selectFromMenu(
  choices,
  choices.findIndex(c => c.type === suggested),
);
const version = choice.version ?? (await ask('  version: '));

if (!SEMVER_RE.test(version)) fail(`not a valid version: ${version}`);
if (version === current) fail(`already on ${current}`);
const tag = `v${version}`;
if (git('tag', '--list', tag)) fail(`tag ${tag} already exists`);

// Same command this script replaced; --no-github because the GitHub Release is
// created by .github/workflows/release.yml once the tag is pushed.
const args = [
  '-C',
  'packages/mcp',
  'exec',
  'changelogen',
  '--release',
  '-r',
  version,
  '--no-github',
  '--output',
  '../../CHANGELOG.md',
];

console.log();
console.log(`  ${styleText('dim', `pnpm ${args.join(' ')}`)}`);
console.log(`  commits and tags ${styleText('bold', tag)} locally — nothing is published yet.`);
console.log();

const confirmed = await ask(`  Continue? ${styleText('dim', '(y/N)')} `);
if (!/^y(es)?$/i.test(confirmed)) abort();

const { status } = spawnSync('pnpm', args, { cwd: repoRoot, stdio: 'inherit' });
if (status !== 0) process.exit(status ?? 1);

// The push is the irreversible half: the tag landing on GitHub starts
// release.yml, which publishes to npm — and npm forbids reusing a version even
// after an unpublish. So it gets its own prompt, defaulting to no, and the tag
// sits locally (deletable, retaggable) until that prompt is answered.
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');

console.log();
console.log(
  `  ${styleText('green', '✔')} ${styleText('bold', tag)} is committed and tagged locally.`,
);
console.log(
  `  Pushing ${branch} + ${tag} starts the release workflow: ${styleText(
    'bold',
    'it publishes @figwright/mcp to npm',
  )}.`,
);
console.log();

const pushConfirmed = await ask(`  Push now? ${styleText('dim', '(y/N)')} `);
if (!/^y(es)?$/i.test(pushConfirmed)) {
  console.log();
  console.log(`  Not pushed. When you are ready:  ${styleText('bold', 'git push --follow-tags')}`);
  console.log(
    `  ${styleText('dim', `To undo instead:  git tag -d ${tag} && git reset --hard HEAD~1`)}`,
  );
  console.log();
  process.exit(0);
}

// stdio: 'inherit' so git can prompt for the SSH key passphrase on your tty.
const push = spawnSync('git', ['push', '--follow-tags'], { cwd: repoRoot, stdio: 'inherit' });
if (push.status !== 0) {
  fail(`git push failed — ${tag} is still local. Retry with \`git push --follow-tags\`.`);
}

console.log();
console.log(`  ${styleText('green', '✔')} pushed. release.yml is building ${tag}:`);
console.log(`    ${styleText('bold', 'https://github.com/awdr74100/figwright/actions')}`);
console.log();
