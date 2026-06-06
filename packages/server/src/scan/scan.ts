import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

import { parseSync } from 'oxc-parser';

import { walkRepoFiles } from '../repo-walk.js';

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
  /** The component's prop names; [] when the component has none OR they couldn't be parsed. */
  propNames: string[];
  /**
   * Whether propNames is a real parse result (so [] means "genuinely no props") versus a baseline
   * that couldn't read props (so [] means "unknown"). The component join uses this to avoid
   * reporting every variant axis as an unmatched prop just because we never parsed the props — a
   * false "extend this component" TODO. True once we've parsed the source; false only on a parse
   * failure.
   */
  propsExtracted: boolean;
  framework: ComponentFramework;
}

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
      propsExtracted: true,
      framework: 'react',
    });
  }
  return out;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- shared oxc AST walker below */

/** Depth-first walk of an oxc/ESTree node, yielding every CallExpression encountered. */
const collectCalls = (root: any): any[] => {
  const out: any[] = [];
  const visit = (node: any): void => {
    if (node === null || typeof node !== 'object') return;
    if (node.type === 'CallExpression') out.push(node);
    for (const key of Object.keys(node)) {
      const v = (node as Record<string, unknown>)[key];
      if (Array.isArray(v)) for (const c of v) visit(c);
      else if (v !== null && typeof v === 'object') visit(v);
    }
  };
  visit(root);
  return out;
};

/** Prop names from a `defineProps` call: a type literal, an object, or an array of string keys. */
const definePropsNames = (call: any): string[] => {
  // Type form: defineProps<{ size?: string; variant: 'a' | 'b' }>(). oxc exposes the instantiation as
  // typeArguments (older trees: typeParameters); its first param is a TSTypeLiteral whose members'
  // keys are the prop names.
  const typeArgs = call.typeArguments ?? call.typeParameters;
  const typeLiteral = typeArgs?.params?.[0];
  if (typeLiteral?.type === 'TSTypeLiteral') {
    return (typeLiteral.members ?? [])
      .map((m: any) => m?.key?.name)
      .filter((n: unknown): n is string => typeof n === 'string');
  }
  const arg0 = call.arguments?.[0];
  // Object form: defineProps({ size: String, variant: { type: String } }) → keys.
  if (arg0?.type === 'ObjectExpression') {
    return (arg0.properties ?? [])
      .map((p: any) => p?.key?.name ?? p?.key?.value)
      .filter((n: unknown): n is string => typeof n === 'string');
  }
  // Array form: defineProps(['size', 'variant']) → the string literals.
  if (arg0?.type === 'ArrayExpression') {
    return (arg0.elements ?? [])
      .map((e: any) => (e?.type === 'Literal' ? e.value : undefined))
      .filter((n: unknown): n is string => typeof n === 'string');
  }
  return [];
};

/** Names from a `props: { … } | [ … ]` member of an object (Vue Options API props declaration). */
const propsMemberNames = (obj: any): string[] => {
  const propsProp = (obj?.properties ?? []).find(
    (p: any) => (p?.key?.name ?? p?.key?.value) === 'props',
  );
  const value = propsProp?.value;
  if (value?.type === 'ObjectExpression') {
    return (value.properties ?? [])
      .map((p: any) => p?.key?.name ?? p?.key?.value)
      .filter((n: unknown): n is string => typeof n === 'string');
  }
  if (value?.type === 'ArrayExpression') {
    return (value.elements ?? [])
      .map((e: any) => (e?.type === 'Literal' ? e.value : undefined))
      .filter((n: unknown): n is string => typeof n === 'string');
  }
  return [];
};

/**
 * Vue Options API prop names: `export default { props: { … } }` — or wrapped in defineComponent /
 * defineNuxtComponent. The default export is either an object or a call whose first arg is the
 * object.
 */
const vueOptionsPropsNames = (program: any): string[] => {
  for (const node of program.body ?? []) {
    if (node.type !== 'ExportDefaultDeclaration') continue;
    const d = node.declaration;
    const obj = d?.type === 'ObjectExpression' ? d : d?.arguments?.[0];
    if (obj?.type === 'ObjectExpression') return propsMemberNames(obj);
  }
  return [];
};

/** Svelte prop names: `export let foo` (Svelte 4) and `let { a, b } = $props()` (Svelte 5 runes). */
const sveltePropNames = (program: any): string[] => {
  const names = new Set<string>();
  for (const node of program.body ?? []) {
    if (
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'VariableDeclaration' &&
      node.declaration.kind === 'let'
    ) {
      for (const d of node.declaration.declarations ?? [])
        if (d?.id?.type === 'Identifier' && typeof d.id.name === 'string') names.add(d.id.name);
    }
  }
  // Svelte 5 runes: `let { a, b } = $props()` — a destructuring declarator initialized by $props().
  for (const node of program.body ?? []) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations ?? []) {
      if (d?.init?.type === 'CallExpression' && d.init.callee?.name === '$props') {
        for (const p of d.id?.properties ?? [])
          if (p?.key?.name && typeof p.key.name === 'string') names.add(p.key.name);
      }
    }
  }
  return [...names];
};

/* eslint-enable @typescript-eslint/no-explicit-any */

const REACT_EXTS = new Set(['.tsx', '.jsx']);

// Pull every <script> / <script setup> body out of an SFC. lang="ts" (or its absence) decides the
// parser dialect; a .vue/.svelte file with no script block is a genuinely prop-less template.
const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

interface ScriptBlock {
  body: string;
  ts: boolean;
}

const extractScriptBlocks = (code: string): ScriptBlock[] => {
  const out: ScriptBlock[] = [];
  for (const m of code.matchAll(SCRIPT_BLOCK)) {
    const attrs = m[1] ?? '';
    out.push({ body: m[2] ?? '', ts: /\blang=["']ts["']/.test(attrs) });
  }
  return out;
};

/**
 * Extract a single-file component (Vue / Svelte). The file is the component (its name is the file
 * by convention); props come from the <script> block — Vue's defineProps (type / object / array
 * forms) and Options-API `props`, Svelte's `export let` / `$props()`.
 *
 * PropsExtracted distinguishes "[] = genuinely no props" from "[] = unknown" so the join won't
 * invent extension TODOs. It's true only when we either found props, or the file is a script-less
 * (so genuinely prop-less) template. When a script is present but we read no props — a parse error,
 * or a prop-declaration style we don't recognize — it stays false (conservative: the join then
 * suppresses matched/unmatched rather than asserting prop gaps we can't actually see). oxc doesn't
 * throw on bad input, so a parse failure surfaces here simply as "no props found".
 */
export const extractSfcComponent = (
  filePath: string,
  code: string,
  framework: ComponentFramework,
): ScannedComponent[] => {
  const base = {
    name: nameFromFile(filePath),
    filePath,
    exportKind: 'default' as const,
    framework,
  };
  const scripts = extractScriptBlocks(code);
  if (scripts.length === 0) return [{ ...base, propNames: [], propsExtracted: true }];

  const names = new Set<string>();
  for (const script of scripts) {
    let program: ReturnType<typeof parseSync>['program'];
    try {
      // Name the virtual source so oxc picks the right dialect (TS enables defineProps<...>()).
      program = parseSync(`sfc.${script.ts ? 'ts' : 'js'}`, script.body).program;
    } catch {
      continue;
    }
    if (framework === 'vue') {
      for (const call of collectCalls(program))
        if ((call as { callee?: { name?: string } }).callee?.name === 'defineProps')
          for (const n of definePropsNames(call)) names.add(n);
      for (const n of vueOptionsPropsNames(program)) names.add(n);
    } else {
      for (const n of sveltePropNames(program)) names.add(n);
    }
  }
  // Found props → confidently extracted. None found despite a script → unknown (don't claim).
  return [{ ...base, propNames: [...names], propsExtracted: names.size > 0 }];
};

const frameworkForExt = (ext: string): ComponentFramework | null => {
  if (REACT_EXTS.has(ext)) return 'react';
  if (ext === '.vue') return 'vue';
  if (ext === '.svelte') return 'svelte';
  return null;
};

/**
 * Walk the repo for files matching the profile's component extensions and extract their components.
 * Directory pruning + .gitignore handling live in walkRepoFiles; parse failures on individual files
 * are swallowed so one bad file can't sink the whole scan.
 */
export const scanComponents = async (
  rootDir: string,
  extensions: readonly string[],
): Promise<ScannedComponent[]> => {
  const out: ScannedComponent[] = [];
  for await (const rel of walkRepoFiles(rootDir, { extensions })) {
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
    else out.push(...extractSfcComponent(rel, code, framework));
  }
  return out;
};
