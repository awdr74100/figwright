import { describe, expect, it } from 'vitest';

import {
  createAddMeasurementHandler,
  createDeleteMeasurementHandler,
  createUpdateMeasurementHandler,
} from '../../src/handlers/measurements.js';
import { measuredPages } from '../measurements-fake.js';

describe('add_measurement handler', () => {
  it('draws a measurement and returns it as Figma holds it', async () => {
    const { figmaCtx, home } = measuredPages();
    const result = await createAddMeasurementHandler(figmaCtx)({
      startNodeId: '1:1',
      startSide: 'RIGHT',
      endNodeId: '1:2',
      endSide: 'LEFT',
      offset: { type: 'OUTER', fixed: 24 },
      freeText: '  gutter  ',
    });
    expect(result).toEqual({
      ok: true,
      measurementId: '9:0',
      pageId: '0:1',
      start: { nodeId: '1:1', side: 'RIGHT' },
      end: { nodeId: '1:2', side: 'LEFT' },
      offset: { type: 'OUTER', fixed: 24 },
      freeText: '  gutter  ',
    });
    expect(home.list).toHaveLength(1);
  });

  // A page's own addMeasurement takes its own nodes from anywhere (measured), so the user's current
  // page is never switched.
  it("goes on the nodes' own page, without switching the current one", async () => {
    const { figmaCtx, home, other } = measuredPages();
    const result = await createAddMeasurementHandler(figmaCtx)({
      startNodeId: '2:1',
      startSide: 'TOP',
      endNodeId: '2:2',
      endSide: 'BOTTOM',
    });
    expect(result).toMatchObject({ pageId: '0:2', offset: { type: 'INNER', relative: 0 } });
    expect(result).not.toHaveProperty('freeText');
    expect([home.list.length, other.list.length, figmaCtx.currentPage]).toEqual([0, 1, home]);
  });

  it('refuses nodes on two pages, or a node not found, before drawing anything', async () => {
    const { figmaCtx, home, other } = measuredPages();
    const run = createAddMeasurementHandler(figmaCtx);
    await expect(
      run({ startNodeId: '1:1', startSide: 'LEFT', endNodeId: '2:1', endSide: 'LEFT' }),
    ).rejects.toThrow(
      'add_measurement: 1:1 is on page "Home" and 2:1 on page "Other" — a measurement joins two nodes on one page',
    );
    await expect(
      run({ startNodeId: '1:1', startSide: 'LEFT', endNodeId: '9:9', endSide: 'LEFT' }),
    ).rejects.toThrow('add_measurement: node 9:9 not found');
    expect([home.list.length, other.list.length]).toEqual([0, 0]);
  });

  it("passes Figma's own refusals on — an axis mismatch, a group", async () => {
    const { figmaCtx } = measuredPages();
    const run = createAddMeasurementHandler(figmaCtx);
    await expect(
      run({ startNodeId: '1:1', startSide: 'RIGHT', endNodeId: '1:2', endSide: 'TOP' }),
    ).rejects.toThrow('must be on the same axis');
    await expect(
      run({ startNodeId: '1:3', startSide: 'TOP', endNodeId: '1:1', endSide: 'TOP' }),
    ).rejects.toThrow("Can't add measurement to a GROUP node");
  });

  it('checks its arguments', async () => {
    const run = createAddMeasurementHandler(measuredPages().figmaCtx);
    await expect(run({ startSide: 'LEFT', endNodeId: '1:2', endSide: 'LEFT' })).rejects.toThrow(
      'startNodeId must be a string',
    );
    await expect(run({ startNodeId: '1:1', startSide: 'LEFT', endSide: 'LEFT' })).rejects.toThrow(
      'endNodeId must be a string',
    );
    await expect(
      run({ startNodeId: '1:1', startSide: 'MIDDLE', endNodeId: '1:2', endSide: 'LEFT' }),
    ).rejects.toThrow('startSide must be one of TOP / RIGHT / BOTTOM / LEFT');
    await expect(
      run({
        startNodeId: '1:1',
        startSide: 'LEFT',
        endNodeId: '1:2',
        endSide: 'LEFT',
        offset: { type: 'INNER' },
      }),
    ).rejects.toThrow('offset must be { type: "INNER", relative }');
    await expect(
      run({
        startNodeId: '1:1',
        startSide: 'LEFT',
        endNodeId: '1:2',
        endSide: 'LEFT',
        freeText: 1,
      }),
    ).rejects.toThrow('freeText must be a string');
  });
});

describe('update_measurement / delete_measurement handlers', () => {
  it('changes the offset or text, on whichever page it is', async () => {
    const { figmaCtx, other, nodes } = measuredPages();
    other.loaded = true;
    other.addMeasurement(
      { node: nodes.get('2:1')!, side: 'LEFT' },
      { node: nodes.get('2:2')!, side: 'RIGHT' },
    );
    other.loaded = false;
    const run = createUpdateMeasurementHandler(figmaCtx);
    expect(await run({ measurementId: '9:0', freeText: 'gap' })).toMatchObject({
      pageId: '0:2',
      freeText: 'gap',
    });
    expect(
      await run({ measurementId: '9:0', offset: { type: 'INNER', relative: -0.5 }, freeText: '' }),
    ).toEqual({
      ok: true,
      measurementId: '9:0',
      pageId: '0:2',
      start: { nodeId: '2:1', side: 'LEFT' },
      end: { nodeId: '2:2', side: 'RIGHT' },
      offset: { type: 'INNER', relative: -0.5 },
    });
    // Nothing to change: the measurement as it is.
    expect(await run({ measurementId: '9:0' })).toMatchObject({
      offset: { type: 'INNER', relative: -0.5 },
    });
  });

  it('deletes it, and refuses an id no page has', async () => {
    const { figmaCtx, home, nodes } = measuredPages();
    home.addMeasurement(
      { node: nodes.get('1:1')!, side: 'TOP' },
      { node: nodes.get('1:2')!, side: 'TOP' },
    );
    expect(await createDeleteMeasurementHandler(figmaCtx)({ measurementId: '9:0' })).toEqual({
      ok: true,
      measurementId: '9:0',
      pageId: '0:1',
    });
    expect(home.list).toEqual([]);
    await expect(
      createDeleteMeasurementHandler(figmaCtx)({ measurementId: '9:0' }),
    ).rejects.toThrow('delete_measurement: no measurement 9:0 in this file');
    await expect(createUpdateMeasurementHandler(figmaCtx)({ measurementId: 1 })).rejects.toThrow(
      'measurementId must be a string',
    );
  });
});
