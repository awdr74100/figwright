import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { walkRepoFiles } from '../repo-walk.js';
import { declaresVocabularyPreset } from '../tokens/js-config.js';

// Project Profile — the structured "how this project writes code" that the join tools (component_map,
// token_map) switch their target side on. Detection is split in two: gatherProjectInput does the IO
// (reads manifests / probes for config files / scans CSS entry points) and detectProfile is a pure
// function over that snapshot, so the decision logic is snapshot-testable without a real filesystem.
// This first cut covers the JS/TS ecosystem; the framework/styling detectors are an ordered cascade so
// a PHP (composer.json) or .NET (*.csproj) detector is just another entry appended later.

export const FRAMEWORKS = [
  'next',
  'nuxt',
  'react',
  'vue',
  'svelte',
  'solid',
  'angular',
  'unknown',
] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export const STYLING_SYSTEMS = [
  'tailwind',
  'unocss',
  'css-variables',
  'scss',
  'css-modules',
  'plain-css',
  'unknown',
] as const;
export type StylingSystem = (typeof STYLING_SYSTEMS)[number];

/**
 * Whether the styling system generates utility classes from a Tailwind-compatible vocabulary, so a
 * token's utility base (`primary-500`) is the literal to emit rather than its `var()` reference,
 * and a Figma variable hitting a built-in scale is a usable utility rather than a gap.
 *
 * UnoCSS qualifies on both counts: its wind3 and wind4 presets were each confirmed, by generating
 * CSS from the installed package, to produce `p-4` / `leading-7` / `font-bold` / `rounded-lg` /
 * `text-sm` from the same built-in scales, and `bg-primary-500` from a theme colour.
 *
 * One predicate rather than a comparison at each site: the forward join and the design-context
 * value annotation both need it, and them disagreeing would mean the same token is written one way
 * in `token_map` and another inside the grounding payload.
 */
export const isUtilityFirst = (system: StylingSystem): boolean =>
  system === 'tailwind' || system === 'unocss';

// How the project consumes `import X from './icon.svg'`: `component` when a loader turns the svg into
// a renderable component (svgr / vite-svg-loader / …) so codegen can emit `<Icon/>`; `url` otherwise
// (the bundler default resolves svg to a URL string → `<img src>` or inline svg). Picking wrong
// produces an import that doesn't run, so the icon-export step grounds this off the project.
export const SVG_IMPORT_MODES = ['component', 'url'] as const;
export type SvgImportMode = (typeof SVG_IMPORT_MODES)[number];

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
  /**
   * How the project turns an imported .svg into something renderable — so codegen imports/uses
   * exported icons the way the build actually supports (a wrong guess ships an import that won't
   * run).
   */
  svg: {
    /** `component` (a loader is present → `<Icon/>`) or `url` (no loader → `<img src>` / inline). */
    mode: SvgImportMode;
    /** The detected loader/plugin enabling component mode (svgr / vite-svg-loader / …), if any. */
    loader?: string;
    /**
     * A ready import example for the detected loader — the form differs (`?react` vs `?component`
     * vs `{ ReactComponent }`), so codegen can copy this rather than guess the syntax.
     */
    importHint?: string;
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
  /**
   * Whether the UnoCSS config found at the root loads a preset that generates the Tailwind utility
   * vocabulary. Undefined when there is no such config, or when its `presets` could not be read —
   * both of which mean "assume it does", since that is what almost every UnoCSS project loads.
   *
   * The config's _presence_ is not the question. UnoCSS is routinely installed only for icons, and
   * such a project generates no `p-4`; calling it utility-first makes codegen emit classes that do
   * not exist there.
   */
  unoConfigDeclaresVocabulary?: boolean;
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

// UnoCSS reads either basename, in any of the JS/TS extensions. Both are listed by @unocss/config
// as the config it loads; a project uses one or the other, never both.
const UNOCSS_CONFIGS = ['uno.config', 'unocss.config'].flatMap(base =>
  ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map(ext => `${base}.${ext}`),
);

/** Config files worth probing for at the project root; presence feeds styling detection. */
const PROBE_CONFIG_FILES = [...TAILWIND_CONFIGS, ...UNOCSS_CONFIGS];

// Tailwind v4 marks its CSS-first config inline: `@import "tailwindcss"` pulls the framework in and
// `@theme { ... }` declares tokens. Either marker identifies the v4 token source.
const CSS_TAILWIND_IMPORT = /@import\s+["']tailwindcss["']/;
const CSS_THEME_BLOCK = /@theme\b/;

// stat, not readFile: this only asks whether the path is there, and the probe list below grew from
// 4 entries to 17 when UnoCSS's six extensions × two basenames were added. Reading each candidate's
// whole contents to answer a yes/no was affordable at 4 and is not on a path every grounding call
// runs through (token_map and the design-context annotation both profile the project).
const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const readText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
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
 * Walk the repo's CSS files looking for the Tailwind v4 markers; returns the first matching file's
 * repo-relative path, or undefined. Directory pruning + .gitignore handling live in walkRepoFiles.
 */
const findTailwindCssEntry = async (root: string): Promise<string | undefined> => {
  for await (const rel of walkRepoFiles(root, { extensions: ['.css'], cap: 1000 })) {
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

  // In parallel, and order-preserving via the index — detectStyling's cascade picks the first match
  // from this list, so the result must not depend on which stat resolved first.
  const probed = await Promise.all(PROBE_CONFIG_FILES.map(name => fileExists(join(root, name))));
  const presentConfigFiles = PROBE_CONFIG_FILES.filter((_, i) => probed[i] === true);

  const tailwindCssEntry = await findTailwindCssEntry(root);

  // One extra read, and only when such a config exists: what it loads decides whether the project
  // generates utility classes at all, which no filename or dependency can answer.
  const unoConfig = presentConfigFiles.find(name => UNOCSS_CONFIGS.includes(name));
  const unoBody = unoConfig === undefined ? null : await readText(join(root, unoConfig));
  const unoConfigDeclaresVocabulary =
    unoBody === null ? null : declaresVocabularyPreset(unoConfig as string, unoBody);

  return {
    rootDir: root,
    packageJson,
    hasTsconfig,
    presentConfigFiles,
    ...(tailwindCssEntry === undefined ? {} : { tailwindCssEntry }),
    ...(unoConfigDeclaresVocabulary === null ? {} : { unoConfigDeclaresVocabulary }),
  };
};

const allDeps = (pkg: PackageJson | null): Record<string, string> => ({
  ...pkg?.dependencies,
  ...pkg?.devDependencies,
});

/** All dependencies (prod + dev) declared in the project's package.json, or {} when absent. */
export const readProjectDeps = async (rootDir: string): Promise<Record<string, string>> =>
  allDeps(await readJson<PackageJson>(join(resolve(rootDir), 'package.json')));

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
  // Solid authors components as JSX in .tsx/.jsx, parsed by the same (react) extractor — only the
  // emitted conventions differ (`class` not `className`, `createSignal`), which the framework label
  // steers.
  solid: ['.tsx', '.jsx'],
  // Angular components are @Component-decorated classes in .ts (conventionally *.component.ts). The
  // scanner reads every .ts but only keeps classes carrying @Component, so a service/pipe/guard .ts
  // contributes nothing. .ts is Angular-exclusive here — no other framework globs it.
  angular: ['.ts'],
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
  // solid-js is the base dep of both plain Solid and SolidStart, so one check covers both.
  if ('solid-js' in deps) return { framework: 'solid', reason: 'solid-js in dependencies' };
  // @angular/core is the base dep of every Angular app (incl. AnalogJS / Angular Universal).
  if ('@angular/core' in deps)
    return { framework: 'angular', reason: '@angular/core in dependencies' };
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

  const unoConfig = input.presentConfigFiles.find(name => UNOCSS_CONFIGS.includes(name));

  // Order of evidence, strongest first: a config file named at the project root, then the
  // repo-wide CSS marker scan, then a dependency entry. The root config files go together and
  // ahead of the rest — `tailwindCssEntry` is whichever file *anywhere* in the repo still contains
  // `@import "tailwindcss"` or `@theme`, which in a half-migrated repo is residue, while a root
  // `uno.config.ts` is a deliberate, current statement of what builds the CSS. Getting this
  // backwards labelled such a repo Tailwind and left its real token source unread.

  // Tailwind v3: JS/TS config file at the root.
  if (v3Config !== undefined) {
    return {
      system: 'tailwind',
      configPath: v3Config,
      tailwindVersion: depVersion ?? 3,
      reason: `found ${v3Config}`,
    };
  }
  // …with one exception, which is what separates residue from a live setup. Tailwind v4 has no JS
  // config by design, so its only root-level evidence *is* the CSS marker — and a CSS marker backed
  // by an actual tailwindcss dependency is not leftovers. "UnoCSS for icons alongside Tailwind v4"
  // is a common layout, and letting the uno config win it read the wrong token source and then told
  // the caller "UnoCSS declares no CSS custom properties" about a project whose tokens are `@theme`
  // custom properties.
  // A *v4* dependency specifically. `depVersion !== undefined` also accepted `tailwindcss: ^3`,
  // which is the very signal the rest of this cascade treats as residue — a migrated repo keeps a
  // v3 dep alive for prettier-plugin-tailwindcss — so a leftover v3 dep plus any `@theme` match
  // anywhere in the CSS (the marker regex is unanchored, so a comment counts) beat a real uno config.
  const liveTailwindV4 =
    input.tailwindCssEntry !== undefined && ((depVersion ?? 0) >= 4 || hasV4Pkg);
  // A config that loads no vocabulary preset — UnoCSS installed purely for icons — is not a
  // utility-first project, and saying so would have codegen emit `p-4` where nothing generates it.
  // Undefined means the presets could not be read, which is not a "no": assume the usual setup.
  const unoGeneratesUtilities = input.unoConfigDeclaresVocabulary !== false;
  if (unoConfig !== undefined && !liveTailwindV4 && unoGeneratesUtilities)
    return { system: 'unocss', configPath: unoConfig, reason: `found ${unoConfig}` };

  // Tailwind v4: CSS-first config, which has no JS config file to find.
  if (input.tailwindCssEntry !== undefined) {
    return {
      system: 'tailwind',
      configPath: input.tailwindCssEntry,
      tailwindVersion: depVersion ?? 4,
      reason: `Tailwind v4 CSS config: ${input.tailwindCssEntry}`,
    };
  }

  // Dep-only signals (no config located): trust the version, default to v4 for the v4-only packages.
  if (depVersion !== undefined || hasV4Pkg) {
    return {
      system: 'tailwind',
      tailwindVersion: depVersion ?? 4,
      reason: hasV4Pkg ? '@tailwindcss/* package in dependencies' : 'tailwindcss in dependencies',
    };
  }
  // `unocss` is the umbrella package; `@unocss/*` covers a project that installs only the pieces it
  // uses (the Nuxt and Vite modules both do, and both default to a wind preset). Excluded are the
  // packages that carry no theme vocabulary and so generate no utility on their own: `reset` is a
  // bundle of stylesheets any project can import, and the presets below add rules — icons, fonts,
  // prose, attributify syntax — without a scale.
  //
  // The dependency list is the weaker half of this question, and on its own it answers the wrong
  // one: an icons-only project still installs the `unocss` umbrella and configures `presetIcons`
  // inside its config, so the denylist never fires. `unoGeneratesUtilities` is what actually
  // decides it — a config that was read and loads no vocabulary preset overrules any dependency,
  // because the config is the project's own statement of what it generates.
  const NON_VOCABULARY = new Set([
    '@unocss/reset',
    '@unocss/preset-icons',
    '@unocss/preset-web-fonts',
    '@unocss/preset-typography',
    '@unocss/preset-attributify',
    '@unocss/preset-tagify',
  ]);
  const unoDep = Object.keys(deps).find(
    d => d === 'unocss' || (d.startsWith('@unocss/') && !NON_VOCABULARY.has(d)),
  );
  if (unoDep !== undefined && unoGeneratesUtilities)
    return { system: 'unocss', reason: `${unoDep} in dependencies` };

  // `sass-embedded` is the compiler Vite documents alongside `sass`, and the common choice on a
  // modern Vite/Vue/Nuxt project — missing it meant the SCSS token source silently never ran on
  // exactly the projects it was built for. `node-sass` is the long-dead original, kept for repos
  // that still pin it.
  const sassDep = ['sass', 'sass-embedded', 'node-sass'].find(d => d in deps);
  if (sassDep !== undefined) return { system: 'scss', reason: `${sassDep} in dependencies` };
  return { system: 'unknown', reason: 'no styling signal in manifest' };
};

interface SvgResult {
  mode: SvgImportMode;
  loader?: string;
  importHint?: string;
  reason: string;
}

// Ordered by specificity; the import form is loader-specific (Vite's svgr uses `?react`, vite-svg-
// loader uses `?component`, classic @svgr/webpack exports `ReactComponent`), so each carries its own
// ready example. Dep presence is the signal — the loader still has to be wired in the bundler config,
// so the guidance reminds codegen to confirm, but a present dep is a strong intent signal.
const SVG_LOADERS: { dep: string; loader: string; hint: string }[] = [
  {
    dep: 'vite-plugin-svgr',
    loader: 'vite-plugin-svgr',
    hint: "import Icon from './icon.svg?react'",
  },
  {
    dep: 'vite-svg-loader',
    loader: 'vite-svg-loader',
    hint: "import Icon from './icon.svg?component'",
  },
  {
    dep: 'vite-plugin-solid-svg',
    loader: 'vite-plugin-solid-svg',
    hint: "import Icon from './icon.svg?component-solid'",
  },
  {
    dep: '@svgr/webpack',
    loader: '@svgr/webpack',
    hint: "import { ReactComponent as Icon } from './icon.svg'",
  },
  { dep: '@svgr/rollup', loader: '@svgr/rollup', hint: "import Icon from './icon.svg'" },
  {
    dep: 'unplugin-icons',
    loader: 'unplugin-icons',
    hint: "import Icon from '~icons/{collection}/{name}' (local svg via FileSystemIconLoader)",
  },
  {
    dep: 'nuxt-svgo',
    loader: 'nuxt-svgo',
    hint: "import Icon from './icon.svg?component' (or <NuxtIcon>)",
  },
  {
    dep: 'nuxt-svgo-loader',
    loader: 'nuxt-svgo-loader',
    hint: "import Icon from './icon.svg?component' (or a <SvgoIcon name> macro)",
  },
  { dep: '@nuxtjs/svg', loader: '@nuxtjs/svg', hint: "import Icon from './icon.svg?component'" },
];

/**
 * Detect how .svg imports resolve, from the dependency manifest. Component mode when a known svg
 * loader is present, else url mode (the bundler default). Pure over deps.
 */
const detectSvgHandling = (deps: Record<string, string>): SvgResult => {
  for (const sig of SVG_LOADERS) {
    if (sig.dep in deps) {
      return {
        mode: 'component',
        loader: sig.loader,
        importHint: sig.hint,
        reason: `${sig.dep} → svg imports as a component`,
      };
    }
  }
  return {
    mode: 'url',
    reason: 'no svg loader dep → svg imports resolve to a URL (use <img src> or inline svg)',
  };
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

  const svg = detectSvgHandling(deps);
  evidence.push(
    `svg=${svg.mode}${svg.loader === undefined ? '' : ` (${svg.loader})`}: ${svg.reason}`,
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
    svg: {
      mode: svg.mode,
      ...(svg.loader === undefined ? {} : { loader: svg.loader }),
      ...(svg.importHint === undefined ? {} : { importHint: svg.importHint }),
    },
    componentExtensions: COMPONENT_EXTENSIONS[framework],
    evidence,
  };
};

/** Convenience: gather + detect in one call against a real directory. */
export const analyzeProject = async (rootDir: string): Promise<ProjectProfile> =>
  detectProfile(await gatherProjectInput(rootDir));
