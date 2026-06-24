import type { MutateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createSetInstancePropertiesHandler } from '../../src/handlers/set-instance-properties.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('set_instance_properties handler', () => {
  it('calls setProperties with the verbatim map and returns the instance id', async () => {
    const setProperties = vi.fn<(p: unknown) => void>();
    const instance = { id: 'I:1', type: 'INSTANCE', setProperties };
    const props = {
      Size: 'Large',
      'Disabled#1:2': true,
      'Label#2:0': 'Sign in',
      'Color#4:0': { type: 'VARIABLE_ALIAS', id: 'VariableID:9' },
    };
    const result = (await createSetInstancePropertiesHandler(fakeFigma({ 'I:1': instance }))({
      instanceId: 'I:1',
      properties: props,
    })) as MutateResult;
    expect(result).toEqual({ ok: true, nodeId: 'I:1' });
    expect(setProperties).toHaveBeenCalledWith(props);
  });

  it('throws for a non-instance node', async () => {
    const comp = { id: 'C:1', type: 'COMPONENT' };
    await expect(
      createSetInstancePropertiesHandler(fakeFigma({ 'C:1': comp }))({
        instanceId: 'C:1',
        properties: { Size: 'L' },
      }),
    ).rejects.toThrow(/not an INSTANCE/);
  });

  it('throws when properties is empty or not an object', async () => {
    const instance = { id: 'I:1', type: 'INSTANCE', setProperties: vi.fn<(p: unknown) => void>() };
    await expect(
      createSetInstancePropertiesHandler(fakeFigma({ 'I:1': instance }))({
        instanceId: 'I:1',
        properties: {},
      }),
    ).rejects.toThrow(/at least one property/);
    await expect(
      createSetInstancePropertiesHandler(fakeFigma({}))({ instanceId: 'I:1' }),
    ).rejects.toThrow(/must be an object map/);
  });
});
