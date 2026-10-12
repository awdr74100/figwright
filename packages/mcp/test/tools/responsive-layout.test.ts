import { resolveResponsiveLayoutConfig, ResponsiveLayoutConfigSchema } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import {
  configureResponsiveLayoutTool,
  getResponsiveLayoutTool,
} from '../../src/tools/responsive-layout.js';
import { toToolDefinition } from '../tool-schema.js';

describe('responsive public tools', () => {
  it('advertises strict public responsive schema', () => {
    const schema = toToolDefinition(configureResponsiveLayoutTool).inputSchema as any;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['enabled']);
    const config = schema.properties.config;
    expect(config.additionalProperties).toBe(false);
    expect(config.properties.version.const).toBe(1);
    expect(config.properties.breakpointPreset.enum).toEqual(['standard', 'none']);
    expect(config.properties.roots).toMatchObject({ minItems: 1, maxItems: 32 });
    const root = config.properties.roots.items;
    expect(root.properties.base.maxItems).toBe(128);
    expect(root.properties.breakpoints).toMatchObject({ minItems: 1, maxItems: 24 });
    expect(
      root.properties.base.items.oneOf.map((s: any) => s.properties.type.const).toSorted(),
    ).toEqual(['componentProperties', 'grid', 'layout', 'visibility']);
    expect(root.properties.breakpoints.items.anyOf.map((s: any) => s.required)).toEqual([
      ['at', 'overrides'],
      ['minWidth', 'overrides'],
    ]);
    expect(
      root.properties.breakpoints.items.anyOf.every((s: any) => s.additionalProperties === false),
    ).toBe(true);
    expect(JSON.stringify(schema)).not.toMatch(
      /fileName|mainId|sidebar|fitRules|responsive_layout_v1/,
    );
    expect(configureResponsiveLayoutTool.kind).toBe('write');
    expect(getResponsiveLayoutTool.kind).toBe('read');
    expect(toToolDefinition(getResponsiveLayoutTool).inputSchema).toMatchObject({
      properties: {},
      additionalProperties: false,
    });
  });
  it('rejects selectors and cross-field ownership through actual parsing and resolution', () => {
    const config = {
      version: 1,
      pageId: 'p',
      roots: [{ rootId: 'r', base: [], breakpoints: [{ at: 'base', minWidth: 0, overrides: [] }] }],
    };
    expect(ResponsiveLayoutConfigSchema.safeParse(config).success).toBe(false);
    expect(() =>
      resolveResponsiveLayoutConfig({
        ...config,
        version: 1,
        roots: [{ rootId: 'r', base: [], breakpoints: [{ at: 'unknown', overrides: [] }] }],
      }),
    ).toThrow(Error);
    expect(
      configureResponsiveLayoutTool.inputSchema.safeParse({ enabled: false, fileName: 'legacy' })
        .success,
    ).toBe(false);
  });
});
