import { TimeSlice } from '../cooperative.js';
import type { SandboxToolHandler } from '../dispatcher.js';
import { childrenOf } from '../traverse.js';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the audit needs from a node, read once so the checks themselves touch no Figma API. */
export interface AuditNode {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  box: Box | null;
  clips: boolean;
  layoutMode: string;
  positioning: string;
  hardcodedFill: boolean;
  fontSize: number | null;
  fontFamily: string | null;
  children: AuditNode[];
}

export type Severity = 'error' | 'warning';

export interface AuditIssue {
  nodeId: string;
  name: string;
  code: string;
  severity: Severity;
  message: string;
  /** The tool call that usually resolves it. */
  fix: string;
}

export interface AuditOptions {
  /** Largest gap, in px, still read as "meant to line up but didn't". */
  nearMiss: number;
}

export interface AuditStats {
  scanned: number;
  hardcodedFills: number;
  fontFamilies: Set<string>;
  fontSizes: Set<number>;
}

const EPS = 0.01;
const OVERFLOW_TOLERANCE = 1;
const CONTAINER_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'SECTION']);

const px = (n: number): string => `${Math.round(n * 100) / 100}px`;

const isAutoLayout = (node: AuditNode): boolean => node.layoutMode !== 'NONE';

/** A child the parent's layout does not position: a free-placed one, or any child of a plain frame. */
const isFreelyPlaced = (parent: AuditNode, child: AuditNode): boolean =>
  !isAutoLayout(parent) || child.positioning === 'ABSOLUTE';

const checkContainer = (node: AuditNode, issues: AuditIssue[], opts: AuditOptions): void => {
  const { box } = node;
  // A hidden child renders nothing, so it cannot overflow, sit off-centre or misalign.
  const children = node.children.filter(c => c.visible);
  const push = (code: string, severity: Severity, message: string, fix: string): void => {
    issues.push({ nodeId: node.id, name: node.name, code, severity, message, fix });
  };

  if (
    node.type === 'FRAME' &&
    children.length > 0 &&
    box !== null &&
    Math.abs(box.width - 100) < EPS &&
    Math.abs(box.height - 100) < EPS
  ) {
    push(
      'default-size',
      'warning',
      'Frame is exactly 100×100 with content — the size Figma gives a new frame, so it was likely never sized.',
      'set_layout_props layoutSizingHorizontal / layoutSizingVertical HUG (or FILL inside a layout)',
    );
  }

  // Overflow / clipping against this container's own box.
  if (box !== null && CONTAINER_TYPES.has(node.type)) {
    for (const child of children) {
      if (child.box === null) continue;
      const sides: string[] = [];
      const over = (name: string, by: number): void => {
        if (by > OVERFLOW_TOLERANCE) sides.push(`${name} by ${px(by)}`);
      };
      over('left', box.x - child.box.x);
      over('top', box.y - child.box.y);
      over('right', child.box.x + child.box.width - (box.x + box.width));
      over('bottom', child.box.y + child.box.height - (box.y + box.height));
      if (sides.length === 0) continue;
      issues.push({
        nodeId: child.id,
        name: child.name,
        code: node.clips ? 'clipped' : 'overflow',
        severity: node.clips ? 'error' : 'warning',
        message: node.clips
          ? `Extends past "${node.name}" (${sides.join(', ')}) and is cut off by its clip.`
          : `Extends past "${node.name}" (${sides.join(', ')}).`,
        fix: 'resize the parent (HUG), or move/resize the child; set_layout_props clipsContent false to show overflow deliberately',
      });
    }
  }

  // Centering that is off by a hair: the child is clearly meant to be centred.
  if (box !== null) {
    for (const child of children) {
      if (child.box === null || !isFreelyPlaced(node, child)) continue;
      const dx = Math.abs(child.box.x + child.box.width / 2 - (box.x + box.width / 2));
      const dy = Math.abs(child.box.y + child.box.height / 2 - (box.y + box.height / 2));
      const axes: string[] = [];
      if (dx > EPS && dx <= opts.nearMiss) axes.push(`${px(dx)} horizontally`);
      if (dy > EPS && dy <= opts.nearMiss) axes.push(`${px(dy)} vertically`);
      if (axes.length === 0) continue;
      issues.push({
        nodeId: child.id,
        name: child.name,
        code: 'off-center',
        severity: 'warning',
        message: `Almost centred in "${node.name}" but off by ${axes.join(' and ')}.`,
        fix: 'align_nodes horizontal / vertical CENTER',
      });
    }
  }

  // Sibling edges that nearly coincide.
  const placed = children.filter(c => c.box !== null && isFreelyPlaced(node, c));
  if (placed.length >= 2) {
    const edges: [string, (b: Box) => number][] = [
      ['left', b => b.x],
      ['right', b => b.x + b.width],
      ['top', b => b.y],
      ['bottom', b => b.y + b.height],
    ];
    for (const [label, read] of edges) {
      const sorted = placed.toSorted((a, b) => read(a.box!) - read(b.box!));
      for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1]!;
        const next = sorted[i]!;
        const gap = read(next.box!) - read(prev.box!);
        if (gap > EPS && gap <= opts.nearMiss) {
          issues.push({
            nodeId: next.id,
            name: next.name,
            code: 'edge-misaligned',
            severity: 'warning',
            message: `${label} edge is ${px(gap)} off "${prev.name}" — close enough to look like a mistake.`,
            fix: 'align_nodes with relativeTo SELECTION on both nodes',
          });
        }
      }
    }
  }
};

/**
 * Run every check over a normalized tree. Pure: the caller does the Figma reads, so this is what
 * the tests drive with plain objects. Invisible nodes and everything under them are skipped.
 */
export const auditTree = (
  roots: readonly AuditNode[],
  opts: AuditOptions,
): { issues: AuditIssue[]; stats: AuditStats } => {
  const issues: AuditIssue[] = [];
  const stats: AuditStats = {
    scanned: 0,
    hardcodedFills: 0,
    fontFamilies: new Set(),
    fontSizes: new Set(),
  };

  const visit = (node: AuditNode): void => {
    if (!node.visible) return;
    stats.scanned += 1;
    if (node.hardcodedFill) stats.hardcodedFills += 1;
    if (node.type === 'TEXT') {
      if (node.fontFamily !== null) stats.fontFamilies.add(node.fontFamily);
      if (node.fontSize !== null) stats.fontSizes.add(node.fontSize);
    }
    if (node.children.length > 0) checkContainer(node, issues, opts);
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);

  const rank: Record<Severity, number> = { error: 0, warning: 1 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { issues, stats };
};

// ── Figma → AuditNode ────────────────────────────────────────────────────────

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);

const isHardcodedFill = (node: SceneNode): boolean => {
  const fills = (node as { fills?: unknown }).fills;
  if (!Array.isArray(fills)) return false;
  const solid = fills.find(
    (p: { type?: string; visible?: boolean }) => p.type === 'SOLID' && p.visible !== false,
  ) as { boundVariables?: { color?: unknown } } | undefined;
  if (solid === undefined) return false;
  if (solid.boundVariables?.color !== undefined) return false;
  const styleId = (node as { fillStyleId?: unknown }).fillStyleId;
  return !(typeof styleId === 'string' && styleId !== '');
};

const normalize = (node: SceneNode, children: AuditNode[]): AuditNode => {
  const n = node as unknown as Record<string, unknown>;
  const layoutMode = typeof n.layoutMode === 'string' ? n.layoutMode : 'NONE';
  const fontName = n.fontName as { family?: string } | symbol | undefined;
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
    box: (n.absoluteBoundingBox as Box | null | undefined) ?? null,
    clips: n.clipsContent === true,
    layoutMode,
    positioning: typeof n.layoutPositioning === 'string' ? n.layoutPositioning : 'AUTO',
    hardcodedFill: isHardcodedFill(node),
    fontSize: num(n.fontSize),
    fontFamily:
      typeof fontName === 'object' && typeof fontName?.family === 'string' ? fontName.family : null,
    children,
  };
};

const MAX_NODES = 5000;

const build = async (
  nodes: readonly SceneNode[],
  budget: { left: number; truncated: boolean },
  slice: TimeSlice,
): Promise<AuditNode[]> => {
  const out: AuditNode[] = [];
  for (const node of nodes) {
    if (budget.left <= 0) {
      budget.truncated = true;
      break;
    }
    budget.left -= 1;
    // An instance is audited where it sits but not inside: its layout is its main component's, so
    // an issue there is fixed in the component, and would otherwise repeat once per instance (and
    // spend the node budget on layers nobody here can edit).
    const kids = node.type === 'INSTANCE' ? null : childrenOf(node);
    // eslint-disable-next-line no-await-in-loop -- the tree is built depth-first, handing the thread back between slices
    if (slice.due()) await slice.yield();
    // eslint-disable-next-line no-await-in-loop -- see above
    const built = kids === null ? [] : await build(kids, budget, slice);
    out.push(normalize(node, built));
  }
  return out;
};

export const createAuditLayoutHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { root?: unknown; maxIssues?: unknown };
    if (p.root !== undefined && typeof p.root !== 'string') {
      throw new TypeError('audit_layout: root must be a node id');
    }
    const maxIssues = typeof p.maxIssues === 'number' ? Math.max(1, Math.floor(p.maxIssues)) : 60;

    let targets: readonly SceneNode[];
    if (typeof p.root === 'string') {
      const node = await figmaCtx.getNodeByIdAsync(p.root);
      if (node === null) throw new Error(`audit_layout: node ${p.root} not found`);
      if (node.type === 'DOCUMENT') {
        throw new Error('audit_layout: root is the document — pass a page id or a node id');
      }
      if (node.type === 'PAGE') {
        targets = (node as PageNode).children;
      } else {
        targets = [node as SceneNode];
      }
    } else {
      const selection = figmaCtx.currentPage.selection;
      targets = selection.length > 0 ? selection : figmaCtx.currentPage.children;
    }

    const budget = { left: MAX_NODES, truncated: false };
    const tree = await build(targets, budget, new TimeSlice());
    const { issues, stats } = auditTree(tree, { nearMiss: 2 });

    const errors = issues.filter(issue => issue.severity === 'error').length;
    const counts = { errors, warnings: issues.length - errors };

    return {
      ok: true,
      scanned: stats.scanned,
      truncated: budget.truncated,
      summary: counts,
      issues: issues.slice(0, maxIssues),
      omitted: Math.max(0, issues.length - maxIssues),
      typography: {
        fontFamilies: [...stats.fontFamilies].toSorted(),
        fontSizes: [...stats.fontSizes].toSorted((a, b) => a - b),
      },
      hardcodedFills: stats.hardcodedFills,
    };
  };
