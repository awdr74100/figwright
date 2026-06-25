import type { MutateResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createSetArcHandler } from '../../src/handlers/set-arc.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

const fullDisc = () => ({ startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0 });

describe('set_arc handler', () => {
  it('sets the full arc data (a half-circle pie)', async () => {
    const node = { id: '1:1', arcData: fullDisc() };
    const handler = createSetArcHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({
      nodeId: '1:1',
      startingAngle: 0,
      endingAngle: Math.PI,
      innerRadius: 0,
    })) as MutateResult;
    expect(node.arcData).toEqual({ startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 });
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('merges a partial update over the current arc (a donut keeps its angles)', async () => {
    const node = { id: '1:1', arcData: { startingAngle: 0.5, endingAngle: 2, innerRadius: 0 } };
    const handler = createSetArcHandler(fakeFigma({ '1:1': node }));
    await handler({ nodeId: '1:1', innerRadius: 0.6 });
    expect(node.arcData).toEqual({ startingAngle: 0.5, endingAngle: 2, innerRadius: 0.6 });
  });

  it('rejects out-of-range innerRadius, no fields, and non-ellipse nodes', async () => {
    const handler = createSetArcHandler(
      fakeFigma({ '1:1': { id: '1:1', arcData: fullDisc() }, '2:2': { id: '2:2' } }),
    );
    await expect(handler({ nodeId: '1:1', innerRadius: 1.5 })).rejects.toThrow(/innerRadius/);
    await expect(handler({ nodeId: '1:1', innerRadius: -0.1 })).rejects.toThrow(/innerRadius/);
    await expect(handler({ nodeId: '1:1' })).rejects.toThrow(/at least one/);
    await expect(handler({ nodeId: '2:2', innerRadius: 0.5 })).rejects.toThrow(/not.*ellipse/);
    await expect(handler({ nodeId: '9:9', innerRadius: 0.5 })).rejects.toThrow(/not found/);
  });
});
