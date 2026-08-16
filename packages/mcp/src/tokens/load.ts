import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectProfile, StylingSystem } from '../profile/profile.js';
import { parseTailwindConfig, parseUnoConfig } from './js-config.js';
import { aggregateRepoCssTokens } from './repo-css.js';
import { aggregateRepoScssTokens } from './repo-scss.js';
import { parseCssCustomProperties, parseScssVariables, type ProjectToken } from './tokens.js';

// The one place that decides where a project's design tokens come from and reads them — shared by
// token_map (the explicit join tool) and the design-context value-reverse annotation, so the two
// surfaces can never disagree about what the project's tokens are.

/**
 * Which reader a token source needs. `css` covers Tailwind v4's `@theme` and plain custom
 * properties alike (both are CSS declarations); the other two are JS/TS config objects, which hold
 * the same scales in a form no CSS parser can see. They are separate kinds rather than one
 * "js-config" because the frameworks name their theme keys differently.
 */
export type TokenSourceKind = 'css' | 'tailwind-v3' | 'unocss' | 'scss';

export interface TokenSource {
  /** Repo-relative path. */
  path: string;
  kind: TokenSourceKind;
}

// .js / .cjs / .mjs / .ts / .cts / .mts — every extension either framework's config may use.
const JS_CONFIG_EXT = /\.[cm]?[jt]s$/i;
// UnoCSS's two config basenames. Spelled as an alternation rather than an optional letter: the
// tempting `unocss?` reads right and is not — it means "unocs" + an optional "s", so it matches a
// name nobody writes and misses `uno.config.ts`, the commoner of the two.
const UNO_CONFIG_BASENAME = /(^|[\\/])(uno|unocss)\.config\.[cm]?[jt]s$/i;
const TAILWIND_CONFIG_BASENAME = /(^|[\\/])tailwind\.config\.[cm]?[jt]s$/i;

/**
 * Which reader an explicit `tokenSource` override needs. The caller's intent has to come from what
 * they pointed at: a stylesheet reads CSS, and **either** framework's config basename identifies it
 * outright. Recognising only UnoCSS's names was asymmetric — a monorepo whose app is UnoCSS may
 * well keep its tokens in a shared package's `tailwind.config.js`, and reading that with the UnoCSS
 * vocabulary silently drops `screens`, `transitionTimingFunction`, `aspectRatio` and `animation`
 * while hunting for `breakpoints`/`easing`, which aren't there. Only when the name identifies
 * neither does detection break the tie — an override usually corrects _where_ the tokens live, not
 * which framework wrote them.
 */
const kindOfOverride = (path: string, system: StylingSystem): TokenSourceKind => {
  if (/\.scss$/i.test(path)) return 'scss';
  if (!JS_CONFIG_EXT.test(path)) return 'css';
  if (UNO_CONFIG_BASENAME.test(path)) return 'unocss';
  if (TAILWIND_CONFIG_BASENAME.test(path)) return 'tailwind-v3';
  return system === 'unocss' ? 'unocss' : 'tailwind-v3';
};

/** Pick the token source: explicit override, else the detected styling config. */
export const resolveTokenSource = (
  // Only the styling half of the profile decides this, so that's all it asks for.
  profile: Pick<ProjectProfile, 'styling'>,
  override: string | undefined,
): { source: TokenSource | null; note?: string } => {
  if (override !== undefined) {
    return { source: { path: override, kind: kindOfOverride(override, profile.styling.system) } };
  }

  const configPath = profile.styling.configPath;
  if (configPath === undefined)
    return { source: null, note: 'no token source detected; pass tokenSource' };
  if (configPath.endsWith('.css')) return { source: { path: configPath, kind: 'css' } };
  // Detection knows which framework it matched, so trust it over the filename here: an UnoCSS
  // project is free to name its config anything its loader accepts.
  if (JS_CONFIG_EXT.test(configPath)) {
    const kind = profile.styling.system === 'unocss' ? 'unocss' : 'tailwind-v3';
    return { source: { path: configPath, kind } };
  }
  return {
    source: null,
    note: `styling config ${configPath} is not a readable token source; pass tokenSource`,
  };
};

export interface LoadedProjectTokens {
  tokens: ProjectToken[];
  /** Repo-relative source that was actually read, or null (aggregated or none). */
  source: string | null;
  /** Diagnostic for the caller: why there's no single source / that a source failed to read. */
  note?: string;
  /** Repo-relative files the tokens came from (the source, plus any aggregated contributors). */
  files: string[];
}

// A note is a diagnostic, not an inventory. The CSS walk caps at 200 files, and naming every one of
// them buries the sentence that matters ("N theme entries were skipped") under a wall of paths in
// the middle of a tool result. Enough to recognise where the tokens came from, then a count.
const NAMED_FILES = 6;

// Said on every SCSS result, because the ref is not self-sufficient: `$color-primary-500` is an
// undefined-variable error until the consuming file pulls its declaring file in, and modern Sass
// namespaces that import. Verified against dart-sass — under a plain `@use './tokens'` the bare
// name does not compile and the reference is `tokens.$color-primary-500`.
const SCSS_USE_NOTE =
  "a SCSS ref only resolves once the consuming file imports its `from` file. `from` is repo-relative and Sass resolves @use against the *importing* file, so re-resolve it from wherever the code is being written (a file in src/components imports '../styles/tokens', not the repo-relative path verbatim). `@use '<resolved>' as *` keeps the ref as written; a namespaced @use instead requires prefixing the ref with that namespace";

const listFiles = (files: readonly string[]): string =>
  files.length <= NAMED_FILES
    ? files.join(', ')
    : `${files.slice(0, NAMED_FILES).join(', ')} (+${files.length - NAMED_FILES} more)`;

/**
 * Drop entries that are the same token seen twice — identical in name, value _and_ reference form.
 * A `:root { --brand }` block in a `.scss` file and the compiled `.css` committed beside it are one
 * declaration read through two walks, and leaving both makes the join report the token ambiguous
 * with itself: an exact name+value hit degrades to `medium` with `ambiguousWith: ['brand']`.
 *
 * Identity includes the declaring file, so two `.scss` files declaring the same name are _not_
 * collapsed — those are genuinely different declarations, and which one a ref points at matters.
 */
const dedupeTokens = (tokens: readonly ProjectToken[]): ProjectToken[] => {
  const seen = new Set<string>();
  return tokens.filter(t => {
    const key = [t.name, t.value, t.cssVar ?? '', t.scssVar ?? '', t.from ?? ''].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Read one file, or null when it isn't readable — a missing token source is a note, not a throw. */
const readOr = async (rootDir: string, rel: string): Promise<string | null> => {
  try {
    return await readFile(join(rootDir, rel), 'utf8');
  } catch {
    return null;
  }
};

/**
 * Load the project's design tokens: the detected/overridden source when there is one, else the
 * repo-wide custom-property aggregation (whose pool the joins filter — incidental vars never
 * surface on their own). Notes mirror what token_map has always reported.
 */
export const loadProjectTokens = async (
  rootDir: string,
  profile: ProjectProfile,
  tokenSourceOverride: string | undefined,
): Promise<LoadedProjectTokens> => {
  const { source, note } = resolveTokenSource(profile, tokenSourceOverride);

  if (source !== null && source.kind === 'scss') {
    // An explicit `tokenSource` pointing at one .scss file: read exactly that, so a caller can
    // narrow a large repo to its variables file.
    const body = await readOr(rootDir, source.path);
    if (body === null) {
      return {
        tokens: [],
        source: null,
        note: `token source ${source.path} could not be read`,
        files: [],
      };
    }
    return {
      tokens: [...parseScssVariables(body, source.path), ...parseCssCustomProperties(body, true)],
      source: source.path,
      files: [source.path],
      note: SCSS_USE_NOTE,
    };
  }

  if (source !== null && source.kind !== 'css')
    return loadJsConfigTokens(rootDir, source, profile.styling);

  if (source !== null) {
    const body = await readOr(rootDir, source.path);
    if (body === null) {
      return {
        tokens: [],
        source: null,
        note: `token source ${source.path} could not be read`,
        files: [],
      };
    }
    const tokens = parseCssCustomProperties(body);
    if (tokens.length > 0) return { tokens, source: source.path, files: [source.path] };
    // The detected entry declares nothing, so it is not where the tokens live. Tailwind v4's
    // commonest real layout does exactly this — `app.css` holds `@import "tailwindcss"` and pulls
    // the `@theme` block in from a partial — and the entry scan stops at the first file carrying
    // either marker. Reading only that file returned zero tokens, silently and with no note, for a
    // project with a complete design system.
    //
    // Falling back to the repo-wide pool is the same mechanism the no-source path below uses, and
    // it is strictly additive here: the alternative on this branch is nothing at all. (A theme
    // *split* across the entry and a partial still reads only the entry — it has tokens, so it
    // never reaches this fallback. That is a narrower miss, and pooling unconditionally would put
    // incidental vars into a pool that is currently precise, which can cap a real match's
    // confidence.)
    const pooled = await aggregateRepoCssTokens(rootDir);
    if (pooled.files.length > 0) {
      return {
        tokens: pooled.tokens,
        source: null,
        note: `${source.path} declares no custom properties — the tokens are not in the detected entry; aggregated ${pooled.tokens.length} from ${pooled.files.length} CSS file(s): ${listFiles(pooled.files)}`,
        files: pooled.files,
      };
    }
    return { tokens, source: source.path, files: [source.path] };
  }

  // A SCSS project has no single detected source — there is no marker for "the" variables file, and
  // real layouts run from one 952-entry file to ~90 per-component ones — so the .scss pool is the
  // source. Checked before the .css pool because a SCSS project's tokens are in .scss files, which
  // that walk does not visit; without this the whole styling system read nothing.
  if (profile.styling.system === 'scss') {
    const scss = await aggregateRepoScssTokens(rootDir);
    if (scss.files.length > 0) {
      // Pooled with the repo's .css for the same reason the JS-config path pools it: a project can
      // keep its Sass variables in .scss and a global `:root` block in a plain .css file, and
      // returning only one of them would trade half the matches away. Both walks are already
      // aggregations, so this does not turn a precise source into a fuzzy one.
      const css = await aggregateRepoCssTokens(rootDir);
      const cssNote =
        css.files.length === 0
          ? ''
          : `; also pooled ${css.tokens.length} custom propert(ies) from ${css.files.length} .css file(s): ${listFiles(css.files)}`;
      return {
        tokens: dedupeTokens([...scss.tokens, ...css.tokens]),
        source: null,
        note: `aggregated ${scss.tokens.length} token(s) from ${scss.files.length} .scss file(s): ${listFiles(scss.files)}${cssNote}; ${SCSS_USE_NOTE}`,
        files: [...scss.files, ...css.files],
      };
    }
  }

  // No single token config detected (a plain CSS-variables project, or Tailwind whose @theme entry
  // wasn't located). Aggregate custom properties across the repo's CSS and let the join filter
  // them — incidental vars stay unmatched, so this can only add real matches, never regress.
  const { tokens, files } = await aggregateRepoCssTokens(rootDir);
  if (files.length > 0) {
    return {
      tokens,
      source: null,
      note: `no single token config detected; aggregated ${tokens.length} custom properties from ${files.length} CSS file(s): ${listFiles(files)}`,
      files,
    };
  }
  return { tokens, source: null, ...(note === undefined ? {} : { note }), files };
};

/**
 * A JS/TS framework config: its theme scales **plus** the repo's CSS custom properties.
 *
 * The union is not a nicety, it's the no-regression condition. Before these configs could be read,
 * such a project fell through to the repo-wide CSS aggregation, so any token it declared as a plain
 * custom property (`:root { --brand: … }` alongside the config — extremely common, since that's how
 * these projects do runtime theming) was already being matched. Reading the config _instead_ of
 * that pool would have traded one set of matches for another; reading it _in addition_ can only
 * add.
 *
 * Config tokens lead: on a utility-first project their utility base is the better ref, and the join
 * scores each name once in encounter order. A name+value present in both pools is emitted once, so
 * a token can never be reported ambiguous with itself; the same name at a _different_ value is kept
 * (two real declarations, exactly as a light/dark pair is kept within one stylesheet).
 */
const loadJsConfigTokens = async (
  rootDir: string,
  source: TokenSource,
  styling: ProjectProfile['styling'],
): Promise<LoadedProjectTokens> => {
  // Does a `@theme` block in this repo's CSS actually compile? Only Tailwind v4 processes it. The
  // question is *not* "did the tokens come from a JS config": v4's documented upgrade path is
  // `@config "../tailwind.config.js"` beside an `@import "tailwindcss"`, which leaves a root
  // tailwind.config.* on a genuine v4 project — so answering it by source kind stripped the utility
  // ref off every real v4 `@theme` token and regressed those projects against main.
  const themeBlockCompiles = styling.system === 'tailwind' && styling.tailwindVersion === 4;

  const configPath = source.path;
  const body = await readOr(rootDir, configPath);
  if (body === null) {
    return {
      tokens: [],
      source: null,
      note: `token source ${configPath} could not be read`,
      files: [],
    };
  }
  const parse = source.kind === 'unocss' ? parseUnoConfig : parseTailwindConfig;
  const config = parse(configPath, body);
  const css = await aggregateRepoCssTokens(rootDir);

  const seen = new Set(config.tokens.map(t => `${t.name} ${t.value}`));
  const tokens = [...config.tokens];
  for (const token of css.tokens) {
    const key = `${token.name} ${token.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Where `@theme` is foreign syntax — UnoCSS, or Tailwind v3 — nothing compiles it, so a pooled
    // custom property never generates a class whatever scope it sits in. Leftover v4 residue in a
    // migrated repo otherwise emitted `bg-leftover` for a token that resolves to nothing.
    if (themeBlockCompiles) {
      tokens.push(token);
      continue;
    }
    const pooled = { ...token };
    delete pooled.utilityIsClass;
    tokens.push(pooled);
  }

  const notes = [`read ${config.tokens.length} theme token(s) from ${configPath}`];
  // Zero tokens has two causes that must not share a message. Telling someone whose config simply
  // says `theme: { extend: {} }` that it "could not be read" sends them hunting for a parsing bug;
  // telling someone whose theme lives in a preset that it "declares no scales" hides where to look.
  if (!config.themeFound) {
    notes.push(
      'no theme object was reachable in it — the theme is built at runtime, or lives in a preset / shared package this does not open; pass tokenSource to the file that declares the tokens',
    );
  } else if (config.tokens.length === 0 && config.skipped === 0) {
    notes.push('its theme declares no scales that map to design tokens');
  }
  // Deliberately not an `else if`. Chained onto the zero-token branch, the skip count was
  // unreachable in exactly the case it was added for: a config whose only colour scale is
  // `require('tailwindcss/colors')` yields zero tokens *and* one skip, and reported "its theme
  // declares no scales" — the message this very chain exists to stop being wrong.
  if (config.themeFound && config.skipped > 0) {
    notes.push(
      `${config.skipped} theme entr(ies) were skipped because they are not statically readable (spread of an imported palette, computed key, or function value)`,
    );
  }
  if (css.files.length > 0) {
    notes.push(
      `also pooled ${css.tokens.length} CSS custom propert(ies) from ${css.files.length} file(s): ${listFiles(css.files)}`,
    );
  }
  // A config's theme scales are inlined into the utilities the framework generates, so those tokens
  // have no var() form — the ref to emit is the utility base (bg-primary-500). Said only when the
  // config actually produced such tokens: on a v4 project reading a JS config for `content` alone
  // the theme lives in `@theme`, every ref *is* a var(), and this sentence flatly contradicted the
  // payload it was attached to (while also naming the wrong major).
  if (config.tokens.length > 0) {
    notes.push(
      `the ${source.kind === 'unocss' ? 'UnoCSS' : 'Tailwind'} config declares no CSS custom properties; reference its theme tokens as utilities`,
    );
  }

  return {
    tokens,
    source: configPath,
    note: notes.join('; '),
    files: [configPath, ...css.files],
  };
};
