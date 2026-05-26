import { glob, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

// Project Profile — the structured "how this project writes code" that the join tools (component_map,
// token_map) switch their target side on. Detection is split in two: gatherProjectInput does the IO
// (reads manifests / probes for config files / scans CSS entry points) and detectProfile is a pure
// function over that snapshot, so the decision logic is snapshot-testable without a real filesystem.
// This first cut covers the JS/TS ecosystem; the framework/styling detectors are an ordered cascade so
// a PHP (composer.json) or .NET (*.csproj) detector is just another entry appended later.

export const FRAMEWORKS = ['next', 'nuxt', 'react', 'vue', 'svelte', 'unknown'] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export const STYLING_SYSTEMS = [
  'tailwind',
  'css-variables',
  'scss',
  'css-modules',
  'plain-css',
  'unknown',
] as const;
export type StylingSystem = (typeof STYLING_SYSTEMS)[number];

export interface ProjectProfile {
  rootDir: string;
  framework: Framework;
  /** Ts when a tsconfig or the typescript dep is present, else js. */
  language: 'ts' | 'js';
  styling: {
    system: StylingSystem;
    /**
     * Where the styling tokens live, when found: a tailwind.config.* for Tailwind v3, or the CSS
     * file holding `@import "tailwindcss"` / `@theme` for v4 (which has no JS config). token_map
     * reads its token definitions from here, so the path must point at the right source per
     * version.
     */
    configPath?: string;
    /** Tailwind major version (3 or 4) — v4 is CSS-first, changing where tokens are defined. */
    tailwindVersion?: number;
  };
  /** File extensions that hold components for this framework — drives the scanner's glob. */
  componentExtensions: string[];
  /** Human-readable reasons for each conclusion; surfaced so a wrong guess is debuggable. */
  evidence: string[];
}

/** Snapshot of the on-disk signals detection reasons about. Produced by gatherProjectInput. */
export interface ProjectInput {
  rootDir: string;
  packageJson: PackageJson | null;
  hasTsconfig: boolean;
  /** Root-level config basenames that were found to exist (tailwind.config.*, etc.). */
  presentConfigFiles: string[];
  /**
   * Repo-relative path to a CSS file that imports Tailwind / defines an @theme block (Tailwind v4
   * CSS-first config). Undefined when no such marker was found.
   */
  tailwindCssEntry?: string;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const TAILWIND_CONFIGS = [
  'tailwind.config.js',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
  'tailwind.config.ts',
];

/** Config files worth probing for at the project root; presence feeds styling detection. */
const PROBE_CONFIG_FILES = [...TAILWIND_CONFIGS];

/** Directories never worth walking when scanning for CSS entry points. */
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.git',
  'coverage',
]);

// Tailwind v4 marks its CSS-first config inline: `@import "tailwindcss"` pulls the framework in and
// `@theme { ... }` declares tokens. Either marker identifies the v4 token source.
const CSS_TAILWIND_IMPORT = /@import\s+["']tailwindcss["']/;
const CSS_THEME_BLOCK = /@theme\b/;

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
};

const readJson = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
};

/**
 * Walk the repo's CSS files (skipping vendored/build dirs) looking for the Tailwind v4 markers.
 * Returns the first matching file's repo-relative path, or undefined. Bounded by the small number
 * of hand-authored CSS files a project has; the heavy directories are excluded up front.
 */
const findTailwindCssEntry = async (root: string): Promise<string | undefined> => {
  let scanned = 0;
  for await (const entry of glob('**/*.css', { cwd: root })) {
    const rel = typeof entry === 'string' ? entry : String(entry);
    if (rel.split('/').some(seg => IGNORED_DIRS.has(seg))) continue;
    if (scanned >= 200) break; // safety cap against pathological repos
    scanned += 1;
    let body: string;
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential scan, stops at first match
      body = await readFile(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    if (CSS_TAILWIND_IMPORT.test(body) || CSS_THEME_BLOCK.test(body)) return rel;
  }
  return undefined;
};

/** Do the filesystem IO once, up front, so detectProfile can stay pure. */
export const gatherProjectInput = async (rootDir: string): Promise<ProjectInput> => {
  const root = resolve(rootDir);
  const packageJson = await readJson<PackageJson>(join(root, 'package.json'));
  const hasTsconfig = await fileExists(join(root, 'tsconfig.json'));

  const presentConfigFiles: string[] = [];
  for (const name of PROBE_CONFIG_FILES) {
    // eslint-disable-next-line no-await-in-loop -- small fixed list, clarity over micro-parallelism
    if (await fileExists(join(root, name))) presentConfigFiles.push(name);
  }

  const tailwindCssEntry = await findTailwindCssEntry(root);

  return {
    rootDir: root,
    packageJson,
    hasTsconfig,
    presentConfigFiles,
    ...(tailwindCssEntry === undefined ? {} : { tailwindCssEntry }),
  };
};

const allDeps = (pkg: PackageJson | null): Record<string, string> => ({
  ...pkg?.dependencies,
  ...pkg?.devDependencies,
});

/** Parse the leading major version out of a semver range like "^4.0.0" or "~3.4.1". */
const parseMajor = (range: string | undefined): number | undefined => {
  if (range === undefined) return undefined;
  const m = /(\d+)/.exec(range);
  return m === null ? undefined : Number(m[1]);
};

const COMPONENT_EXTENSIONS: Record<Framework, string[]> = {
  next: ['.tsx', '.jsx'],
  react: ['.tsx', '.jsx'],
  nuxt: ['.vue'],
  vue: ['.vue'],
  svelte: ['.svelte'],
  unknown: ['.tsx', '.jsx', '.vue', '.svelte'],
};

/**
 * Ordered framework cascade — meta-frameworks before the libraries they wrap (Next before React,
 * Nuxt before Vue) so the most specific signal wins. Returns the matched framework + the evidence.
 */
const detectFramework = (
  deps: Record<string, string>,
): { framework: Framework; reason: string } => {
  if ('next' in deps) return { framework: 'next', reason: 'next in dependencies' };
  if ('nuxt' in deps) return { framework: 'nuxt', reason: 'nuxt in dependencies' };
  if ('react' in deps) return { framework: 'react', reason: 'react in dependencies' };
  if ('vue' in deps) return { framework: 'vue', reason: 'vue in dependencies' };
  if ('svelte' in deps) return { framework: 'svelte', reason: 'svelte in dependencies' };
  return { framework: 'unknown', reason: 'no known framework dependency' };
};

interface StylingResult {
  system: StylingSystem;
  configPath?: string;
  tailwindVersion?: number;
  reason: string;
}

/**
 * Styling cascade. Tailwind is checked across all of its signals — v3 JS config file, v4 CSS-first
 * import/theme markers, the tailwindcss dep, and the v4-only Vite/PostCSS packages — since missing
 * the v4 case would silently drop the system where the token join actually earns its keep. SCSS
 * next via deps; plain CSS / CSS custom properties need a CSS body scan to confirm and are left to
 * a later pass (grounding already serves that path without an adapter).
 */
const detectStyling = (deps: Record<string, string>, input: ProjectInput): StylingResult => {
  const depVersion = parseMajor(deps.tailwindcss);
  const hasV4Pkg = '@tailwindcss/vite' in deps || '@tailwindcss/postcss' in deps;
  const v3Config = input.presentConfigFiles.find(name => TAILWIND_CONFIGS.includes(name));

  // Tailwind v4: CSS-first config (no JS config file). Strongest when a CSS entry was found.
  if (input.tailwindCssEntry !== undefined && v3Config === undefined) {
    return {
      system: 'tailwind',
      configPath: input.tailwindCssEntry,
      tailwindVersion: depVersion ?? 4,
      reason: `Tailwind v4 CSS config: ${input.tailwindCssEntry}`,
    };
  }
  // Tailwind v3: JS/TS config file at the root.
  if (v3Config !== undefined) {
    return {
      system: 'tailwind',
      configPath: v3Config,
      tailwindVersion: depVersion ?? 3,
      reason: `found ${v3Config}`,
    };
  }
  // Dep-only signal (config not located): trust the version, default to v4 for the v4-only packages.
  if (depVersion !== undefined || hasV4Pkg) {
    return {
      system: 'tailwind',
      tailwindVersion: depVersion ?? 4,
      reason: hasV4Pkg ? '@tailwindcss/* package in dependencies' : 'tailwindcss in dependencies',
    };
  }
  if ('sass' in deps || 'node-sass' in deps)
    return { system: 'scss', reason: 'sass in dependencies' };
  return { system: 'unknown', reason: 'no styling signal in manifest' };
};

/** Pure decision function over the gathered snapshot — the unit under test. */
export const detectProfile = (input: ProjectInput): ProjectProfile => {
  const deps = allDeps(input.packageJson);
  const evidence: string[] = [];

  const { framework, reason: fwReason } = detectFramework(deps);
  evidence.push(`framework=${framework}: ${fwReason}`);

  const language: 'ts' | 'js' = input.hasTsconfig || 'typescript' in deps ? 'ts' : 'js';
  evidence.push(
    `language=${language}: ${input.hasTsconfig ? 'tsconfig.json present' : 'typescript' in deps ? 'typescript dep' : 'no ts signal'}`,
  );

  const styling = detectStyling(deps, input);
  evidence.push(
    `styling=${styling.system}${styling.tailwindVersion === undefined ? '' : ` v${styling.tailwindVersion}`}: ${styling.reason}`,
  );

  return {
    rootDir: input.rootDir,
    framework,
    language,
    styling: {
      system: styling.system,
      ...(styling.configPath === undefined ? {} : { configPath: styling.configPath }),
      ...(styling.tailwindVersion === undefined
        ? {}
        : { tailwindVersion: styling.tailwindVersion }),
    },
    componentExtensions: COMPONENT_EXTENSIONS[framework],
    evidence,
  };
};

/** Convenience: gather + detect in one call against a real directory. */
export const analyzeProject = async (rootDir: string): Promise<ProjectProfile> =>
  detectProfile(await gatherProjectInput(rootDir));

/** Repo-relative form of an absolute path, for stable display in tool output. */
export const toRepoRelative = (rootDir: string, absPath: string): string =>
  relative(rootDir, absPath) || '.';
