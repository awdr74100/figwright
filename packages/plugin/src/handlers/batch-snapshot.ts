/**
 * Snapshot / restore primitives for the batch inverses.
 *
 * Every rule here exists because the naive inverse — assign the old value back — was measured
 * against a live file and left the document different from how the op found it:
 *
 * - A raw write to a variable-bound node field drops the binding, and assigning the old number back
 *   does not bring it back (opacity, width via resize, itemSpacing, visible, a corner radius under
 *   a uniform write all came back unbound).
 * - Writing fills / strokes / effects / layoutGrids detaches the style that supplied them, even when
 *   the value written is identical; so does a typography write on text. Only the style setter
 *   re-attaches.
 * - Setting `characters` on mixed-style text flattens every run to the first run's style.
 * - `resize()` flips HUG and FILL to FIXED, turns a text node's auto-resize off, and applies
 *   constraints to the children — lossily, once a STRETCH child is squeezed past its margins.
 *   `resizeWithoutConstraints` touches neither the sizing mode nor the children.
 * - Leaving auto-layout (or ABSOLUTE → AUTO → ABSOLUTE) loses the node's position; a min/max clamp
 *   does not undo itself when the bound is cleared.
 *
 * So each snapshot takes what the op writes plus what the write disturbs, and each restore writes
 * only what differs from the snapshot, in an order that keeps every write valid.
 */

type Bag = Record<string, unknown>;

const bagOf = (node: unknown): Bag => node as Bag;

/** Restoring a `figma.mixed` (symbol) value would throw, so those are skipped. */
export const restorable = (value: unknown): boolean => typeof value !== 'symbol';

/** Structural equality over the plain data Figma hands out (frozen objects, arrays, primitives). */
export const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a === 'symbol' || typeof b === 'symbol') return false;
  return JSON.stringify(a) === JSON.stringify(b);
};

/** Assign `value` to `key` unless it already holds it — every restore is write-if-different. */
export const writeIfDifferent = (node: unknown, key: string, value: unknown): void => {
  const bag = bagOf(node);
  if (!(key in bag) || !restorable(value) || same(bag[key], value)) return;
  bag[key] = value;
};

const nodeOrThrow = async (figmaCtx: typeof figma, id: string, what: string): Promise<BaseNode> => {
  const node = await figmaCtx.getNodeByIdAsync(id);
  if (node === null) throw new Error(`${what}: node ${id} no longer exists`);
  return node;
};

// ── Variable bindings ────────────────────────────────────────────────────────

/** The node fields Figma binds on the node itself (`VariableBindableNodeField`). */
export const NODE_BINDABLE_FIELDS = [
  'height',
  'width',
  'characters',
  'itemSpacing',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'visible',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'counterAxisSpacing',
  'strokeWeight',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
  'opacity',
  'gridRowGap',
  'gridColumnGap',
] as const;
const NODE_BINDABLE = new Set<string>(NODE_BINDABLE_FIELDS);

/**
 * Field → the Variable bound to it, or null when the field was unbound. Resolved at capture, not at
 * undo: resolving is an async Figma call that fails for reasons outside the document (measured in a
 * live rollback: "Unable to establish connection to Figma after 10 seconds"), and capture is where
 * a failure costs nothing — no op has run yet. The undo then only assigns.
 */
export type BindingSnapshot = Record<string, Variable | null>;

/** Resolve a bound variable's id, failing loudly when it resolves to nothing. */
export const resolveVariable = async (figmaCtx: typeof figma, id: string): Promise<Variable> => {
  const variable = await figmaCtx.variables.getVariableByIdAsync(id);
  if (variable === null) throw new Error(`bound variable ${id} not found`);
  return variable;
};

const aliasOf = (node: BaseNode, field: string): string | null => {
  const bound = (node as { boundVariables?: Record<string, unknown> }).boundVariables;
  const alias = bound?.[field] as { id?: unknown } | undefined;
  return typeof alias?.id === 'string' ? alias.id : null;
};

export const captureBindings = async (
  figmaCtx: typeof figma,
  node: BaseNode,
  fields: readonly string[],
): Promise<BindingSnapshot> => {
  const bound = fields.filter(field => NODE_BINDABLE.has(field) && field in node);
  const variables = await Promise.all(
    bound.map(async field => {
      const id = aliasOf(node, field);
      return id === null ? null : resolveVariable(figmaCtx, id);
    }),
  );
  const out: BindingSnapshot = {};
  bound.forEach((field, i) => {
    out[field] = variables[i] ?? null;
  });
  return out;
};

type Bindable = { setBoundVariable(field: VariableBindableNodeField, v: Variable | null): void };

/**
 * Unbind what the op bound. Runs BEFORE the raw values go back: unbinding keeps the resolved value,
 * which the raw restore then overwrites.
 */
export const unbindAdded = (node: BaseNode, snapshot: BindingSnapshot): void => {
  for (const [field, variable] of Object.entries(snapshot)) {
    if (variable === null && aliasOf(node, field) !== null) {
      (node as unknown as Bindable).setBoundVariable(field as VariableBindableNodeField, null);
    }
  }
};

/** Re-bind what the op unbound. Runs AFTER the raw values, so the binding wins. */
export const rebind = (node: BaseNode, snapshot: BindingSnapshot): void => {
  for (const [field, variable] of Object.entries(snapshot)) {
    if (variable === null || aliasOf(node, field) === variable.id) continue;
    (node as unknown as Bindable).setBoundVariable(field as VariableBindableNodeField, variable);
  }
};

// ── Style links ──────────────────────────────────────────────────────────────

/** Value property → [style id property, async setter]. The sync setters throw under dynamic-page. */
const STYLE_LINKS: Readonly<Record<string, readonly [string, string]>> = {
  fills: ['fillStyleId', 'setFillStyleIdAsync'],
  strokes: ['strokeStyleId', 'setStrokeStyleIdAsync'],
  effects: ['effectStyleId', 'setEffectStyleIdAsync'],
  layoutGrids: ['gridStyleId', 'setGridStyleIdAsync'],
};

/** Re-attach (or detach) each style to what the snapshot recorded. */
const restoreStyleLinks = async (node: BaseNode, styles: Record<string, string>): Promise<void> => {
  const bag = bagOf(node);
  for (const [idProp, setter] of Object.values(STYLE_LINKS)) {
    const id = styles[idProp];
    if (id === undefined || bag[idProp] === id) continue;
    const fn = bag[setter];
    if (typeof fn !== 'function') continue;
    // eslint-disable-next-line no-await-in-loop -- at most four links; keeps write order stable
    await (fn as (id: string) => Promise<void>).call(node, id);
  }
};

// ── Plain properties (+ the style links and bindings they drag along) ────────

export interface PropsSnapshot {
  values: Bag;
  styles: Record<string, string>;
  bindings: BindingSnapshot;
}

/**
 * Snapshot `props` in order (restore replays that order — e.g. a uniform stroke weight before the
 * per-side weights it would otherwise overwrite), the style id behind any style-backed prop, and
 * the node-level variable bindings of `bindingFields` (defaults to `props`).
 */
export const captureProps = async (
  figmaCtx: typeof figma,
  node: BaseNode,
  props: readonly string[],
  bindingFields: readonly string[] = props,
): Promise<PropsSnapshot> => {
  const bag = bagOf(node);
  const values: Bag = {};
  const styles: Record<string, string> = {};
  for (const prop of props) {
    if (!(prop in node)) continue;
    values[prop] = bag[prop];
    const link = STYLE_LINKS[prop];
    if (link !== undefined && typeof bag[link[0]] === 'string')
      styles[link[0]] = bag[link[0]] as string;
  }
  return { values, styles, bindings: await captureBindings(figmaCtx, node, bindingFields) };
};

export const restoreProps = async (node: BaseNode, snapshot: PropsSnapshot): Promise<void> => {
  unbindAdded(node, snapshot.bindings);
  for (const [prop, value] of Object.entries(snapshot.values)) writeIfDifferent(node, prop, value);
  await restoreStyleLinks(node, snapshot.styles);
  rebind(node, snapshot.bindings);
};

// ── Text ─────────────────────────────────────────────────────────────────────

/** Every per-run field `getStyledTextSegments` reports and a `setRange*` setter can write back. */
export const SEGMENT_FIELDS = [
  'fontName',
  'fontSize',
  'textCase',
  'textDecoration',
  'textDecorationStyle',
  'textDecorationOffset',
  'textDecorationThickness',
  'textDecorationColor',
  'textDecorationSkipInk',
  'lineHeight',
  'letterSpacing',
  'fills',
  'listOptions',
  'listSpacing',
  'indentation',
  'paragraphIndent',
  'paragraphSpacing',
  'textWrapStyle',
  'hyperlink',
  'textStyleId',
  'fillStyleId',
  'boundVariables',
  'openTypeFeatures',
] as const;

/**
 * Node-level text settings, restored in this order: maxLines only takes effect once truncation is
 * ENDING, and truncation only once auto-resize allows it.
 */
const TEXT_NODE_PROPS = [
  'textAlignHorizontal',
  'textAlignVertical',
  'leadingTrim',
  'hangingPunctuation',
  'hangingList',
  'textAutoResize',
  'textTruncation',
  'maxLines',
] as const;

/** Typography an EMPTY text node still carries at node level (it has no runs to hold it). */
const EMPTY_TEXT_PROPS = [
  'fontName',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'textDecoration',
  'paragraphSpacing',
  'paragraphIndent',
  'fills',
] as const;

/** Typography Figma binds per run (`VariableBindableTextField`). */
const TEXT_BINDABLE_FIELDS: readonly VariableBindableTextField[] = [
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'paragraphSpacing',
  'paragraphIndent',
];

const nodeBoundText = (text: TextNode): string[] => {
  const bound = (text as { boundVariables?: Record<string, unknown> }).boundVariables ?? {};
  return TEXT_BINDABLE_FIELDS.filter(f => bound[f] !== undefined);
};

/** Every text field a text snapshot puts back — what a text-writing op may touch must be in here. */
export const TEXT_RESTORED_FIELDS: ReadonlySet<string> = new Set([
  'characters',
  ...SEGMENT_FIELDS,
  ...TEXT_NODE_PROPS,
]);

type Segment = Record<string, unknown> & { start: number; end: number };

export interface TextSnapshot {
  characters: string;
  segments: Segment[];
  node: Bag;
  empty: Bag;
  width: number;
  height: number;
  fonts: FontName[];
  /** Text fields the node itself lists as bound (kept apart from its runs' bindings, measured). */
  nodeBound: string[];
  /** The node-level `characters` binding, which a raw characters write drops. */
  characters_binding: BindingSnapshot;
  /** Every variable a run is bound to, by id — resolved at capture (see {@link BindingSnapshot}). */
  variables: Record<string, Variable>;
}

const fontsOf = (figmaCtx: typeof figma, text: TextNode): FontName[] =>
  text.fontName === figmaCtx.mixed && text.characters.length > 0
    ? [...text.getRangeAllFontNames(0, text.characters.length)]
    : [text.fontName as FontName];

export const loadFonts = async (
  figmaCtx: typeof figma,
  fonts: readonly FontName[],
): Promise<void> => {
  const seen = new Map<string, FontName>();
  for (const f of fonts) seen.set(`${f.family}\u0000${f.style}`, f);
  await Promise.all([...seen.values()].map(async f => figmaCtx.loadFontAsync(f)));
};

export const captureText = async (
  figmaCtx: typeof figma,
  text: TextNode,
): Promise<TextSnapshot> => {
  const bag = bagOf(text);
  const node: Bag = {};
  for (const k of TEXT_NODE_PROPS) if (k in text) node[k] = bag[k];
  const empty: Bag = {};
  if (text.characters.length === 0) for (const k of EMPTY_TEXT_PROPS) empty[k] = bag[k];
  const segments =
    text.characters.length > 0
      ? (text.getStyledTextSegments([...SEGMENT_FIELDS]) as unknown as Segment[])
      : [];
  // The runs' variables are resolved and their faces loaded HERE, so the restore needs neither
  // call: both are async Figma work that can stall or fail long after the ops have been applied.
  const ids = [
    ...new Set(
      segments.flatMap(seg =>
        Object.values((seg.boundVariables ?? {}) as Bag).map(
          alias => (alias as { id?: unknown }).id,
        ),
      ),
    ),
  ].filter((id): id is string => typeof id === 'string');
  const fonts = fontsOf(figmaCtx, text);
  const [resolved, bindings] = await Promise.all([
    Promise.all(ids.map(async id => resolveVariable(figmaCtx, id))),
    captureBindings(figmaCtx, text, ['characters']),
    loadFonts(figmaCtx, fonts),
  ]);
  return {
    characters: text.characters,
    segments,
    node,
    empty,
    width: text.width,
    height: text.height,
    fonts,
    nodeBound: nodeBoundText(text),
    characters_binding: bindings,
    variables: Object.fromEntries(resolved.map(variable => [variable.id, variable])),
  };
};

type RangeWriter = (t: TextNode, s: number, e: number, v: never) => void;

/** Raw per-run setters, in the order they are replayed. Null-valued decoration fields are skipped. */
const RANGE_WRITERS: readonly (readonly [string, RangeWriter])[] = [
  ['fontName', (t, s, e, v) => t.setRangeFontName(s, e, v)],
  ['fontSize', (t, s, e, v) => t.setRangeFontSize(s, e, v)],
  ['textCase', (t, s, e, v) => t.setRangeTextCase(s, e, v)],
  ['textDecoration', (t, s, e, v) => t.setRangeTextDecoration(s, e, v)],
  ['textDecorationStyle', (t, s, e, v) => t.setRangeTextDecorationStyle(s, e, v)],
  ['textDecorationOffset', (t, s, e, v) => t.setRangeTextDecorationOffset(s, e, v)],
  ['textDecorationThickness', (t, s, e, v) => t.setRangeTextDecorationThickness(s, e, v)],
  ['textDecorationColor', (t, s, e, v) => t.setRangeTextDecorationColor(s, e, v)],
  ['textDecorationSkipInk', (t, s, e, v) => t.setRangeTextDecorationSkipInk(s, e, v)],
  ['lineHeight', (t, s, e, v) => t.setRangeLineHeight(s, e, v)],
  ['letterSpacing', (t, s, e, v) => t.setRangeLetterSpacing(s, e, v)],
  ['fills', (t, s, e, v) => t.setRangeFills(s, e, v)],
  ['listOptions', (t, s, e, v) => t.setRangeListOptions(s, e, v)],
  ['listSpacing', (t, s, e, v) => t.setRangeListSpacing(s, e, v)],
  ['indentation', (t, s, e, v) => t.setRangeIndentation(s, e, v)],
  ['paragraphIndent', (t, s, e, v) => t.setRangeParagraphIndent(s, e, v)],
  ['paragraphSpacing', (t, s, e, v) => t.setRangeParagraphSpacing(s, e, v)],
  ['textWrapStyle', (t, s, e, v) => t.setRangeTextWrapStyle(s, e, v)],
  ['hyperlink', (t, s, e, v) => t.setRangeHyperlink(s, e, v)],
];

/** Decoration details that read null while the run has no decoration — nothing to write then. */
const NULLABLE_DETAILS = new Set([
  'textDecorationStyle',
  'textDecorationOffset',
  'textDecorationThickness',
  'textDecorationColor',
  'textDecorationSkipInk',
]);

/** One entry per character: its run's OpenType features, however the runs happen to be grouped. */
const perChar = (
  segs: readonly { start: number; end: number; openTypeFeatures?: unknown }[],
): string[] =>
  segs.flatMap(seg =>
    Array.from({ length: seg.end - seg.start }, () => JSON.stringify(seg.openTypeFeatures)),
  );

/**
 * Put a text node back exactly: characters, then every run's raw values, then the styles and
 * variable bindings those runs carried (a style or binding applied last wins over the raw value,
 * which is what they were doing before), then the node-level settings and the box.
 *
 * Returns a note when a run's `openTypeFeatures` could not be put back — that field has no setter,
 * so if rewriting the characters reset it, nothing can restore it.
 */
export const restoreText = async (
  figmaCtx: typeof figma,
  text: TextNode,
  snapshot: TextSnapshot,
): Promise<string | undefined> => {
  // The snapshot's faces were loaded at capture; the node's current ones may be faces the op
  // introduced, and Figma refuses a characters write while any face on the node is unloaded.
  await loadFonts(figmaCtx, fontsOf(figmaCtx, text));
  unbindAdded(text, snapshot.characters_binding);
  if (text.characters !== snapshot.characters) text.characters = snapshot.characters;

  if (snapshot.segments.length === 0) {
    for (const [k, v] of Object.entries(snapshot.empty)) writeIfDifferent(text, k, v);
  }
  for (const seg of snapshot.segments) {
    for (const [field, write] of RANGE_WRITERS) {
      const value = seg[field];
      // A decoration detail reads null while it does not apply; a null hyperlink is "no link" and
      // must be written — rewriting the characters spreads the first run's link to every run.
      if (value === undefined || (value === null && NULLABLE_DETAILS.has(field))) continue;
      write(text, seg.start, seg.end, value as never);
    }
  }
  // A node-level text binding is recorded apart from the runs it drives: writing every run's raw
  // value back leaves the node still listing it (measured). Drop what the snapshot did not list,
  // before the runs' own bindings go back.
  const stale = nodeBoundText(text).filter(f => !snapshot.nodeBound.includes(f));
  for (const field of stale) text.setBoundVariable(field as VariableBindableTextField, null);
  /* eslint-disable no-await-in-loop -- style setters and bindings resolve in run order */
  for (const seg of snapshot.segments) {
    // The async style setters are slow in a live file (seconds, not milliseconds), so each is only
    // called where the replay above actually left the run's style different from the snapshot.
    const textStyleId = seg.textStyleId as string;
    if (text.getRangeTextStyleId(seg.start, seg.end) !== textStyleId) {
      await text.setRangeTextStyleIdAsync(seg.start, seg.end, textStyleId);
    }
    const fillStyleId = seg.fillStyleId as string;
    if (text.getRangeFillStyleId(seg.start, seg.end) !== fillStyleId) {
      await text.setRangeFillStyleIdAsync(seg.start, seg.end, fillStyleId);
    }
    for (const [field, alias] of Object.entries((seg.boundVariables ?? {}) as Bag)) {
      const id = (alias as { id?: unknown }).id;
      if (typeof id !== 'string') continue;
      const variable = snapshot.variables[id];
      if (variable === undefined) {
        throw new Error(`variable ${id} bound to ${field} was not captured`);
      }
      text.setRangeBoundVariable(seg.start, seg.end, field as VariableBindableTextField, variable);
    }
  }
  /* eslint-enable no-await-in-loop */

  rebind(text, snapshot.characters_binding);

  // A fixed or height-only box keeps whatever size the op left it at unless it is put back; the
  // resize turns auto-resize off, which the node-level replay below turns back on.
  const autoResize = snapshot.node.textAutoResize;
  if (
    autoResize !== 'WIDTH_AND_HEIGHT' &&
    (text.width !== snapshot.width || text.height !== snapshot.height)
  ) {
    text.resizeWithoutConstraints(snapshot.width, snapshot.height);
  }
  for (const k of TEXT_NODE_PROPS) writeIfDifferent(text, k, snapshot.node[k]);

  if (snapshot.segments.length === 0) return undefined;
  // Compared per character: the snapshot's runs split on every field, a fresh read on one, so
  // run boundaries alone would differ even when every character's features match.
  const drifted = !same(
    perChar(text.getStyledTextSegments(['openTypeFeatures'])),
    perChar(snapshot.segments),
  );
  return drifted
    ? `text ${text.id} keeps changed OpenType features (Figma exposes no setter to restore them)`
    : undefined;
};

// ── Geometry & placement ─────────────────────────────────────────────────────

const inFlow = (node: SceneNode): boolean => {
  const parent = node.parent as (BaseNode & { layoutMode?: string }) | null;
  return (
    parent !== null &&
    typeof parent.layoutMode === 'string' &&
    parent.layoutMode !== 'NONE' &&
    (node as { layoutPositioning?: string }).layoutPositioning !== 'ABSOLUTE'
  );
};

/** A GROUP / BOOLEAN_OPERATION's box is derived from its children; it is never written directly. */
const derivedBox = (node: BaseNode): boolean =>
  node.type === 'GROUP' || node.type === 'BOOLEAN_OPERATION';

const MIN_MAX = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const;
/** The primitives `layoutSizingHorizontal/Vertical` are shorthand for — written directly. */
const SIZING = [
  'layoutGrow',
  'layoutAlign',
  'primaryAxisSizingMode',
  'counterAxisSizingMode',
] as const;
const GRID_CHILD = [
  'gridRowSpan',
  'gridColumnSpan',
  'gridChildHorizontalAlign',
  'gridChildVerticalAlign',
] as const;

export interface GeometrySnapshot {
  id: string;
  width: number;
  height: number;
  transform: Transform;
  layout: Bag;
  grid: { row: number; column: number } | null;
}

export const captureGeometry = (node: SceneNode): GeometrySnapshot => {
  const bag = bagOf(node);
  const layout: Bag = {};
  for (const k of [
    ...MIN_MAX,
    'layoutPositioning',
    ...SIZING,
    'textAutoResize',
    'constraints',
    ...GRID_CHILD,
  ]) {
    if (k in node) layout[k] = bag[k];
  }
  const parent = node.parent as (BaseNode & { layoutMode?: string }) | null;
  const grid =
    parent?.layoutMode === 'GRID' && 'gridRowAnchorIndex' in node
      ? { row: bag.gridRowAnchorIndex as number, column: bag.gridColumnAnchorIndex as number }
      : null;
  return {
    id: node.id,
    width: node.width,
    height: node.height,
    transform: node.relativeTransform,
    layout,
    grid,
  };
};

/**
 * Put a node's box back. Bounds first, so they cannot clamp the size; positioning next, since a
 * position only means anything once the node is ABSOLUTE again. Then the sizing primitives, BEFORE
 * the size: a size written while the node is still FILL/STRETCH is overridden by the layout
 * (measured — a node stretched to 100 kept 100 when 40 was written first and its stretch undone
 * after). Writing a size turns auto-sizing off (a text node's auto-resize, measured), so the
 * primitives go back once more after it. The transform last, and only where the position is the
 * node's own rather than the layout's.
 */
export const restoreGeometry = (node: SceneNode, snapshot: GeometrySnapshot): void => {
  const L = snapshot.layout;
  const restoreSizing = (): void => {
    for (const k of SIZING) if (k in L) writeIfDifferent(node, k, L[k]);
    if ('textAutoResize' in L) writeIfDifferent(node, 'textAutoResize', L.textAutoResize);
  };
  for (const k of MIN_MAX) if (k in L) writeIfDifferent(node, k, L[k]);
  if ('layoutPositioning' in L) writeIfDifferent(node, 'layoutPositioning', L.layoutPositioning);
  restoreSizing();
  if (!derivedBox(node) && (node.width !== snapshot.width || node.height !== snapshot.height)) {
    (node as LayoutMixin).resizeWithoutConstraints(snapshot.width, snapshot.height);
    restoreSizing();
  }
  if (!inFlow(node) && !derivedBox(node) && !same(node.relativeTransform, snapshot.transform)) {
    (node as LayoutMixin).relativeTransform = snapshot.transform;
  }
  if ('constraints' in L) writeIfDifferent(node, 'constraints', L.constraints);
  const bag = bagOf(node);
  if (
    snapshot.grid !== null &&
    (bag.gridRowAnchorIndex !== snapshot.grid.row ||
      bag.gridColumnAnchorIndex !== snapshot.grid.column)
  ) {
    (node as unknown as GridChildrenMixin).setGridChildPosition(
      snapshot.grid.row,
      snapshot.grid.column,
    );
  }
  for (const k of GRID_CHILD) if (k in L) writeIfDifferent(node, k, L[k]);
};

// ── Layout drift ─────────────────────────────────────────────────────────────

/** Snapshot of every box a size change can move by constraints, within the affected region. */
export type LayoutScope = GeometrySnapshot[];

const isAutoLayout = (node: BaseNode | null | undefined): boolean =>
  node !== null &&
  node !== undefined &&
  typeof (node as { layoutMode?: unknown }).layoutMode === 'string' &&
  (node as { layoutMode: string }).layoutMode !== 'NONE';

/** A node Figma sizes/places from its parent by constraints — or whose box is not derived at all. */
const ownsBox = (node: SceneNode): boolean =>
  !inFlow(node) && !derivedBox(node) && !node.id.startsWith('I') && 'relativeTransform' in node;

/**
 * An op that changes one box can move others: a HUG frame grows with its content, its FILL siblings
 * give way, and constrained children of every resized frame are pushed — lossily once squeezed. The
 * region that can move is the node's layout-coupled ancestry (climb while the parent is
 * auto-layout) and everything below its top; snapshot each box in it that is placed by constraints.
 * In-flow boxes are re-derived by the layout, and instance sublayers by their main, so neither is
 * recorded.
 */
export const captureLayoutScope = async (
  figmaCtx: typeof figma,
  ids: readonly string[],
): Promise<LayoutScope> => {
  const roots = new Map<string, SceneNode>();
  const nodes = await Promise.all(ids.map(async id => figmaCtx.getNodeByIdAsync(id)));
  for (const node of nodes) {
    if (node === null || !('parent' in node) || node.type === 'PAGE' || node.type === 'DOCUMENT')
      continue;
    let top = node as SceneNode;
    while (isAutoLayout(top.parent) && top.parent!.type !== 'PAGE') {
      top = top.parent as SceneNode;
    }
    roots.set(top.id, top);
  }
  const scope: LayoutScope = [];
  const seen = new Set<string>();
  for (const root of roots.values()) {
    const all: SceneNode[] = [root];
    if ('findAll' in root) all.push(...(root as ChildrenMixin).findAll(() => true));
    for (const n of all) {
      if (seen.has(n.id) || !ownsBox(n)) continue;
      seen.add(n.id);
      scope.push(captureGeometry(n));
    }
  }
  return scope;
};

/**
 * Put back every recorded box that drifted. Two passes: restoring one box can re-derive a HUG
 * ancestor and push an already-restored constrained sibling again; the second pass settles it.
 */
export const restoreLayoutDrift = async (
  figmaCtx: typeof figma,
  scope: LayoutScope,
): Promise<void> => {
  if (scope.length === 0) return;
  const nodes = await Promise.all(scope.map(async s => figmaCtx.getNodeByIdAsync(s.id)));
  for (let pass = 0; pass < 2; pass += 1) {
    scope.forEach((snap, i) => {
      const node = nodes[i] as SceneNode | null;
      if (node === null || node.removed) return;
      if (
        node.width !== snap.width ||
        node.height !== snap.height ||
        !same(node.relativeTransform, snap.transform)
      ) {
        restoreGeometry(node, snap);
      }
    });
  }
};

// ── Placement in the tree ────────────────────────────────────────────────────

export interface Placement {
  parentId: string;
  geometry: GeometrySnapshot;
  name: string;
}

export const capturePlacement = (node: SceneNode): Placement => {
  if (node.parent === null) throw new Error(`node ${node.id} has no parent`);
  return { parentId: node.parent.id, geometry: captureGeometry(node), name: node.name };
};

/** A container's child order, by id. */
export const captureOrder = (parent: BaseNode & ChildrenMixin): string[] =>
  parent.children.map(c => c.id);

/**
 * Rebuild `ids` as the leading children of `parentId`, in order. Placing ascending is what makes
 * `insertChild` unambiguous: each node moves to an index at or before where it sits, so its own
 * removal never shifts the target (measured: insertChild counts the index before removing the
 * node). Nodes that are not in `ids` — e.g. one a later op created and whose own undo removes it —
 * end up after them.
 */
export const restoreOrder = async (
  figmaCtx: typeof figma,
  parentId: string,
  ids: readonly string[],
): Promise<void> => {
  const parent = (await nodeOrThrow(figmaCtx, parentId, 'restore order')) as BaseNode &
    ChildrenMixin;
  const nodes = await Promise.all(ids.map(async id => nodeOrThrow(figmaCtx, id, 'restore order')));
  nodes.forEach((node, pos) => {
    if (parent.children[pos]?.id !== node.id) parent.insertChild(pos, node as SceneNode);
  });
};
