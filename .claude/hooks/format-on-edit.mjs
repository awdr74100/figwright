#!/usr/bin/env node
// PostToolUse hook (Edit|Write|MultiEdit): auto-format the edited file with oxfmt, then surface
// oxlint problems — but only when there are any, so clean edits stay silent. Reads Claude Code's
// hook JSON payload from stdin. Dependency-free on purpose (no jq): every contributor already has
// Node, not necessarily jq. Non-blocking by design — a formatter/linter hiccup must never fail the
// edit, so we always exit 0 and swallow our own errors. Scoped to files inside the project root so
// edits elsewhere (e.g. ~/.claude memory files) aren't run through this repo's oxfmt/oxlint config.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';

const FORMATTABLE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.vue', '.json', '.md']);

const main = () => {
  let file;
  try {
    file = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.file_path;
  } catch {
    return; // no / invalid stdin payload — nothing to format
  }
  if (typeof file !== 'string' || file.length === 0) return;
  if (!FORMATTABLE.has(extname(file))) return;

  // Only touch files within this project — never edits to ~/.claude memory, other repos, etc.
  const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const abs = resolve(root, file);
  const rel = relative(root, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return;

  // Format in place, quietly.
  spawnSync('npx', ['oxfmt', abs], { stdio: 'ignore' });

  // Lint: print only on a non-zero exit (a real finding), keeping successful edits noise-free.
  const lint = spawnSync('npx', ['oxlint', abs], { encoding: 'utf8' });
  if (lint.status !== 0) {
    process.stdout.write(`[oxlint] ${rel}\n${lint.stdout ?? ''}${lint.stderr ?? ''}`);
  }
};

try {
  main();
} catch {
  // never block an edit on a hook failure
}
