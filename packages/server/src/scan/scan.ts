import { glob, readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

import { parseSync } from 'oxc-parser';

// Component scanner — finds the project's existing components so component_map can join Figma names
// against them. The guiding principle: never pattern-match the directory layout (feature-based, atomic,
// flat all differ); identify a component by its *AST signature* (a PascalCase, exported, function-ish
// binding) and take its name from the export/filename. Folder is only a confidence hint, applied later
// in the join. React (.tsx/.jsx) is parsed with oxc; Vue/Svelte fall back to filename-derived names
// (their SFC name is the file by convention) as a baseline until a dedicated pass is added.

export type ComponentFramework = 'react' | 'vue' | 'svelte';

export interface ScannedComponent {
  name: string;
  /** Repo-relative path. */
  filePath: string;
  exportKind: 'default' | 'named';
  /** Best-effort destructured prop names from the component's first param; [] when not extractable. */
  propNames: string[];
  framework: ComponentFramework;
}

/** Directories never worth walking. */
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.git',
  'coverage',
]);

/** React HOCs whose call wraps a component function — the binding is still a component. */
const COMPONENT_WRAPPERS = new Set(['forwardRef', 'memo', 'observer']);

const isPascalCase = (name: string): boolean => /^[A-Z][A-Za-z0-9]*$/.test(name);

/** Derive a PascalCase component name from a file path (index.tsx → parent dir name). */
export const nameFromFile = (filePath: string): string => {
  let base = basename(filePath, extname(filePath));
  if (base === 'index') base = basename(dirname(filePath));
  const words = base.split(/[-_.\s]+/).filter(Boolean);
  const pascal = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return pascal || base;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- oxc returns an untyped ESTree-ish AST */

/** Pull destructured prop names from a function node's first param ({ size, variant } → [...]). */
const propNamesOf = (fn: any): string[] => {
  const p0 = fn?.params?.[0];
  if (p0?.type !== 'ObjectPattern') return [];
  return (p0.properties ?? [])
    .filter((pr: any) => pr.type === 'Property' && pr.key?.name)
    .map((pr: any) => pr.key.name as string);
};

/** If a binding's initializer is (or wraps) a function, return that function node, else null. */
const functionOf = (init: any): any => {
  if (init == null) return null;
  if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') return init;
  if (init.type === 'CallExpression' && COMPONENT_WRAPPERS.has(init.callee?.name)) {
    const arg0 = init.arguments?.[0];
    if (arg0?.type === 'ArrowFunctionExpression' || arg0?.type === 'FunctionExpression')
      return arg0;
  }
  return null;
};

interface Candidate {
  name: string | null;
  fn: any;
  exportKind: 'default' | 'named';
}

/** Resolve an export declaration node to a (name, function) candidate, or null if not function-ish. */
const candidateOf = (node: any): Candidate | null => {
  const d = node.declaration;
  if (d == null) return null;
  const exportKind = node.type === 'ExportDefaultDeclaration' ? 'default' : 'named';

  if (d.type === 'FunctionDeclaration') return { name: d.id?.name ?? null, fn: d, exportKind };
  // `export default () => ...` / `export default forwardRef(...)`
  const directFn = functionOf(d);
  if (directFn !== null && exportKind === 'default')
    return { name: null, fn: directFn, exportKind };
  if (d.type === 'VariableDeclaration') {
    const decl = d.declarations?.[0];
    const fn = functionOf(decl?.init);
    if (fn !== null) return { name: decl?.id?.name ?? null, fn, exportKind };
  }
  return null;
};

/**
 * Extract React components from one file's source. Pure (no fs) so it can be unit-tested directly.
 * A component is an exported, function-ish binding whose name is PascalCase — this excludes utility
 * exports (`export const API_URL = '…'`). An anonymous default export borrows the filename.
 */
export const extractReactComponents = (filePath: string, code: string): ScannedComponent[] => {
  let program: any;
  try {
    program = parseSync(filePath, code).program;
  } catch {
    return [];
  }
  const out: ScannedComponent[] = [];
  for (const node of program.body ?? []) {
    if (node.type !== 'ExportNamedDeclaration' && node.type !== 'ExportDefaultDeclaration')
      continue;
    const cand = candidateOf(node);
    if (cand === null) continue;
    const name = cand.name ?? (cand.exportKind === 'default' ? nameFromFile(filePath) : null);
    if (name === null || !isPascalCase(name)) continue;
    out.push({
      name,
      filePath,
      exportKind: cand.exportKind,
      propNames: propNamesOf(cand.fn),
      framework: 'react',
    });
  }
  return out;
};

/* eslint-enable @typescript-eslint/no-explicit-any */

const REACT_EXTS = new Set(['.tsx', '.jsx']);

/** Baseline extractor for SFC frameworks: the file is the component, name derived from the path. */
const extractSfcComponent = (
  filePath: string,
  framework: ComponentFramework,
): ScannedComponent[] => [
  { name: nameFromFile(filePath), filePath, exportKind: 'default', propNames: [], framework },
];

const frameworkForExt = (ext: string): ComponentFramework | null => {
  if (REACT_EXTS.has(ext)) return 'react';
  if (ext === '.vue') return 'vue';
  if (ext === '.svelte') return 'svelte';
  return null;
};

/**
 * Walk the repo for files matching the profile's component extensions, skipping vendored/build
 * dirs, and extract their components. Returns repo-relative paths. Parse failures on individual
 * files are swallowed so one bad file can't sink the whole scan.
 */
export const scanComponents = async (
  rootDir: string,
  extensions: readonly string[],
): Promise<ScannedComponent[]> => {
  const exts = new Set(extensions.map(e => (e.startsWith('.') ? e : `.${e}`)));
  // One glob per extension rather than a `{a,b}` brace group: Node's fs glob does NOT expand a
  // single-element brace (`**/*{.vue}` matches literally and finds nothing), which silently sank
  // every single-extension profile — i.e. all of Vue and Svelte. An array of plain patterns has no
  // such edge case.
  const patterns = [...exts].map(e => `**/*${e}`);
  const out: ScannedComponent[] = [];

  for await (const entry of glob(patterns, { cwd: rootDir })) {
    const rel = typeof entry === 'string' ? entry : String(entry);
    if (rel.split('/').some(seg => IGNORED_DIRS.has(seg))) continue;
    const framework = frameworkForExt(extname(rel));
    if (framework === null) continue;
    let code: string;
    try {
      // eslint-disable-next-line no-await-in-loop -- per-file read; clarity over batching
      code = await readFile(join(rootDir, rel), 'utf8');
    } catch {
      continue;
    }
    if (framework === 'react') out.push(...extractReactComponents(rel, code));
    else out.push(...extractSfcComponent(rel, framework));
  }
  return out;
};
