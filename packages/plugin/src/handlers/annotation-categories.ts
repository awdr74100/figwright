import type { AnnotationCategoryResult, DeleteAnnotationCategoryResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * The annotation categories a file offers (Figma starts every file with Development, Interaction,
 * Accessibility and Content) — create, rename / recolour, delete. Measured on 2026-11-20:
 *
 * - Colours are yellow / orange / red / pink / violet / blue / teal / green; anything else is
 *   refused.
 * - A label must not be empty on create; setLabel('') is accepted and leaves a nameless category, so
 *   update refuses it. Labels need not be unique — Figma creates a second "Development".
 * - Renaming or recolouring a preset, even to the label or colour it already has, makes it a custom
 *   category for good (isPreset goes false and nothing sets it back; both measured on a fresh
 *   file's presets), so a field that already holds its value is not written.
 * - Deleting one leaves its id on the annotations that used it.
 *
 * Allowed in Dev Mode, like annotations themselves.
 */

const COLORS = ['yellow', 'orange', 'red', 'pink', 'violet', 'blue', 'teal', 'green'] as const;
type Color = (typeof COLORS)[number];

const checkColor = (color: unknown, tool: string): Color => {
  if (!COLORS.includes(color as Color)) {
    throw new TypeError(`${tool}: color must be one of ${COLORS.join(' / ')}`);
  }
  return color as Color;
};

const checkLabel = (label: unknown, tool: string): string => {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new TypeError(`${tool}: label must be a non-empty string`);
  }
  return label;
};

const findCategory = async (
  figmaCtx: typeof figma,
  id: unknown,
  tool: string,
): Promise<AnnotationCategory> => {
  if (typeof id !== 'string') throw new TypeError(`${tool}: categoryId must be a string`);
  const category = await figmaCtx.annotations.getAnnotationCategoryByIdAsync(id);
  if (category === null) throw new Error(`${tool}: annotation category ${id} not found`);
  return category;
};

const resultOf = (category: AnnotationCategory): AnnotationCategoryResult => ({
  ok: true,
  categoryId: category.id,
  label: category.label,
  color: category.color,
  isPreset: category.isPreset,
});

export const createCreateAnnotationCategoryHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const tool = 'create_annotation_category';
    const p = (params ?? {}) as { label?: unknown; color?: unknown };
    const label = checkLabel(p.label, tool);
    const color = checkColor(p.color, tool);
    const category = await figmaCtx.annotations.addAnnotationCategoryAsync({ label, color });
    return resultOf(category);
  };

export const createUpdateAnnotationCategoryHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const tool = 'update_annotation_category';
    const p = (params ?? {}) as { categoryId?: unknown; label?: unknown; color?: unknown };
    const label = p.label === undefined ? undefined : checkLabel(p.label, tool);
    const color = p.color === undefined ? undefined : checkColor(p.color, tool);
    const category = await findCategory(figmaCtx, p.categoryId, tool);
    // Only what differs: a write of the value already there still turns a preset into a custom
    // category, for good.
    if (color !== undefined && category.color !== color) category.setColor(color);
    if (label !== undefined && category.label !== label) category.setLabel(label);
    return resultOf(category);
  };

export const createDeleteAnnotationCategoryHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const tool = 'delete_annotation_category';
    const p = (params ?? {}) as { categoryId?: unknown };
    const category = await findCategory(figmaCtx, p.categoryId, tool);
    const result: DeleteAnnotationCategoryResult = {
      ok: true,
      categoryId: category.id,
      label: category.label,
    };
    category.remove();
    return result;
  };
