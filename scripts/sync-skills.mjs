// Mirror the canonical skills from `skills/` into `.claude/skills/` so the
// local Claude Code session loads them while developing this repo.
//
// `skills/` is the single source of truth (committed; also what skills.sh
// distributes via `npx skills add awdr74100/figwright`). The `.claude/skills/`
// copies are generated and gitignored — edit the originals in `skills/`, never
// the copies here. Runs from the root `postinstall`, so `pnpm install` keeps
// them in sync. We copy (not symlink) on purpose: symlinks don't survive a
// Windows clone without `core.symlinks` + privilege, and this is open source.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(repoRoot, "skills");
const destRoot = join(repoRoot, ".claude", "skills");

if (!existsSync(srcRoot)) {
  console.warn(`[sync-skills] skipped: ${srcRoot} not found`);
  process.exit(0);
}

// A skill is any directory under skills/ that holds a SKILL.md.
const skills = readdirSync(srcRoot).filter((name) => {
  const dir = join(srcRoot, name);
  return statSync(dir).isDirectory() && existsSync(join(dir, "SKILL.md"));
});

mkdirSync(destRoot, { recursive: true });

for (const name of skills) {
  const dest = join(destRoot, name);
  // Clear any stale copy or leftover symlink before writing a fresh copy.
  rmSync(dest, { recursive: true, force: true });
  cpSync(join(srcRoot, name), dest, { recursive: true });
}

console.log(`[sync-skills] synced ${skills.length} skill(s): ${skills.join(", ")}`);
