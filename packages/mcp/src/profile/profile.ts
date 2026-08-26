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

// How the project's own stylesheets spell a compound (BEM-style) class name: 'ampersand' assembles
// it from the parent (`.card { &__title {} }`), 'flat' declares it in full (`.card__title {}`).
// Both compile to the same selector, so this is a convention question, not a correctness one — and
// the reason codegen has to ground it rather than pick is that a generated stylesheet which spells
// names the other way than the rest of the repo is the kind of mismatch nobody notices until they
// try to grep for one.
export const CLASS_NAMING_STYLES = ['ampersand', 'flat'] as const;
export type ClassNamingStyle = (typeof CLASS_NAMING_STYLES)[number];

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
    /**
     * How the project's existing preprocessor stylesheets spell a compound (BEM-style) class —
     * `ampersand` (`.card { &__title {} }`) or `flat` (`.card__title {}`) — so a generated
     * stylesheet matches the repo instead of imposing a house style. Absent when the project has no
     * such stylesheet, or none of them declares a compound class at all (a Tailwind project, or one
     * that only uses single-word classes): with no habit to match, write `flat`, whose names
     * survive a search for the class the markup actually carries.
     */
    classNaming?: ClassNamingStyle;
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
  /**
   * Tally of how the project's own preprocessor stylesheets spell compound class names, summed over
   * every file the scan read. Undefined when the project has no such stylesheet to learn from —
   * which is not the same as a zeroed tally (stylesheets exist but declare no compound class), and
   * the two produce different evidence lines.
   */
  classNamingTally?: ClassNamingTally;
}

/** Compound-class-name spellings counted across a project's preprocessor stylesheets. */
export interface ClassNamingTally {
  /** Occurrences of `&` glued onto a name fragment (`&__title`, `&--primary`). */
  ampersand: number;
  /** Top-level selectors declaring a compound class in full (`.card__title`). */
  flat: number;
  /** Stylesheets (or SFC preprocessor `<style>` blocks) actually read. */
  filesScanned: number;
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

// Stylesheet languages whose `&` *concatenates* into a new selector token, so `.card { &__title {} }`
// compiles to `.card__title`. `.pcss`/`.postcss` are here because postcss-nested concatenates the
// same way; bare `.css` is deliberately excluded even though such a project can run through the same
// plugin. Native CSS nesting makes `&` an element reference rather than string concatenation, so
// `&__title` is not even valid there — and .css is common enough that counting it would bury a real
// preprocessor habit under votes from files that mostly never had the syntax to cast one. A
// postcss-nested project keeping `&__` in plain .css therefore reads as "no habit", which lands on
// the flat default: still valid CSS there, just not its convention.
const NESTING_STYLESHEET_EXTENSIONS = ['.scss', '.sass', '.less', '.styl', '.pcss', '.postcss'];

// Vue and Svelte projects routinely keep every stylesheet inside the component file, so a repo with
// a firm `&__` habit can own zero .scss files. Only a block declaring a preprocessor `lang` can
// concatenate — a bare <style> is CSS, excluded for the same reason as .css above.
const SFC_EXTENSIONS = ['.vue', '.svelte'];
const SFC_PREPROCESSOR_STYLE_BLOCK =
  /<style\b[^>]*\blang\s*=\s*["'](?:scss|sass|less|stylus|styl|postcss|pcss)["'][^>]*>([\s\S]*?)<\/style>/gi;

// `&` glued straight onto a name fragment: `&__title`, `&--primary`, `&-sm`. `&` carries no other
// meaning in a stylesheet, so once comments and strings are gone a textual match *is* the signal.
// The forms that do not build a name — `&:hover`, `&::before`, `&.is-open`, `&[open]`, `& > .x`,
// `&&` — all put a non-word character after the `&` and are correctly ignored: they nest a state
// onto a name that already exists, which is orthogonal to how that name was spelled.
const AMPERSAND_CONCAT = /&[A-Za-z0-9_-]+/g;

// …with one exception, and it is not a rare one. A transition class (`.fade { &-enter-from {} }`)
// is a concatenation the author did not choose: the name is dictated by the framework, and the
// flat spelling is not even available when the transition name is a prop. Counted as a preference
// it is noise, and measurably the dominant kind: it was 16 of Element Plus's 35 concatenations and
// 134 of Vuetify's 713 — the single largest false signal found in the corpus. Vue's
// enter/leave/move set and the React-transition enter/exit/appear set are both listed. Only hyphen
// separators are matched, so `&__enter` and `&--active` stay BEM and are deliberately left alone.
const TRANSITION_CLASS = /^&-{1,2}(?:enter|leave|exit|appear|move)(?:-(?:from|to|active|done))?$/;

// A compound class declared in full at the top level. Anchored to column 0 because in both braced
// and indented syntax a nested rule is indented and a top-level one is not — what every formatter
// in this ecosystem emits. That anchor is also what keeps the descendant-selector anti-pattern
// (`.card { .card__title {} }`, which is indented and compiles to `.card .card__title`) from being
// miscounted as a vote for flat: it is not the flat form, it is a third, wrong one.
//
// Known limit, and the reason the two arms are not symmetric: this sees only BEM-punctuated names.
// A project that spells compound names with a single hyphen (`.accordion-body` — Bootstrap's whole
// scheme) casts no vote, because `.accordion-body` and `.el-button` are textually identical and
// only one of them is a compound name; no regex separates a block+element from a kebab-case block.
// So a silent flat majority is possible, which is exactly what AMPERSAND_FLOOR below answers.
const FLAT_COMPOUND = /^\.[A-Za-z_-][A-Za-z0-9_-]*?(?:__|--)[A-Za-z0-9_-]/gm;

/**
 * Drop the spans where a `&` or a leading `.` means nothing: block comments, quoted strings
 * (`content: "&amp;"` is not a selector), then line comments. Order matters — strings inside a
 * commented-out rule are gone before the string pass can see them.
 *
 * The `//` pass also truncates an _unquoted_ `url(https://…)`, which at worst costs a signal on the
 * rest of that line; nothing downstream treats an undercount as evidence of the opposite habit.
 */
const stripStylesheetNoise = (body: string): string =>
  body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(['"])(?:\\.|(?!\1)[^\\\n])*\1/g, '""')
    .replace(/\/\/[^\n]*/g, ' ');

/**
 * Count both spellings of a compound class name in one stylesheet body. Pure, and exported so the
 * regex heuristics above are testable on their own rather than only through a temp directory.
 */
export const tallyClassNaming = (body: string): Omit<ClassNamingTally, 'filesScanned'> => {
  const clean = stripStylesheetNoise(body);
  const concats = clean.match(AMPERSAND_CONCAT) ?? [];
  return {
    ampersand: concats.filter(c => !TRANSITION_CLASS.test(c)).length,
    flat: (clean.match(FLAT_COMPOUND) ?? []).length,
  };
};

/** Concatenate an SFC's preprocessor <style> blocks; '' when it has none. */
const sfcPreprocessorStyles = (body: string): string =>
  [...body.matchAll(SFC_PREPROCESSOR_STYLE_BLOCK)].map(m => m[1]).join('\n');

// A tally, unlike the Tailwind marker scan, cannot stop at the first hit — every file is a vote.
// The cap is what keeps that bounded on a repo with a pathological stylesheet count; 400 files is
// far past the point where a convention is established, so raising it could only re-decide a vote
// that is already lopsided.
const CLASS_NAMING_FILE_CAP = 400;

/**
 * Walk the project's preprocessor stylesheets (and the preprocessor <style> blocks of its SFCs) and
 * tally how they spell compound class names. Undefined when it found none to read.
 */
const scanClassNaming = async (root: string): Promise<ClassNamingTally | undefined> => {
  let ampersand = 0;
  let flat = 0;
  let filesScanned = 0;
  for await (const rel of walkRepoFiles(root, {
    extensions: [...NESTING_STYLESHEET_EXTENSIONS, ...SFC_EXTENSIONS],
    cap: CLASS_NAMING_FILE_CAP,
  })) {
    let body: string;
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential scan, bounded by the cap above
      body = await readFile(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    const isSfc = SFC_EXTENSIONS.some(ext => rel.endsWith(ext));
    const source = isSfc ? sfcPreprocessorStyles(body) : body;
    // An SFC with no preprocessor style block is not a stylesheet that voted "no habit" — it is a
    // file with nothing to say, and counting it would dilute filesScanned into a meaningless number.
    if (source.trim() === '') continue;
    filesScanned += 1;
    const tally = tallyClassNaming(source);
    ampersand += tally.ampersand;
    flat += tally.flat;
  }
  return filesScanned === 0 ? undefined : { ampersand, flat, filesScanned };
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

  // Two independent repo walks, both IO-bound — run them together so the class-naming scan costs
  // essentially nothing in wall clock on top of the Tailwind marker probe that was already here.
  const [tailwindCssEntry, classNamingTally] = await Promise.all([
    findTailwindCssEntry(root),
    scanClassNaming(root),
  ]);

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
    ...(classNamingTally === undefined ? {} : { classNamingTally }),
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

// How many `&` concatenations it takes before this is called a habit rather than an accident. The
// two arms are not symmetric — FLAT_COMPOUND cannot see a single-hyphen flat scheme — so a bare
// `ampersand > flat` lets a handful of incidental concatenations outvote a flat majority it never
// counted. The floor is where that asymmetry is paid for, and the direction is chosen on cost, not
// on likelihood: reporting `ampersand` wrongly imposes the unsearchable spelling this whole feature
// exists to avoid, while reporting `flat` wrongly emits a valid, searchable, merely-unidiomatic
// file.
//
// The value is insurance, not a fitted threshold, and the measurement says so. Across 1229 real
// stylesheets the scores are Ant Design v4 4894, Vuetify 579, Element Plus 19, and Bootstrap /
// BootstrapVue / Bulma 0 — nothing lands between 1 and 18, so this line separates none of them. It
// exists for the case the corpus does not contain: a repo whose flat scheme is single-hyphen (thus
// invisible to FLAT_COMPOUND) carrying one legacy file that concatenates.
const AMPERSAND_FLOOR = 5;

/**
 * Decide the project's compound-class-name habit from the tally. Pure.
 *
 * A plurality decides it, and a tie goes to `flat`: the two spellings compile identically, so the
 * tiebreak costs nothing at build time and buys back the property that only the flat form has — the
 * name in the stylesheet is the name in the markup, so it can be searched for. `undefined` means
 * the scan found no compound class either way, which is a real third answer ("this project has no
 * habit to match") and not a quiet vote for flat.
 */
const detectClassNaming = (
  tally: ClassNamingTally | undefined,
): { style?: ClassNamingStyle; reason: string } => {
  if (tally === undefined) return { reason: 'no preprocessor stylesheet found' };
  const { ampersand, flat, filesScanned } = tally;
  const counts = `${ampersand} &-assembled vs ${flat} full-name in ${filesScanned} stylesheet(s)`;
  if (ampersand === 0 && flat === 0) return { reason: `no compound class name found (${counts})` };
  if (ampersand > flat && ampersand < AMPERSAND_FLOOR) {
    return { style: 'flat', reason: `${counts} — below the floor for an & habit` };
  }
  return { style: ampersand > flat ? 'ampersand' : 'flat', reason: counts };
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

  const classNaming = detectClassNaming(input.classNamingTally);
  evidence.push(`classNaming=${classNaming.style ?? 'none'}: ${classNaming.reason}`);

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
      ...(classNaming.style === undefined ? {} : { classNaming: classNaming.style }),
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
