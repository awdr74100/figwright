import { describe, expect, it } from 'vitest';

import {
  type AuditNode,
  auditTree,
  createAuditLayoutHandler,
} from '../../src/handlers/audit-layout.js';

const OPTS = { nearMiss: 2 };

let counter = 0;
const node = (over: Partial<AuditNode> & { box?: AuditNode['box'] } = {}): AuditNode => {
  counter += 1;
  return {
    id: `1:${counter}`,
    name: `n${counter}`,
    type: 'FRAME',
    visible: true,
    box: { x: 0, y: 0, width: 400, height: 200 },
    clips: false,
    layoutMode: 'NONE',
    positioning: 'AUTO',
    hardcodedFill: false,
    fontSize: null,
    fontFamily: null,
    children: [],
    ...over,
  };
};

const rect = (x: number, y: number, width: number, height: number, over: Partial<AuditNode> = {}) =>
  node({ type: 'RECTANGLE', box: { x, y, width, height }, ...over });

const codes = (nodes: AuditNode[]): string[] => auditTree(nodes, OPTS).issues.map(i => i.code);

describe('audit_layout checks', () => {
  it('reports nothing for a clean layout', () => {
    const parent = node({ children: [rect(150, 80, 100, 40)] });
    expect(codes([parent])).toEqual([]);
  });

  it('flags a frame left at the default 100×100 that holds content', () => {
    const f = node({
      box: { x: 0, y: 0, width: 100, height: 100 },
      children: [rect(10, 10, 20, 20)],
    });
    expect(codes([f])).toContain('default-size');
    // An empty 100×100 is just a box, not a forgotten size.
    expect(codes([node({ box: { x: 0, y: 0, width: 100, height: 100 } })])).toEqual([]);
  });

  it('flags a clipped child as an error and an unclipped overflow as a warning', () => {
    const clipped = node({ clips: true, children: [rect(350, 0, 100, 40)] });
    const loose = node({ clips: false, children: [rect(350, 0, 100, 40)] });
    const a = auditTree([clipped], OPTS).issues.find(i => i.code === 'clipped');
    const b = auditTree([loose], OPTS).issues.find(i => i.code === 'overflow');
    expect(a).toMatchObject({ severity: 'error' });
    expect(a?.message).toMatch(/right by 50px/);
    expect(b).toMatchObject({ severity: 'warning' });
  });

  it('ignores sub-pixel overflow', () => {
    const f = node({ children: [rect(-0.25, 0, 400.5, 200)] });
    expect(codes([f])).toEqual([]);
  });

  it('flags a child that is almost but not exactly centred', () => {
    const f = node({ children: [rect(151.5, 80, 100, 40)] }); // centre is 1.5px right of 200
    const issue = auditTree([f], OPTS).issues.find(i => i.code === 'off-center');
    expect(issue?.message).toMatch(/1\.5px horizontally/);
    expect(issue?.fix).toMatch(/align_nodes/);
  });

  it('does not call a clearly different position off-centre, nor an auto-layout child', () => {
    expect(codes([node({ children: [rect(20, 80, 100, 40)] })])).not.toContain('off-center');
    const flow = node({ layoutMode: 'VERTICAL', children: [rect(151.5, 80, 100, 40)] });
    expect(codes([flow])).not.toContain('off-center');
  });

  it('flags sibling edges a pixel or two apart, but not exact matches or real gaps', () => {
    const near = node({ children: [rect(10, 10, 50, 20), rect(11, 60, 50, 20)] });
    expect(codes([near])).toContain('edge-misaligned');
    const exact = node({ children: [rect(10, 10, 50, 20), rect(10, 60, 50, 20)] });
    expect(codes([exact])).not.toContain('edge-misaligned');
    const far = node({ children: [rect(10, 10, 50, 20), rect(40, 60, 50, 20)] });
    expect(codes([far])).not.toContain('edge-misaligned');
  });

  it('skips invisible nodes and everything under them', () => {
    const hidden = node({ visible: false, clips: true, children: [rect(900, 0, 10, 10)] });
    expect(codes([hidden])).toEqual([]);
    expect(auditTree([hidden], OPTS).stats.scanned).toBe(0);
  });

  it('ignores a hidden child under a visible parent', () => {
    const hiddenChild = rect(150, 10, 100, 50, { visible: false });
    const f = node({ clips: true, box: { x: 0, y: 0, width: 200, height: 200 } });
    f.children = [hiddenChild];
    expect(codes([f])).toEqual([]);
    // …and a hidden sibling cannot make a visible one look misaligned either.
    const g = node({ children: [rect(10, 10, 50, 20), rect(11, 60, 50, 20, { visible: false })] });
    expect(codes([g])).toEqual([]);
  });

  it('raises no judgement of taste: spacing scale, padding symmetry or type sizes', () => {
    const text = (size: number) => node({ type: 'TEXT', fontSize: size, fontFamily: 'Inter' });
    const f = node({
      layoutMode: 'VERTICAL',
      children: [10, 11, 12, 13, 14, 16, 18, 20].map(text),
    });
    expect(codes([f])).toEqual([]);
  });

  it('counts hardcoded fills and collects the fonts in use', () => {
    const t = node({ type: 'TEXT', fontSize: 16, fontFamily: 'Inter', hardcodedFill: true });
    const { stats } = auditTree(
      [node({ children: [t, rect(0, 0, 5, 5, { hardcodedFill: true })] })],
      OPTS,
    );
    expect(stats.hardcodedFills).toBe(2);
    expect([...stats.fontFamilies]).toEqual(['Inter']);
  });

  it('orders errors before warnings', () => {
    const loose = node({ clips: false, children: [rect(350, 0, 100, 40)] });
    const clipped = node({ clips: true, children: [rect(350, 0, 100, 40)] });
    const severities = auditTree([loose, clipped], OPTS).issues.map(i => i.severity);
    expect(severities).toEqual(['error', 'warning']);
  });
});

describe('audit_layout handler', () => {
  const figmaNode = (id: string, over: Record<string, unknown> = {}, children?: unknown[]) => ({
    id,
    name: id,
    type: 'FRAME',
    visible: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 },
    clipsContent: true,
    layoutMode: 'NONE',
    fills: [],
    strokes: [],
    ...(children === undefined ? {} : { children }),
    ...over,
  });

  const ctx = (nodes: Record<string, unknown>, selection: unknown[] = [], page: unknown[] = []) =>
    ({
      getNodeByIdAsync: async (id: string) => nodes[id] ?? null,
      currentPage: { selection, children: page },
    }) as unknown as typeof figma;

  it('audits a root by id and reports a clipped child with a summary', async () => {
    const child = figmaNode('1:2', {
      type: 'RECTANGLE',
      absoluteBoundingBox: { x: 380, y: 0, width: 100, height: 40 },
    });
    const root = figmaNode('1:1', {}, [child]);
    const result = (await createAuditLayoutHandler(ctx({ '1:1': root }))({ root: '1:1' })) as {
      ok: boolean;
      scanned: number;
      summary: { errors: number };
      issues: { code: string; nodeId: string }[];
    };
    expect(result.ok).toBe(true);
    expect(result.scanned).toBe(2);
    expect(result.summary.errors).toBe(1);
    expect(result.issues[0]).toMatchObject({ code: 'clipped', nodeId: '1:2' });
  });

  it('falls back to the selection, then to the page, when no root is given', async () => {
    const a = figmaNode('1:1');
    const b = figmaNode('2:1');
    const fromSelection = (await createAuditLayoutHandler(ctx({}, [a], [b]))({})) as {
      scanned: number;
    };
    expect(fromSelection.scanned).toBe(1);
    const fromPage = (await createAuditLayoutHandler(ctx({}, [], [a, b]))({})) as {
      scanned: number;
    };
    expect(fromPage.scanned).toBe(2);
  });

  it('caps the issues it returns and says how many were left out', async () => {
    const kids = Array.from({ length: 5 }, (_, i) =>
      figmaNode(`1:${i + 2}`, {
        type: 'RECTANGLE',
        absoluteBoundingBox: { x: 390, y: 0, width: 50, height: 10 },
      }),
    );
    const root = figmaNode('1:1', {}, kids);
    const result = (await createAuditLayoutHandler(ctx({ '1:1': root }))({
      root: '1:1',
      maxIssues: 2,
    })) as { issues: unknown[]; omitted: number };
    expect(result.issues).toHaveLength(2);
    expect(result.omitted).toBe(3);
  });

  it('reads a bound or styled fill as tokenised and a raw one as hardcoded', async () => {
    const solid = { type: 'SOLID', visible: true };
    const raw = figmaNode('1:2', { type: 'RECTANGLE', fills: [solid], fillStyleId: '' });
    const bound = figmaNode('1:3', {
      type: 'RECTANGLE',
      fills: [{ ...solid, boundVariables: { color: { id: 'v' } } }],
      fillStyleId: '',
    });
    const styled = figmaNode('1:4', { type: 'RECTANGLE', fills: [solid], fillStyleId: 'S:1' });
    const root = figmaNode('1:1', {}, [raw, bound, styled]);
    const result = (await createAuditLayoutHandler(ctx({ '1:1': root }))({ root: '1:1' })) as {
      hardcodedFills: number;
    };
    expect(result.hardcodedFills).toBe(1);
  });

  it('rejects a missing node and a non-string root', async () => {
    await expect(createAuditLayoutHandler(ctx({}))({ root: '9:9' })).rejects.toThrow(/not found/);
    await expect(createAuditLayoutHandler(ctx({}))({ root: 5 })).rejects.toThrow(/node id/);
  });

  it('audits an instance where it sits but not inside it', async () => {
    const inner = figmaNode('I2:1;3:2', {
      type: 'RECTANGLE',
      absoluteBoundingBox: { x: 900, y: 0, width: 100, height: 40 },
      fills: [{ type: 'SOLID', visible: true }],
      fillStyleId: '',
    });
    const instance = figmaNode(
      '2:1',
      { type: 'INSTANCE', absoluteBoundingBox: { x: 350, y: 0, width: 100, height: 40 } },
      [inner],
    );
    const root = figmaNode('1:1', {}, [instance]);
    const result = (await createAuditLayoutHandler(ctx({ '1:1': root }))({ root: '1:1' })) as {
      scanned: number;
      issues: { code: string; nodeId: string }[];
      hardcodedFills: number;
    };
    expect(result.issues.map(i => [i.code, i.nodeId])).toEqual([['clipped', '2:1']]);
    expect(result.scanned).toBe(2);
    expect(result.hardcodedFills).toBe(0);
  });

  it('refuses the document as a root', async () => {
    const doc = { id: '0:0', type: 'DOCUMENT', children: [] };
    await expect(createAuditLayoutHandler(ctx({ '0:0': doc }))({ root: '0:0' })).rejects.toThrow(
      /pass a page id/,
    );
  });
});
