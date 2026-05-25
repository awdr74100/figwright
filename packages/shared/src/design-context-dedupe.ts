import type {
  DesignContextMetrics,
  DesignContextNode,
  GetDesignContextResult,
  GlobalVars,
} from './design-context.js';
import type { SerializedColor, SerializedColorStop, SerializedPaint } from './serialized-node.js';

/** JSON with sorted object keys, so equal-but-differently-ordered values hash identically. */
const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).toSorted()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });

/** FNV-1a 32-bit → base36. Deterministic content hash → stable, diffable style ids across runs. */
const hashString = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const channel = (n: number): string =>
  Math.round(clamp01(n) * 255)
    .toString(16)
    .padStart(2, '0');

/** {r,g,b}(+optional alpha 0–1) → #RRGGBB or #RRGGBBAA (alpha only when < 1). Universal color literal. */
const toHex = (c: SerializedColor, alpha?: number): string => {
  const base = `#${channel(c.r)}${channel(c.g)}${channel(c.b)}`;
  const withAlpha = alpha !== undefined && alpha < 1 ? base + channel(alpha) : base;
  return withAlpha.toUpperCase();
};

interface SimplifiedPaint {
  type: string;
  color?: string;
  gradientStops?: { position: number; color: string }[];
  visible?: false;
}

/** Convert a serialized paint to a structured, codegen-friendly form (SOLID → hex). */
const simplifyPaint = (paint: SerializedPaint): SimplifiedPaint => {
  const out: SimplifiedPaint = { type: paint.type };
  if (paint.type === 'SOLID') {
    out.color = toHex(paint.color, paint.opacity);
  } else if ('gradientStops' in paint) {
    out.gradientStops = paint.gradientStops.map((s: SerializedColorStop) => ({
      position: s.position,
      color: toHex(s.color, s.color.a),
    }));
  }
  if (paint.visible === false) out.visible = false;
  return out;
};

interface TextStyleBundle {
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
}

/**
 * Replace repeated inline style values (paint arrays, typography) with refs into a content-hash
 * keyed `globalVars.styles` table. A style shared by N nodes becomes one entry + N refs.
 */
export const dedupeStyles = (
  nodes: readonly DesignContextNode[],
): { nodes: DesignContextNode[]; globalVars: GlobalVars } => {
  const styles: Record<string, unknown> = {};
  const byValue = new Map<string, string>(); // stableStringify(value) → id

  const register = (value: unknown, prefix: string): string => {
    const key = stableStringify(value);
    const cached = byValue.get(key);
    if (cached !== undefined) return cached;
    // Collision guard: same hash, different value → suffix until free.
    let id = `${prefix}_${hashString(key)}`;
    let n = 1;
    while (styles[id] !== undefined && stableStringify(styles[id]) !== key) {
      id = `${prefix}_${hashString(key)}_${n++}`;
    }
    styles[id] = value;
    byValue.set(key, id);
    return id;
  };

  const transform = (n: DesignContextNode): DesignContextNode => {
    const out: DesignContextNode = { ...n };

    if (Array.isArray(n.fills) && n.fills.length > 0) {
      out.fill = register(n.fills.map(simplifyPaint), 'fill');
      delete out.fills;
    }

    if (
      typeof n.fontSize === 'number' &&
      n.fontName !== undefined &&
      typeof n.fontName === 'object' &&
      'family' in n.fontName
    ) {
      const bundle: TextStyleBundle = {
        fontFamily: n.fontName.family,
        fontStyle: n.fontName.style,
        fontSize: n.fontSize,
      };
      out.textStyle = register(bundle, 'text');
      delete out.fontSize;
      delete out.fontName;
    }

    if (n.children) out.children = n.children.map(transform);
    return out;
  };

  return { nodes: nodes.map(transform), globalVars: { styles } };
};

const countTree = (nodes: readonly DesignContextNode[]): { nodeCount: number; maxDepth: number } => {
  let nodeCount = 0;
  let maxDepth = 0;
  const walk = (n: DesignContextNode, depth: number): void => {
    nodeCount++;
    if (depth > maxDepth) maxDepth = depth;
    if (n.children) for (const c of n.children) walk(c, depth + 1);
  };
  for (const n of nodes) walk(n, 1);
  return { nodeCount, maxDepth };
};

const sizeKb = (value: unknown): number => Number((JSON.stringify(value).length / 1024).toFixed(2));

/** Measure the simplification — chiefly inline (pre-dedup) vs deduped byte size. */
export const computeMetrics = (
  inlineNodes: readonly DesignContextNode[],
  result: Pick<GetDesignContextResult, 'nodes' | 'globalVars' | 'variables' | 'styles'>,
): DesignContextMetrics => {
  const { nodeCount, maxDepth } = countTree(result.nodes);
  return {
    nodeCount,
    maxDepth,
    styleCount: result.globalVars ? Object.keys(result.globalVars.styles).length : 0,
    tokenCount:
      Object.keys(result.variables ?? {}).length + Object.keys(result.styles ?? {}).length,
    inlineSizeKb: sizeKb(inlineNodes),
    dedupedSizeKb: sizeKb({ nodes: result.nodes, globalVars: result.globalVars }),
  };
};
