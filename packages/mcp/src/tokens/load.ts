import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectProfile, StylingSystem } from '../profile/profile.js';
import { parseTailwindConfig, parseUnoConfig } from './js-config.js';
import { aggregateRepoCssTokens } from './repo-css.js';
import { parseCssCustomProperties, type ProjectToken } from './tokens.js';

// The one place that decides where a project's design tokens come from and reads them — shared by
// token_map (the explicit join tool) and the design-context value-reverse annotation, so the two
// surfaces can never disagree about what the project's tokens are.

/**
 * Which reader a token source needs. `css` covers Tailwind v4's `@theme` and plain custom
 * properties alike (both are CSS declarations); the other two are JS/TS config objects, which hold
 * the same scales in a form no CSS parser can see. They are separate kinds rather than one
 * "js-config" because the frameworks name their theme keys differently.
 */
export type TokenSourceKind = 'css' | 'tailwind-v3' | 'unocss';

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

const listFiles = (files: readonly string[]): string =>
  files.length <= NAMED_FILES
    ? files.join(', ')
    : `${files.slice(0, NAMED_FILES).join(', ')} (+${files.length - NAMED_FILES} more)`;

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
    return { tokens: parseCssCustomProperties(body), source: source.path, files: [source.path] };
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
