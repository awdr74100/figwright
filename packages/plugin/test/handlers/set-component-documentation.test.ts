import type { ComponentDocumentationResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { snapshotDocumentation } from '../../src/documentation.js';
import { createSetComponentDocumentationHandler } from '../../src/handlers/set-component-documentation.js';
import { fakeDocumented } from '../documentation-fake.js';

const fakeFigma = (nodes: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => nodes[id] ?? null }) as unknown as typeof figma;

const run = async (nodes: Record<string, unknown>, params: unknown) =>
  (await createSetComponentDocumentationHandler(fakeFigma(nodes))(
    params,
  )) as ComponentDocumentationResult;

describe('set_component_documentation handler', () => {
  it('sets a plain description, as the issue that asked for it would', async () => {
    const node = fakeDocumented();
    const text =
      'kbq-arrow-down-to-bracket_16\n\ndownload, export, вниз\n\npt-icons-download-alt_16';
    const result = await run({ 'C:1': node }, { nodeId: 'C:1', description: text });
    expect(result).toEqual({ ok: true, nodeId: 'C:1' });
    expect(node.description).toBe(text);
  });

  it('sets a component set and a variant independently', async () => {
    const set = fakeDocumented({ id: 'S:1', type: 'COMPONENT_SET' });
    const variant = fakeDocumented({ id: 'V:1', parent: set });
    await run({ 'S:1': set, 'V:1': variant }, { nodeId: 'S:1', descriptionMarkdown: '**set**' });
    await run({ 'S:1': set, 'V:1': variant }, { nodeId: 'V:1', description: 'variant' });
    expect([set.descriptionMarkdown, variant.description]).toEqual(['**set**', 'variant']);
  });

  it('refuses a plain description that would wipe formatting, and changes nothing', async () => {
    const node = fakeDocumented({
      descriptionMarkdown: '**Use** for [primary](https://a.com)',
      documentationLinks: [{ uri: 'https://old.com' }],
    });
    const before = snapshotDocumentation(node);
    await expect(
      run(
        { 'C:1': node },
        {
          nodeId: 'C:1',
          description: 'Use for primary',
          documentationLinks: [{ uri: 'https://new.com' }],
        },
      ),
    ).rejects.toThrow(
      /carries what plain text cannot — its markdown is "\*\*Use\*\* for \[primary\]\(https:\/\/a\.com\)".*replaceFormatting: true.*Nothing was changed/,
    );
    expect(snapshotDocumentation(node)).toEqual(before);
  });

  it('replaces formatting with plain text when told to', async () => {
    const node = fakeDocumented({ descriptionMarkdown: '**Use** for [primary](https://a.com)' });
    const result = await run(
      { 'C:1': node },
      { nodeId: 'C:1', description: 'Use for primary', replaceFormatting: true },
    );
    expect(result).toEqual({ ok: true, nodeId: 'C:1' });
    expect(node.descriptionMarkdown).toBe('Use for primary');
  });

  // Measured on a description typed in the Figma editor: its paragraph breaks read back as three
  // newlines, and Figma's plain setter takes those literally — an extra blank line per paragraph.
  it("refuses a typed description's paragraphs sent back as read, and takes them with one blank line", async () => {
    const typed = 'kbq-arrow\\_16\n\ndownload, вниз\n\npt-icons\\_16';
    const node = fakeDocumented({ descriptionMarkdown: typed });
    expect(node.description).toBe('kbq-arrow_16\n\n\ndownload, вниз\n\n\npt-icons_16');

    await expect(
      run({ 'C:1': node }, { nodeId: 'C:1', description: node.description }),
    ).rejects.toThrow(/paragraph breaks/);
    expect(node.descriptionMarkdown).toBe(typed);

    const result = await run(
      { 'C:1': node },
      { nodeId: 'C:1', description: 'kbq-arrow_16\n\ndownload, вниз\n\npt-icons_16' },
    );
    expect(result).toEqual({ ok: true, nodeId: 'C:1' });
    expect(node.descriptionMarkdown).toBe(typed);
  });

  it('validates replaceFormatting', async () => {
    await expect(
      run({ 'C:1': fakeDocumented() }, { nodeId: 'C:1', description: 'x', replaceFormatting: 1 }),
    ).rejects.toThrow(/replaceFormatting must be a boolean/);
  });

  it('takes a plain description over one that had no formatting', async () => {
    const node = fakeDocumented({ description: 'a_b [x](y)' });
    const result = await run({ 'C:1': node }, { nodeId: 'C:1', description: 'c_d' });
    expect(result.adjusted).toBeUndefined();
  });

  it('reports what Figma stored differently from what was sent', async () => {
    const node = fakeDocumented();
    const plain = await run({ 'C:1': node }, { nodeId: 'C:1', description: '  padded\r\n' });
    expect(node.description).toBe('padded');
    expect(plain.adjusted).toMatch(/^description was stored as "padded"/);

    const truncated = await run({ 'C:1': node }, { nodeId: 'C:1', description: 'keep\0lost' });
    expect(node.description).toBe('keep');
    expect(truncated.adjusted).toMatch(/NUL/);

    const markdown = await run({ 'C:1': node }, { nodeId: 'C:1', descriptionMarkdown: '_it_' });
    expect(markdown.adjusted).toMatch(/^descriptionMarkdown was stored as "\*it\*"/);
  });

  it('takes both forms when they agree, as get_local_components reports them', async () => {
    const source = fakeDocumented({ descriptionMarkdown: '**bold** [l](https://a.com)\n\np2' });
    const node = fakeDocumented({ description: 'old' });
    const result = await run(
      { 'C:1': node },
      {
        nodeId: 'C:1',
        description: source.description,
        descriptionMarkdown: source.descriptionMarkdown,
      },
    );
    expect(result).toEqual({ ok: true, nodeId: 'C:1' });
    expect(snapshotDocumentation(node)).toEqual(snapshotDocumentation(source));
  });

  it('refuses both forms when they disagree, and leaves the node as it was', async () => {
    const node = fakeDocumented({
      descriptionMarkdown: '**old** text',
      documentationLinks: [{ uri: 'https://old.com' }],
    });
    const before = snapshotDocumentation(node);
    await expect(
      run(
        { 'C:1': node },
        {
          nodeId: 'C:1',
          description: 'new text',
          descriptionMarkdown: '**old** text',
          documentationLinks: [{ uri: 'https://new.com' }],
        },
      ),
    ).rejects.toThrow(/description and descriptionMarkdown disagree/);
    expect(snapshotDocumentation(node)).toEqual(before);
  });

  it('sets, replaces and clears the documentation link', async () => {
    const node = fakeDocumented();
    await run({ 'C:1': node }, { nodeId: 'C:1', documentationLinks: [{ uri: 'https://a.com' }] });
    expect(node.documentationLinks).toEqual([{ uri: 'https://a.com' }]);
    await run({ 'C:1': node }, { nodeId: 'C:1', documentationLinks: [] });
    expect(node.documentationLinks).toEqual([]);
  });

  it('refuses a second link before writing anything', async () => {
    const node = fakeDocumented({ description: 'kept' });
    await expect(
      run(
        { 'C:1': node },
        {
          nodeId: 'C:1',
          description: 'new',
          documentationLinks: [{ uri: 'https://a.com' }, { uri: 'https://b.com' }],
        },
      ),
    ).rejects.toThrow(/at most one link/);
    expect(node.description).toBe('kept');
  });

  it("passes Figma's refusal of a link through and leaves the description untouched", async () => {
    const node = fakeDocumented({ description: 'kept' });
    await expect(
      run(
        { 'C:1': node },
        { nodeId: 'C:1', description: 'new', documentationLinks: [{ uri: 'www.a.com' }] },
      ),
    ).rejects.toThrow(/Documentation link must be a URL/);
    expect(node.description).toBe('kept');
  });

  it('puts the link back when a later write fails', async () => {
    const node = fakeDocumented({ documentationLinks: [{ uri: 'https://old.com' }] });
    Object.defineProperty(node, 'description', {
      get: () => '',
      set: () => {
        throw new Error('in set_description: unexpected');
      },
    });
    await expect(
      run(
        { 'C:1': node },
        { nodeId: 'C:1', description: 'x', documentationLinks: [{ uri: 'https://new.com' }] },
      ),
    ).rejects.toThrow(/unexpected/);
    expect(node.documentationLinks).toEqual([{ uri: 'https://old.com' }]);
  });

  it("passes the editor's refusal through untouched (Dev Mode)", async () => {
    const node = fakeDocumented({ description: 'kept' });
    for (const field of ['description', 'descriptionMarkdown', 'documentationLinks']) {
      const value = (node as unknown as Record<string, unknown>)[field];
      Object.defineProperty(node, field, {
        get: () => value,
        set: () => {
          throw new Error(`in set_${field}: Can't set "${field}" in read-only mode`);
        },
      });
    }
    await expect(run({ 'C:1': node }, { nodeId: 'C:1', description: 'x' })).rejects.toThrow(
      /in set_description: Can't set "description" in read-only mode/,
    );
  });

  it("points an instance at its main component, and a variant's set", async () => {
    const set = { id: 'S:1', type: 'COMPONENT_SET' };
    const main = { id: 'V:1', type: 'COMPONENT', remote: false, parent: set };
    const instance = { id: 'I:1', type: 'INSTANCE', getMainComponentAsync: async () => main };
    await expect(run({ 'I:1': instance }, { nodeId: 'I:1', description: 'x' })).rejects.toThrow(
      'node I:1 is an INSTANCE; documentation belongs to its main component V:1, a variant of ' +
        'component set S:1',
    );

    const library = { id: 'L:1', type: 'COMPONENT', remote: true, parent: null };
    const libraryInstance = { ...instance, getMainComponentAsync: async () => library };
    await expect(
      run({ 'I:1': libraryInstance }, { nodeId: 'I:1', description: 'x' }),
    ).rejects.toThrow(/main component L:1, which comes from a library/);

    const orphan = { ...instance, getMainComponentAsync: async () => null };
    await expect(run({ 'I:1': orphan }, { nodeId: 'I:1', description: 'x' })).rejects.toThrow(
      /INSTANCE with no main component/,
    );
  });

  // Figma silently ignores the assignment on these, so without the check the call would answer ok.
  it('refuses a node that has no documentation', async () => {
    const frame = { id: 'F:1', type: 'FRAME', description: undefined };
    await expect(run({ 'F:1': frame }, { nodeId: 'F:1', description: 'x' })).rejects.toThrow(
      'node F:1 is a FRAME; only a component or component set has documentation',
    );
    expect(frame.description).toBeUndefined();
  });

  it('refuses a library component by name', async () => {
    const node = fakeDocumented({ name: 'Icon', remote: true });
    await expect(run({ 'C:1': node }, { nodeId: 'C:1', description: 'x' })).rejects.toThrow(
      'component C:1 "Icon" comes from a library and is read-only here',
    );
  });

  it('validates its arguments', async () => {
    const nodes = { 'C:1': fakeDocumented() };
    await expect(run(nodes, { nodeId: 'C:1' })).rejects.toThrow(/supply at least one/);
    await expect(run(nodes, { description: 'x' })).rejects.toThrow(/nodeId must be a string/);
    await expect(run(nodes, { nodeId: 'C:1', description: 1 })).rejects.toThrow(/description/);
    await expect(run(nodes, { nodeId: 'C:1', descriptionMarkdown: null })).rejects.toThrow(
      /descriptionMarkdown/,
    );
    await expect(run(nodes, { nodeId: 'C:1', documentationLinks: {} })).rejects.toThrow(
      /array of \{ uri \}/,
    );
    await expect(run(nodes, { nodeId: 'C:1', documentationLinks: [{}] })).rejects.toThrow(
      /documentationLinks\[0\]\.uri/,
    );
    await expect(run(nodes, { nodeId: 'X:9', description: 'x' })).rejects.toThrow(/not found/);
  });
});
