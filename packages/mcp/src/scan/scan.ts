import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

import { parseSync } from 'oxc-parser';

import { walkRepoFiles } from '../repo-walk.js';
import { type ScriptLang, scanSfcScripts } from './sfc-blocks.js';

// Component scanner — finds the project's existing components so component_map can join Figma names
// against them. The guiding principle: never pattern-match the directory layout (feature-based, atomic,
// flat all differ); identify a component by its *AST signature* (a PascalCase, exported, function-ish
// binding) and take its name from the export/filename. Folder is only a confidence hint, applied later
// in the join. React (.tsx/.jsx) and Angular (.ts, an @Component-decorated class) are parsed with oxc;
// Vue/Svelte are parsed from their SFC <script> blocks, with the file supplying the component name
// (their SFC name is the file by convention).
//
// Two invariants earn their keep here, because both failure modes are silent:
//   1. Detection breadth — a component we don't find is reported `unmapped` by the join, and codegen
//      then rebuilds a component the project already has. So every *export* form has to resolve, not
//      just the inline-declaration one (`export { Button }`, `export default Button`, class
//      components, `React.memo(...)` all name real components).
//   2. Honest `propsExtracted` — see the field docs. Claiming an extraction we didn't do is worse
//      than admitting we couldn't: the join turns a false [] into "this component is missing every
//      variant axis", a wrong extension TODO.

export type ComponentFramework = 'react' | 'vue' | 'svelte' | 'angular';

export interface ScannedComponent {
  name: string;
  /** Repo-relative path. */
  filePath: string;
  exportKind: 'default' | 'named';
  /**
   * The prop names that were read. Every entry is a prop the component really declares; whether the
   * list is EXHAUSTIVE is what `propsExtracted` says. So it can be a partial list — a component
   * whose own props parsed but whose base class is imported reports its own and is flagged
   * incomplete.
   */
  propNames: string[];
  /**
   * Whether `propNames` is the complete set (so [] means "genuinely no props") rather than as much
   * as could be read (so it may be missing entries). The component join uses this to avoid
   * reporting every variant axis as an unmatched prop just because we couldn't see them all — a
   * false "extend this component" TODO.
   *
   * It must stay honest in BOTH directions. False when the props are declared in a way we can't
   * fully read — a parse failure, a prop type imported from another file, an interface or base
   * class extending one. True only when the list is exhaustive: props we read in full, or a
   * component that genuinely declares none (no parameter at all / a script-less SFC).
   */
  propsExtracted: boolean;
  framework: ComponentFramework;
}

/** Prop extraction outcome — names plus whether the list is complete (see `propsExtracted`). */
interface PropsResult {
  names: string[];
  extracted: boolean;
}

const UNKNOWN_PROPS: PropsResult = { names: [], extracted: false };
const NO_PROPS: PropsResult = { names: [], extracted: true };

/** React HOCs whose call wraps a component function — the binding is still a component. */
const COMPONENT_WRAPPERS = new Set(['forwardRef', 'memo', 'observer']);

/** Base classes that make an exported class a React class component. */
const REACT_COMPONENT_BASES = new Set(['Component', 'PureComponent']);

/** Depth limit when unwrapping nested HOCs (`memo(forwardRef(fn))`) — guards a pathological chain. */
const MAX_WRAPPER_DEPTH = 4;

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

// ── Named prop types ────────────────────────────────────────────────────────────────────────────
// Across all three JS frameworks the dominant way to declare props is a *named* type in the same
// file — `interface Props { … }` paired with `defineProps<Props>()`, `(props: Props)`, or
// `$props()`. Reading only inline literals (`defineProps<{ … }>()`) therefore misses the majority
// authoring style, so we resolve type names against the file's own declarations.
//
// Resolution is deliberately file-local: an imported prop type is NOT chased across modules. That
// keeps the scanner a single-pass, no-resolver pass (a type-aware crawl would need the whole
// program), and the honest answer for an unresolvable name is `null` → propsExtracted=false, which
// the join already handles by suppressing prop claims. Partial reads are treated as unresolved for
// the same reason: `interface Props extends ImportedBase { size }` really does have props we can't
// see, and reporting just `size` would make every inherited prop look missing.

/** Named type declarations in a file: type name → its declaration node. */
type TypeTable = Map<string, any>;

/** Index a program's `interface X {}` / `type X = {}` declarations, including exported ones. */
const collectTypeDeclarations = (program: any): TypeTable => {
  const table: TypeTable = new Map();
  for (const node of program?.body ?? []) {
    // `export interface Props {}` wraps the declaration; unwrap to the same shape as a bare one.
    const decl = node?.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (decl?.type !== 'TSInterfaceDeclaration' && decl?.type !== 'TSTypeAliasDeclaration')
      continue;
    const name = decl.id?.name;
    if (typeof name === 'string') table.set(name, decl);
  }
  return table;
};

/** Member names of a TSTypeLiteral / TSInterfaceBody member list (`{ size?: string }` → [size]). */
const memberNames = (members: any[]): string[] =>
  (members ?? [])
    .filter((m: any) => m?.type === 'TSPropertySignature' || m?.type === 'TSMethodSignature')
    .map((m: any) => m.key?.name ?? m.key?.value)
    .filter((n: unknown): n is string => typeof n === 'string');

/**
 * Resolve a type node to its complete list of property names, or null when any part of it can't be
 * read from this file alone (an imported type, a mapped/conditional type, a utility generic).
 * `seen` breaks reference cycles (`interface A extends B`, `interface B extends A`).
 */
const resolveTypeMembers = (
  node: any,
  table: TypeTable,
  seen: Set<string> = new Set(),
): string[] | null => {
  if (node == null) return null;
  switch (node.type) {
    case 'TSTypeLiteral':
      return memberNames(node.members);
    case 'TSTypeReference': {
      // A type argument doesn't rename members — a generic component's `Props<T>` still declares
      // `items` / `size`, only their types depend on T — so `Props<T>` resolves exactly like
      // `Props`. Utility types (`Partial<Props>`, `Omit<Props, 'x'>`) DO reshape the member set,
      // and they fall out naturally: they're TS built-ins, so the file's table has no entry and the
      // lookup below returns null. Same for `NS.Props`, whose typeName is a TSQualifiedName.
      const name = node.typeName?.name;
      if (typeof name !== 'string') return null;
      if (seen.has(name)) return [];
      const decl = table.get(name);
      if (decl === undefined) return null; // imported / built-in — unknowable here
      return resolveTypeMembers(decl, table, new Set([...seen, name]));
    }
    case 'TSInterfaceDeclaration': {
      const own = memberNames(node.body?.body);
      const names = new Set(own);
      // `interface Props extends Base` — Base's members are props too, so an unresolvable parent
      // makes the whole list incomplete.
      for (const heritage of node.extends ?? []) {
        const parent = resolveTypeMembers(
          {
            type: 'TSTypeReference',
            typeName: heritage.expression,
            typeArguments: heritage.typeArguments,
          },
          table,
          seen,
        );
        if (parent === null) return null;
        for (const n of parent) names.add(n);
      }
      return [...names];
    }
    case 'TSTypeAliasDeclaration':
      return resolveTypeMembers(node.typeAnnotation, table, seen);
    case 'TSIntersectionType': {
      // `type Props = Base & { size }` — every arm contributes; one unreadable arm sinks the list.
      const names = new Set<string>();
      for (const part of node.types ?? []) {
        const partNames = resolveTypeMembers(part, table, seen);
        if (partNames === null) return null;
        for (const n of partNames) names.add(n);
      }
      return [...names];
    }
    default:
      return null;
  }
};

/** Resolve a `: Props` annotation (on a parameter or a variable) to its prop names. */
const propsFromAnnotation = (annotated: any, table: TypeTable): PropsResult => {
  const names = resolveTypeMembers(annotated?.typeAnnotation?.typeAnnotation, table);
  return names === null ? UNKNOWN_PROPS : { names, extracted: true };
};

// ── React / Solid ───────────────────────────────────────────────────────────────────────────────

/**
 * Prop names from a component function's first parameter.
 *
 * A type annotation, when present, is the component's _declared_ contract and so takes precedence
 * over the destructuring pattern: `({ size }: Props)` accepts every member of Props, not just the
 * one the body happens to pull out, and treating the pattern as the answer would report the rest as
 * props the component is missing. An unresolvable annotation (imported type) therefore makes the
 * list incomplete even though the pattern named something — the same rule as `extends
 * ImportedBase`.
 *
 * Without an annotation the pattern is all there is, and in that case it _is_ the prop list. A
 * pattern that names nothing (`({ ...rest })`) is the exception: the props are real but written
 * down nowhere we can read, so that's unknown rather than none. No parameter at all is genuinely
 * prop-less.
 */
const propsOfFunction = (fn: any, table: TypeTable): PropsResult => {
  const p0 = fn?.params?.[0];
  if (p0 == null) return NO_PROPS;
  const destructured =
    p0.type === 'ObjectPattern'
      ? (p0.properties ?? [])
          .filter((pr: any) => pr.type === 'Property' && pr.key?.name)
          .map((pr: any) => pr.key.name as string)
      : [];
  if (p0.typeAnnotation != null) {
    const annotated = propsFromAnnotation(p0, table);
    // An unreadable annotation doesn't erase what the pattern spelled out: keep those names (the
    // join still counts them as matches) but leave the list flagged incomplete.
    return annotated.extracted ? annotated : { names: destructured, extracted: false };
  }
  if (p0.type === 'ObjectPattern')
    return destructured.length > 0 ? { names: destructured, extracted: true } : UNKNOWN_PROPS;
  return UNKNOWN_PROPS;
};

/** The called name of a HOC, whether imported bare (`memo`) or off the namespace (`React.memo`). */
const calleeName = (callee: any): string | undefined =>
  callee?.type === 'MemberExpression' ? callee.property?.name : callee?.name;

/**
 * If a binding's initializer is (or wraps) a function, return that function node, else null.
 * Wrappers nest in practice (`memo(forwardRef(fn))`) and are just as often reached through the
 * namespace (`React.memo`), so both are unwrapped, up to a small depth cap.
 */
const functionOf = (init: any, depth = 0): any => {
  if (init == null) return null;
  if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') return init;
  if (
    init.type === 'CallExpression' &&
    depth < MAX_WRAPPER_DEPTH &&
    COMPONENT_WRAPPERS.has(calleeName(init.callee) ?? '')
  ) {
    return functionOf(init.arguments?.[0], depth + 1);
  }
  return null;
};

/**
 * Generic component types whose first type argument is the props type (`const B: FC<Props> = …`).
 * Covers React's spellings and Solid's, which the same extractor parses — and Solid matters more
 * here than it looks: its components must NOT destructure props (that breaks reactivity), so
 * annotating the binding is the idiomatic way to declare them.
 */
const COMPONENT_TYPE_WRAPPERS = new Set([
  'FC',
  'FunctionComponent',
  'VFC',
  'ComponentType',
  'Component',
  'ParentComponent',
  'VoidComponent',
  'FlowComponent',
]);

/**
 * Props from the _binding's_ type annotation rather than the parameter's — `const Button: FC<Props>
 * = (props) => …` puts the prop type on the variable, so a parameter-only read finds nothing.
 * Handles both the bare (`FC`) and namespaced (`React.FC`) spellings.
 */
const propsFromComponentType = (declId: any, table: TypeTable): PropsResult => {
  const ref = declId?.typeAnnotation?.typeAnnotation;
  if (ref?.type !== 'TSTypeReference') return UNKNOWN_PROPS;
  // `React.FC` parses as a TSQualifiedName; its `right` is the member being referenced.
  const name =
    ref.typeName?.type === 'TSQualifiedName' ? ref.typeName.right?.name : ref.typeName?.name;
  if (typeof name !== 'string' || !COMPONENT_TYPE_WRAPPERS.has(name)) return UNKNOWN_PROPS;
  const arg0 = ref.typeArguments?.params?.[0];
  // A bare `FC` declares nothing, so it must not short-circuit the parameter read — `const B: FC =
  // ({ size }) => …` still names its props in the pattern.
  if (arg0 == null) return UNKNOWN_PROPS;
  const names = resolveTypeMembers(arg0, table);
  return names === null ? UNKNOWN_PROPS : { names, extracted: true };
};

/** True when a class extends React's component base, bare or namespaced (`React.Component`). */
const isReactComponentClass = (cls: any): boolean => {
  const sup = cls?.superClass;
  if (sup == null) return false;
  const name = sup.type === 'MemberExpression' ? sup.property?.name : sup.name;
  return typeof name === 'string' && REACT_COMPONENT_BASES.has(name);
};

/** Props of a class component — the first type argument of `extends Component<Props>`. */
const propsOfClass = (cls: any, table: TypeTable): PropsResult => {
  const arg0 = cls?.superTypeArguments?.params?.[0];
  if (arg0 == null) return UNKNOWN_PROPS;
  const names = resolveTypeMembers(arg0, table);
  return names === null ? UNKNOWN_PROPS : { names, extracted: true };
};

interface Candidate {
  name: string | null;
  props: PropsResult;
  exportKind: 'default' | 'named';
}

/** Resolve a declaration node (function, class, or initialized binding) to a candidate component. */
const candidateOfDeclaration = (
  d: any,
  exportKind: 'default' | 'named',
  table: TypeTable,
): Candidate | null => {
  if (d == null) return null;
  if (d.type === 'FunctionDeclaration')
    return { name: d.id?.name ?? null, props: propsOfFunction(d, table), exportKind };
  // Class components predate hooks but still fill maintained codebases; missing them means codegen
  // rebuilds a component that exists.
  if (d.type === 'ClassDeclaration' && isReactComponentClass(d))
    return { name: d.id?.name ?? null, props: propsOfClass(d, table), exportKind };
  // `export default () => ...` / `export default forwardRef(...)`
  const directFn = functionOf(d);
  if (directFn !== null && exportKind === 'default')
    return { name: null, props: propsOfFunction(directFn, table), exportKind };
  if (d.type === 'VariableDeclaration') {
    const decl = d.declarations?.[0];
    const fn = functionOf(decl?.init);
    if (fn !== null) {
      // The binding's `FC<Props>` annotation is the component's declared public contract, so it
      // wins when present — a body that ignores a prop (`FC<Props> = () => …`) doesn't remove it.
      const fromType = propsFromComponentType(decl?.id, table);
      const props = fromType.extracted ? fromType : propsOfFunction(fn, table);
      return { name: decl?.id?.name ?? null, props, exportKind };
    }
  }
  return null;
};

/** Resolve an export _declaration_ node to a candidate, or null if not function-ish. */
const candidateOf = (node: any, table: TypeTable): Candidate | null =>
  candidateOfDeclaration(
    node.declaration,
    node.type === 'ExportDefaultDeclaration' ? 'default' : 'named',
    table,
  );

/**
 * Index a file's top-level value declarations by binding name, so an export that only _references_
 * a binding (`export { Button }`, `export default Button`) can be resolved back to its declaration.
 * Declaring first and exporting at the bottom is an extremely common house style; without this the
 * component is invisible to the scanner.
 */
const collectLocalDeclarations = (program: any): Map<string, any> => {
  const locals = new Map<string, any>();
  for (const node of program?.body ?? []) {
    // Unwrap `export const X = …` too: it may also be re-exported under another name.
    const d = node?.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (d == null) continue;
    if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') {
      if (typeof d.id?.name === 'string') locals.set(d.id.name, d);
    } else if (d.type === 'VariableDeclaration') {
      for (const decl of d.declarations ?? []) {
        if (typeof decl?.id?.name === 'string') {
          // Wrap back into a single-declarator VariableDeclaration so candidateOfDeclaration can
          // treat it exactly like an inline `export const X = …`.
          locals.set(decl.id.name, { type: 'VariableDeclaration', declarations: [decl] });
        }
      }
    }
  }
  return locals;
};

/**
 * Extract React components from one file's source. Pure (no fs) so it can be unit-tested directly.
 * A component is an exported, function-ish (or React-class) binding whose name is PascalCase — this
 * excludes utility exports (`export const API_URL = '…'`). An anonymous default export borrows the
 * filename.
 *
 * Exports are read in two passes: inline declarations first (`export const Button = …`), then
 * reference exports (`export { Button }` / `export default Button`) resolved against the file's own
 * declarations. Inline-first keeps a binding that is both declared-and-exported inline and
 * re-exported from being emitted twice, and preserves the original pass's naming exactly.
 */
export const extractReactComponents = (filePath: string, code: string): ScannedComponent[] => {
  let program: any;
  try {
    program = parseSync(filePath, code).program;
  } catch {
    return [];
  }
  const table = collectTypeDeclarations(program);
  const byName = new Map<string, ScannedComponent>();

  const add = (name: string | null, cand: Candidate): void => {
    const resolved = name ?? (cand.exportKind === 'default' ? nameFromFile(filePath) : null);
    if (resolved === null || !isPascalCase(resolved) || byName.has(resolved)) return;
    byName.set(resolved, {
      name: resolved,
      filePath,
      exportKind: cand.exportKind,
      propNames: cand.props.names,
      propsExtracted: cand.props.extracted,
      framework: 'react',
    });
  };

  for (const node of program.body ?? []) {
    if (node.type !== 'ExportNamedDeclaration' && node.type !== 'ExportDefaultDeclaration')
      continue;
    const cand = candidateOf(node, table);
    if (cand !== null) add(cand.name, cand);
  }

  const locals = collectLocalDeclarations(program);
  for (const node of program.body ?? []) {
    if (node.type === 'ExportNamedDeclaration') {
      // `export type { Props }` carries no value; `export { X } from './y'` re-exports another
      // file's component, which that file's own scan already reports (counting it here would
      // attribute the component to the barrel).
      if (node.exportKind === 'type' || node.source != null) continue;
      for (const spec of node.specifiers ?? []) {
        if (spec?.exportKind === 'type') continue;
        const localName = spec?.local?.name;
        // `export { Button as default }` is a default export written the long way; naming it
        // "default" would fail the PascalCase gate and drop the component entirely.
        const isDefault = spec?.exported?.name === 'default';
        const cand = candidateOfDeclaration(
          locals.get(localName),
          isDefault ? 'default' : 'named',
          table,
        );
        if (cand !== null)
          add((isDefault ? localName : spec?.exported?.name) ?? localName ?? null, cand);
      }
    } else if (
      node.type === 'ExportDefaultDeclaration' &&
      node.declaration?.type === 'Identifier'
    ) {
      const cand = candidateOfDeclaration(locals.get(node.declaration.name), 'default', table);
      // The binding name is the author's own name for the component — better than the filename.
      if (cand !== null) add(node.declaration.name, cand);
    }
  }
  return [...byName.values()];
};

/** Whether an oxc class/member node carries a decorator called `name` (e.g. Component, Input). */
const hasDecorator = (node: any, name: string): boolean =>
  (node.decorators ?? []).some(
    (d: any) => (d.expression?.callee?.name ?? d.expression?.name) === name,
  );

/** The `alias: 'foo'` member of an options object (`@Input({alias})` / `input(…, {alias})`). */
const aliasFromOptions = (obj: any): string | undefined => {
  if (obj?.type !== 'ObjectExpression') return undefined;
  const alias = (obj.properties ?? []).find(
    (p: any) => (p?.key?.name ?? p?.key?.value) === 'alias',
  )?.value;
  return alias?.type === 'Literal' && typeof alias.value === 'string' ? alias.value : undefined;
};

/**
 * The public input name for an @Input()-decorated member: the alias when one is given
 * (`@Input('foo')` / `@Input({ alias: 'foo' })`), else the property/accessor name. The alias is the
 * template-binding name, so it's what a Figma property axis should line up against.
 */
const angularInputName = (member: any, keyName: string): string => {
  const arg0 = (member.decorators ?? []).find(
    (d: any) => (d.expression?.callee?.name ?? d.expression?.name) === 'Input',
  )?.expression?.arguments?.[0];
  if (arg0?.type === 'Literal' && typeof arg0.value === 'string') return arg0.value;
  return aliasFromOptions(arg0) ?? keyName;
};

/** True for a signal-input field initializer: input(), input.required(), model(), model.required(). */
const isSignalInput = (value: any): boolean => {
  if (value?.type !== 'CallExpression') return false;
  const callee = value.callee;
  const base = callee?.type === 'MemberExpression' ? callee.object?.name : callee?.name;
  return base === 'input' || base === 'model';
};

/**
 * The public name of a signal input. Like the decorator form it can be aliased, but the options
 * object sits in a different argument slot — after the initial value for `input(init, {alias})`,
 * first for the required form `input.required({alias})`. Reading the field name instead of the
 * alias would line the Figma axis up against a name the template never binds.
 */
const signalInputName = (value: any, keyName: string): string => {
  const isRequired = value.callee?.type === 'MemberExpression';
  const options = isRequired ? value.arguments?.[0] : value.arguments?.[1];
  return aliasFromOptions(options) ?? keyName;
};

/**
 * Inputs declared in the `@Component({ inputs: [...] })` metadata rather than on the members. The
 * pre-decorator style is still valid and still appears in real code; each entry is either a plain
 * field name or the `'field: alias'` mapping, whose alias is the bound name.
 */
const metadataInputNames = (cls: any): string[] => {
  const decorator = (cls.decorators ?? []).find(
    (d: any) => (d.expression?.callee?.name ?? d.expression?.name) === 'Component',
  );
  const arg0 = decorator?.expression?.arguments?.[0];
  if (arg0?.type !== 'ObjectExpression') return [];
  const inputs = (arg0.properties ?? []).find(
    (p: any) => (p?.key?.name ?? p?.key?.value) === 'inputs',
  )?.value;
  if (inputs?.type !== 'ArrayExpression') return [];
  return (inputs.elements ?? [])
    .flatMap((e: any) => {
      if (e?.type === 'Literal' && typeof e.value === 'string') {
        const [field, alias] = e.value.split(':');
        return [(alias ?? field ?? '').trim()];
      }
      // Object form: { name: 'field', alias: 'bound' }
      if (e?.type === 'ObjectExpression') {
        const name = (e.properties ?? []).find(
          (p: any) => (p?.key?.name ?? p?.key?.value) === 'name',
        )?.value;
        const bound =
          aliasFromOptions(e) ??
          (name?.type === 'Literal' && typeof name.value === 'string' ? name.value : undefined);
        return bound === undefined ? [] : [bound];
      }
      return [];
    })
    .filter((n: string) => n.length > 0);
};

/**
 * Public input names of an @Component class — decorator, signal, and metadata forms alike.
 *
 * An Angular component can also inherit inputs from a base class. When that base is declared in the
 * same file its inputs are folded in; when it's imported (or reached through a namespace / mixin
 * call) we can't see them, so the result is flagged incomplete — the class's OWN inputs are still
 * returned, since those are read facts, and the join reports proven matches off an incomplete list
 * while claiming nothing about the rest.
 */
const angularInputs = (
  cls: any,
  classes: Map<string, any>,
  seen: Set<string> = new Set(),
): PropsResult => {
  const names = new Set<string>(metadataInputNames(cls));
  for (const member of cls.body?.body ?? []) {
    const keyName = member?.key?.name;
    if (typeof keyName !== 'string') continue;
    if (hasDecorator(member, 'Input')) names.add(angularInputName(member, keyName));
    else if (member.type === 'PropertyDefinition' && isSignalInput(member.value))
      names.add(signalInputName(member.value, keyName));
  }
  const sup = cls.superClass;
  if (sup != null) {
    // Anything other than a local class name — `extends NS.Base`, `extends mixin(Base)` — hides
    // inputs just as an imported base does, so it's incomplete rather than "no inherited inputs".
    if (sup.type !== 'Identifier' || typeof sup.name !== 'string')
      return { names: [...names], extracted: false };
    if (seen.has(sup.name)) return { names: [...names], extracted: true }; // cycle guard
    const base = classes.get(sup.name);
    if (base === undefined) return { names: [...names], extracted: false }; // imported base
    const inherited = angularInputs(base, classes, new Set([...seen, sup.name]));
    for (const n of inherited.names) names.add(n);
    if (!inherited.extracted) return { names: [...names], extracted: false };
  }
  return { names: [...names], extracted: true };
};

/** Index a file's class declarations by name, so an `extends Base` in the same file resolves. */
const collectClassDeclarations = (program: any): Map<string, any> => {
  const classes = new Map<string, any>();
  for (const node of program?.body ?? []) {
    const d =
      node?.type === 'ExportNamedDeclaration' || node?.type === 'ExportDefaultDeclaration'
        ? node.declaration
        : node;
    if (d?.type === 'ClassDeclaration' && typeof d.id?.name === 'string') classes.set(d.id.name, d);
  }
  return classes;
};

/** Strip Angular's conventional `Component` class-name suffix so it matches suffix-free Figma names. */
const angularLogicalName = (className: string): string =>
  className.endsWith('Component') && className.length > 'Component'.length
    ? className.slice(0, -'Component'.length)
    : className;

/**
 * Extract Angular components from one file's source. A component is an exported class carrying the
 * `@Component` decorator (`@Injectable` / `@Directive` / `@Pipe` and plain classes are skipped).
 * Inputs come from both eras: classic `@Input()` (incl. aliases and `set` accessor inputs) and
 * signal inputs (`input()` / `input.required()` / `model()`). Standalone vs NgModule doesn't change
 * detection — both declare the component with `@Component`, it only changes how codegen imports it.
 * The class name's conventional `Component` suffix is stripped for the join (so `ButtonComponent`
 * matches a Figma `Button`); the importable class symbol is that name + `Component`.
 */
export const extractAngularComponents = (filePath: string, code: string): ScannedComponent[] => {
  let program: any;
  try {
    program = parseSync(filePath, code).program;
  } catch {
    return [];
  }
  const classes = collectClassDeclarations(program);
  const out: ScannedComponent[] = [];
  for (const node of program.body ?? []) {
    if (node.type !== 'ExportNamedDeclaration' && node.type !== 'ExportDefaultDeclaration')
      continue;
    const cls = node.declaration;
    if (cls?.type !== 'ClassDeclaration' || !hasDecorator(cls, 'Component')) continue;
    const className = cls.id?.name;
    if (typeof className !== 'string') continue;
    const inputs = angularInputs(cls, classes);
    out.push({
      name: angularLogicalName(className),
      filePath,
      exportKind: node.type === 'ExportDefaultDeclaration' ? 'default' : 'named',
      propNames: inputs.names,
      propsExtracted: inputs.extracted,
      framework: 'angular',
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

/**
 * Prop names from a `defineProps` call: a type argument (literal OR a named type), an object, or an
 * array of string keys. Returns null when the call declares props we can't fully read (a type
 * imported from another file), so the caller can report them as unextracted instead of empty.
 */
const definePropsNames = (call: any, table: TypeTable): string[] | null => {
  // Type form: defineProps<{ size?: string }>() or defineProps<Props>(). oxc exposes the
  // instantiation as typeArguments (older trees: typeParameters). The named form is by far the more
  // common in real code — it's what `withDefaults` and every generic component use.
  const typeArgs = call.typeArguments ?? call.typeParameters;
  const typeArg = typeArgs?.params?.[0];
  if (typeArg != null) return resolveTypeMembers(typeArg, table);

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

/**
 * The prop a `defineModel()` call declares (Vue 3.4+). It's a real prop on the public API —
 * `defineModel()` is `modelValue`, `defineModel('title')` is `title` — and a v-model binding is
 * exactly the kind of thing a Figma variant axis lines up against, so missing it understates the
 * component. The options-object form (`defineModel({ required: true })`) still means modelValue.
 */
const defineModelName = (call: any): string => {
  const arg0 = call.arguments?.[0];
  return arg0?.type === 'Literal' && typeof arg0.value === 'string' ? arg0.value : 'modelValue';
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

/**
 * Svelte prop names: `export let foo` (Svelte 4) and `$props()` (Svelte 5 runes). The runes form
 * appears three ways in real code — destructured, type-annotated, or typed via a generic argument —
 * and the latter two carry the props in a named type, so they resolve through the type table.
 * Returns null when a `$props()` declares a type we can't fully read (imported), so the SFC path
 * can mark props unextracted rather than empty.
 */
const sveltePropNames = (program: any, table: TypeTable): PropsResult => {
  const names = new Set<string>();
  let unresolved = false;
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
  // Svelte 5 runes: a declarator initialized by $props().
  for (const node of program.body ?? []) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations ?? []) {
      if (d?.init?.type !== 'CallExpression' || d.init.callee?.name !== '$props') continue;
      // `let { a, b } = $props()` — the destructuring pattern names the props directly.
      if (d.id?.type === 'ObjectPattern') {
        for (const p of d.id.properties ?? [])
          if (p?.type === 'Property' && typeof p.key?.name === 'string') names.add(p.key.name);
        continue;
      }
      // `let props: Props = $props()` / `let props = $props<Props>()` — read the named type.
      const typeArg = d.init.typeArguments?.params?.[0] ?? d.id?.typeAnnotation?.typeAnnotation;
      const resolved = resolveTypeMembers(typeArg, table);
      if (resolved === null) unresolved = true;
      else for (const n of resolved) names.add(n);
    }
  }
  // An unreadable `$props()` type doesn't erase props read elsewhere in the block (`export let`).
  return { names: [...names], extracted: !unresolved };
};

/* eslint-enable @typescript-eslint/no-explicit-any */

const REACT_EXTS = new Set(['.tsx', '.jsx']);

// The virtual source name handed to oxc: it is what selects the dialect, so a block's `lang` has to
// reach it intact. `sfc.tsx` parses both `defineProps<{…}>()` and JSX, which is why lang="tsx" gets
// its own entry rather than collapsing onto `ts`.
const VIRTUAL_SOURCE: Record<ScriptLang, string> = {
  js: 'sfc.js',
  jsx: 'sfc.jsx',
  ts: 'sfc.ts',
  tsx: 'sfc.tsx',
};

/**
 * Extract a single-file component (Vue / Svelte). The file is the component (its name is the file
 * by convention); props come from the <script> block — Vue's defineProps (type / object / array
 * forms) and Options-API `props`, Svelte's `export let` / `$props()`.
 *
 * PropsExtracted distinguishes "[] = genuinely no props" from "[] = unknown" so the join won't
 * invent extension TODOs. It's true when we read the props, or the file is a script-less (so
 * genuinely prop-less) template. It stays false when a script is present but the props couldn't be
 * fully read — a parse error, a prop type imported from another file, a `lang` we have no parser
 * for, a `src=` block whose source is another file, an unclosed block, or a declaration style we
 * don't recognize (conservative: the join then suppresses matched/unmatched rather than asserting
 * prop gaps we can't actually see).
 *
 * A block that fails to parse still contributes whatever oxc recovered — dropping it would narrow
 * detection — but it flips propsExtracted to false, because a recovered AST is exactly the case
 * where claiming a complete list would be the false claim the field exists to prevent.
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
  const { blocks, unterminated } = scanSfcScripts(code, { templateIsBlock: framework === 'vue' });
  // Set when a props declaration was found but couldn't be fully resolved (an imported type), so an
  // empty/partial list is never reported as a complete one. A file the scanner could not fully
  // delimit starts it true: content went unread, and saying "none" there is the same false claim
  // as an empty parse.
  let unresolved = unterminated;

  if (blocks.length === 0) {
    // A template with no script really has no props.
    return [{ ...base, propNames: [], propsExtracted: !unresolved }];
  }

  // Parse every block first: a type is routinely declared in `<script>` and consumed in `<script
  // setup>`, so the type table has to span the whole SFC before any block is read for props.
  const programs: any[] = [];
  for (const block of blocks) {
    // `src` puts the real source in another file and `lang: null` is a dialect we have no parser
    // for. Either way the block's props are unread, and its (empty) body would say "none".
    if (block.external || block.lang === null) {
      unresolved = true;
      continue;
    }
    try {
      const parsed = parseSync(VIRTUAL_SOURCE[block.lang], block.body);
      if (parsed.errors.length > 0) unresolved = true;
      programs.push(parsed.program);
    } catch {
      // oxc recovers rather than throwing, but this reads other people's repositories — a block we
      // cannot parse at all is unread, never "prop-less".
      unresolved = true;
    }
  }
  const table: TypeTable = new Map();
  for (const program of programs)
    for (const [name, decl] of collectTypeDeclarations(program)) table.set(name, decl);

  const names = new Set<string>();
  for (const program of programs) {
    if (framework === 'vue') {
      for (const call of collectCalls(program)) {
        const callee = (call as { callee?: { name?: string } }).callee?.name;
        if (callee === 'defineProps') {
          const resolved = definePropsNames(call, table);
          if (resolved === null) unresolved = true;
          else for (const n of resolved) names.add(n);
        } else if (callee === 'defineModel') {
          names.add(defineModelName(call));
        }
      }
      for (const n of vueOptionsPropsNames(program)) names.add(n);
    } else {
      const resolved = sveltePropNames(program, table);
      if (!resolved.extracted) unresolved = true;
      for (const n of resolved.names) names.add(n);
    }
  }
  // Read the props → confidently extracted. Nothing found, or a type we couldn't chase → unknown.
  return [{ ...base, propNames: [...names], propsExtracted: !unresolved && names.size > 0 }];
};

const frameworkForExt = (ext: string): ComponentFramework | null => {
  if (REACT_EXTS.has(ext)) return 'react';
  if (ext === '.vue') return 'vue';
  if (ext === '.svelte') return 'svelte';
  // .ts is only globbed for an Angular project (its componentExtensions), so it never collides with
  // the React/Vue/Svelte extensions above; a non-component .ts simply yields no @Component classes.
  if (ext === '.ts') return 'angular';
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
    else if (framework === 'angular') out.push(...extractAngularComponents(rel, code));
    else out.push(...extractSfcComponent(rel, code, framework));
  }
  return out;
};
