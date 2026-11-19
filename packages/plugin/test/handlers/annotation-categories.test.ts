import { describe, expect, it } from 'vitest';

import {
  createCreateAnnotationCategoryHandler,
  createDeleteAnnotationCategoryHandler,
  createUpdateAnnotationCategoryHandler,
} from '../../src/handlers/annotation-categories.js';

/** A category as Figma's behaves: any setLabel / setColor — the same value included — ends a preset. */
const category = (
  over: Partial<{ id: string; label: string; color: string; isPreset: boolean }> = {},
) => {
  const c = {
    id: '127:0',
    label: 'Development',
    color: 'green',
    isPreset: true,
    removed: false,
    writes: [] as string[],
    setLabel(label: string) {
      c.writes.push('label');
      c.label = label;
      c.isPreset = false;
    },
    setColor(color: string) {
      c.writes.push('color');
      c.color = color;
      c.isPreset = false;
    },
    remove() {
      c.removed = true;
    },
    ...over,
  };
  return c;
};

const fakeFigma = (c: unknown) =>
  ({
    annotations: {
      getAnnotationCategoryByIdAsync: async (id: string) =>
        (c as { id: string } | null)?.id === id ? c : null,
      addAnnotationCategoryAsync: async ({ label, color }: { label: string; color: string }) =>
        category({ id: '134:1', label, color, isPreset: false }),
    },
  }) as unknown as typeof figma;

describe('annotation category handlers', () => {
  it('creates a category', async () => {
    expect(
      await createCreateAnnotationCategoryHandler(fakeFigma(null))({
        label: 'Analytics',
        color: 'teal',
      }),
    ).toEqual({
      ok: true,
      categoryId: '134:1',
      label: 'Analytics',
      color: 'teal',
      isPreset: false,
    });
  });

  it('refuses an empty label or an unknown colour before anything is written', async () => {
    const run = createCreateAnnotationCategoryHandler(fakeFigma(null));
    await expect(run({ label: '', color: 'red' })).rejects.toThrow(
      'create_annotation_category: label must be a non-empty string',
    );
    await expect(run({ label: '  ', color: 'red' })).rejects.toThrow(
      'label must be a non-empty string',
    );
    await expect(run({ label: 'x', color: 'purple' })).rejects.toThrow(
      'create_annotation_category: color must be one of yellow / orange / red / pink / violet / blue / teal / green',
    );
  });

  it('renames and recolours, writing only what differs — a write of the same value ends a preset', async () => {
    const c = category();
    const run = createUpdateAnnotationCategoryHandler(fakeFigma(c));
    expect(await run({ categoryId: '127:0', label: 'Development', color: 'green' })).toEqual({
      ok: true,
      categoryId: '127:0',
      label: 'Development',
      color: 'green',
      isPreset: true,
    });
    expect(c.writes).toEqual([]);
    expect(await run({ categoryId: '127:0', color: 'blue' })).toMatchObject({
      color: 'blue',
      isPreset: false,
    });
    expect(c.writes).toEqual(['color']);
  });

  it("refuses a nameless category, which Figma's setLabel would accept", async () => {
    const c = category();
    await expect(
      createUpdateAnnotationCategoryHandler(fakeFigma(c))({ categoryId: '127:0', label: '' }),
    ).rejects.toThrow('update_annotation_category: label must be a non-empty string');
    expect(c.writes).toEqual([]);
  });

  it('deletes a category, and refuses one that is not there', async () => {
    const c = category({ id: '134:1', label: 'Analytics', isPreset: false });
    expect(
      await createDeleteAnnotationCategoryHandler(fakeFigma(c))({ categoryId: '134:1' }),
    ).toEqual({
      ok: true,
      categoryId: '134:1',
      label: 'Analytics',
    });
    expect(c.removed).toBe(true);
    await expect(
      createDeleteAnnotationCategoryHandler(fakeFigma(c))({ categoryId: '9:9' }),
    ).rejects.toThrow('delete_annotation_category: annotation category 9:9 not found');
    await expect(createDeleteAnnotationCategoryHandler(fakeFigma(c))({})).rejects.toThrow(
      'categoryId must be a string',
    );
  });
});
