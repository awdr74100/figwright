import { z } from 'zod';

import type { ToolSpec } from './spec.js';

const COLOR = z
  .enum(['yellow', 'orange', 'red', 'pink', 'violet', 'blue', 'teal', 'green'])
  .describe("The category's colour in Dev Mode");

export const createAnnotationCategoryTool: ToolSpec = {
  name: 'create_annotation_category',
  description:
    'Add an annotation category to the file — what set_annotations files a note under (Figma ' +
    'starts every file with Development, Interaction, Accessibility and Content). Labels need not ' +
    'be unique, so check get_annotations categories first. Works in Dev Mode too. Returns { ok, ' +
    'categoryId, label, color, isPreset }.',
  inputSchema: z.object({
    label: z.string().describe('The category name, e.g. "Analytics"'),
    color: COLOR,
  }),
  kind: 'write',
};

export const updateAnnotationCategoryTool: ToolSpec = {
  name: 'update_annotation_category',
  description:
    'Rename or recolour an annotation category; either field may be omitted, and a field already ' +
    "holding its value is not written. Renaming or recolouring one of Figma's four presets " +
    '(Development, Interaction, Accessibility, Content) makes it a custom category for good — ' +
    'isPreset goes false and nothing sets it back. Works in Dev Mode too. Returns { ok, ' +
    'categoryId, label, color, isPreset }.',
  inputSchema: z.object({
    categoryId: z.string().describe('The category, by id (from get_annotations categories)'),
    label: z.string().optional().describe('New name'),
    color: COLOR.optional(),
  }),
  kind: 'write',
};

export const deleteAnnotationCategoryTool: ToolSpec = {
  name: 'delete_annotation_category',
  description:
    'Delete an annotation category. The annotations filed under it keep its id, which then names ' +
    'no category — re-file them with set_annotations first if they should keep one. Works in Dev ' +
    'Mode too. Returns { ok, categoryId, label }.',
  inputSchema: z.object({
    categoryId: z.string().describe('The category, by id (from get_annotations categories)'),
  }),
  kind: 'write',
  destructive: true,
};
