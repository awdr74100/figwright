import type { GetLocalComponentsResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createGetLocalComponentsHandler } from '../../src/handlers/get-local-components.js';
import { fakeDocumented } from '../documentation-fake.js';

// A container node (frame) whose findAllWithCriteria returns the components/sets in its subtree.
const frame = (id: string, found: unknown[]): unknown => ({
  id,
  type: 'FRAME',
  findAllWithCriteria: () => found,
});

const fakeFigma = (opts: {
  root?: unknown;
  selection?: unknown[];
  lookup?: Record<string, unknown>;
}): typeof figma =>
  ({
    root: opts.root ?? { id: '0:0', type: 'DOCUMENT' },
    currentPage: { selection: opts.selection ?? [] },
    getNodeByIdAsync: async (id: string) => opts.lookup?.[id] ?? null,
  }) as unknown as typeof figma;

const set = {
  type: 'COMPONENT_SET',
  id: 'CS:1',
  name: 'Button',
  key: 'csk',
  description: 'btn',
  variantGroupProperties: {
    Size: { values: ['S', 'L'] },
    State: { values: ['Default', 'Hover'] },
  },
  children: [{ id: 'C:1' }, { id: 'C:2' }],
};
const standalone = {
  type: 'COMPONENT',
  id: 'C:3',
  name: 'Icon',
  key: 'ck3',
  description: '',
  parent: { id: 'P:1' },
  variantProperties: null,
};
const variant = {
  type: 'COMPONENT',
  id: 'C:1',
  name: 'Size=S, State=Default',
  key: 'ck1',
  description: '',
  parent: { id: 'CS:1' },
  variantProperties: { Size: 'S', State: 'Default' },
};

describe('get_local_components handler', () => {
  it('splits components and component sets within the selection subtree, with variant metadata', async () => {
    const handler = createGetLocalComponentsHandler(
      fakeFigma({ selection: [frame('F:1', [set, standalone, variant])] }),
    );
    const result = (await handler({})) as GetLocalComponentsResult;

    expect(result.componentSets).toHaveLength(1);
    expect(result.componentSets[0]).toMatchObject({
      id: 'CS:1',
      componentIds: ['C:1', 'C:2'],
      variantGroupProperties: { Size: { values: ['S', 'L'] } },
    });
    expect(result.components.map(c => c.id)).toEqual(['C:3', 'C:1']);
    expect(result.components.find(c => c.id === 'C:3')?.variantProperties).toBeUndefined();
    expect(result.components.find(c => c.id === 'C:1')?.variantProperties).toEqual({
      Size: 'S',
      State: 'Default',
    });
  });

  // Measured: Figma throws on a set's variantGroupProperties and a variant's variantProperties while
  // the set has errors; one such set used to fail the whole listing (issue #334).
  it('lists a component set with errors, and its variants, with the reason in place of their properties', async () => {
    const throwing = (getter: string, message: string): PropertyDescriptor => ({
      get: () => {
        throw new Error(`in get_${getter}: ${message}`);
      },
    });
    const broken = Object.defineProperty(
      { ...set, id: 'CS:2', variantGroupProperties: undefined },
      'variantGroupProperties',
      throwing('variantGroupProperties', 'Component set has existing errors'),
    );
    const brokenVariant = Object.defineProperty(
      { ...variant, id: 'C:5', parent: { id: 'CS:2' }, variantProperties: undefined },
      'variantProperties',
      throwing('variantProperties', 'Component set for node has existing errors'),
    );
    const handler = createGetLocalComponentsHandler(
      fakeFigma({ selection: [frame('F:1', [set, broken, brokenVariant, standalone])] }),
    );
    const result = (await handler({})) as GetLocalComponentsResult;

    expect(result.componentSets.find(s => s.id === 'CS:2')).toEqual({
      id: 'CS:2',
      name: 'Button',
      key: 'csk',
      description: 'btn',
      componentIds: ['C:1', 'C:2'],
      componentSetError: 'Component set has existing errors',
    });
    expect(result.components.find(c => c.id === 'C:5')).toMatchObject({
      componentSetError: 'Component set for node has existing errors',
    });
    expect(result.components.find(c => c.id === 'C:5')).not.toHaveProperty('variantProperties');
    // Everything else comes back whole.
    expect(result.componentSets.find(s => s.id === 'CS:1')?.variantGroupProperties).toEqual(
      set.variantGroupProperties,
    );
    expect(result.components.map(c => c.id)).toEqual(['C:5', 'C:3']);
  });

  it('scopes to an explicit nodeId', async () => {
    const handler = createGetLocalComponentsHandler(
      fakeFigma({ lookup: { 'F:9': frame('F:9', [standalone]) } }),
    );
    const result = (await handler({ nodeId: 'F:9' })) as GetLocalComponentsResult;
    expect(result.components.map(c => c.id)).toEqual(['C:3']);
    expect(result.componentSets).toEqual([]);
  });

  it('dedupes a component found via overlapping roots', async () => {
    const handler = createGetLocalComponentsHandler(
      fakeFigma({ selection: [frame('F:1', [standalone]), frame('F:2', [standalone])] }),
    );
    const result = (await handler({})) as GetLocalComponentsResult;
    expect(result.components.map(c => c.id)).toEqual(['C:3']);
  });

  it('carries markdown that plain text would lose, and the documentation link, when asked', async () => {
    const documented = Object.assign(
      fakeDocumented({
        id: 'C:7',
        descriptionMarkdown: '**Primary** action — see [docs](https://a.com)',
        documentationLinks: [{ uri: 'https://storybook.example.com/button' }],
      }),
      { key: 'k7', parent: { id: 'P:1' }, variantProperties: null },
    );
    const documentedSet = Object.assign(
      fakeDocumented({ id: 'CS:7', type: 'COMPONENT_SET', descriptionMarkdown: '- a\n- b' }),
      { key: 'ks7', variantGroupProperties: {}, children: [] },
    );
    const handler = createGetLocalComponentsHandler(
      fakeFigma({ selection: [frame('F:1', [documented, documentedSet])] }),
    );
    // Off unless asked: the listing reads exactly as before, and pays nothing for the fields.
    const plainListing = (await handler({})) as GetLocalComponentsResult;
    expect(plainListing.components[0]).toEqual({
      id: 'C:7',
      name: 'Button',
      key: 'k7',
      description: 'Primary action — see docs',
      parentId: 'P:1',
    });
    expect(plainListing.componentSets[0]).not.toHaveProperty('descriptionMarkdown');

    const result = (await handler({ documentation: true })) as GetLocalComponentsResult;
    expect(result.components[0]).toEqual({
      id: 'C:7',
      name: 'Button',
      key: 'k7',
      description: 'Primary action — see docs',
      descriptionMarkdown: '**Primary** action — see [docs](https://a.com)',
      documentationLinks: [{ uri: 'https://storybook.example.com/button' }],
      parentId: 'P:1',
    });
    expect(result.componentSets[0]).toMatchObject({
      description: 'a\nb',
      descriptionMarkdown: '- a\n- b',
    });
    expect(result.componentSets[0]).not.toHaveProperty('documentationLinks');
  });

  // The listing of a library without formatting or links must read exactly as it did before.
  it('adds nothing for a plain description without a link, even when asked', async () => {
    const plain = Object.assign(
      fakeDocumented({ id: 'C:8', description: 'kbq-arrow_16\n\ndownload, вниз' }),
      { key: 'k8', parent: { id: 'P:1' }, variantProperties: null },
    );
    const handler = createGetLocalComponentsHandler(
      fakeFigma({ selection: [frame('F:1', [plain])] }),
    );
    const result = (await handler({ documentation: true })) as GetLocalComponentsResult;
    expect(result.components[0]).toEqual({
      id: 'C:8',
      name: 'Button',
      key: 'k8',
      description: 'kbq-arrow_16\n\ndownload, вниз',
      parentId: 'P:1',
    });
  });

  it('throws when nothing is selected and no nodeId is given', async () => {
    await expect(createGetLocalComponentsHandler(fakeFigma({ selection: [] }))({})).rejects.toThrow(
      /Nothing selected/,
    );
  });

  it('rejects a document root with page-scoping guidance before native dynamic-page scanning', async () => {
    const document = {
      id: '0:0',
      type: 'DOCUMENT',
      findAllWithCriteria: () => {
        throw new Error(
          'Cannot call with documentAccess: dynamic-page without calling figma.loadAllPagesAsync() first.',
        );
      },
    };
    const handler = createGetLocalComponentsHandler(fakeFigma({ root: document }));

    await expect(handler({ nodeId: '0:0' })).rejects.toThrow(/get_pages.*page.*nodeId/);
  });

  it('returns page-scoping guidance even when async node resolution cannot connect to Figma', async () => {
    const figmaCtx = fakeFigma({});
    figmaCtx.getNodeByIdAsync = async () => {
      throw new Error('Unable to establish connection to Figma after 10 seconds.');
    };

    await expect(createGetLocalComponentsHandler(figmaCtx)({ nodeId: '0:0' })).rejects.toThrow(
      /get_pages.*page.*nodeId/,
    );
  });
});
