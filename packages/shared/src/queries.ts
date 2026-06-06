import { z } from 'zod';

import { PageRefSchema, SerializedFontNameSchema } from './serialized-node.js';

// ── list_files ───────────────────────────────────────────────────────────────
/**
 * A plugin only sees its host document, so this returns a single-element list describing the
 * current file (kept as an array for parity with multi-file backends).
 */
export const FileInfoSchema = z.object({
  fileKey: z.string().nullable(),
  fileName: z.string(),
  currentPage: PageRefSchema,
});
export type FileInfo = z.infer<typeof FileInfoSchema>;

export const ListFilesResultSchema = z.object({ files: z.array(FileInfoSchema) });
export type ListFilesResult = z.infer<typeof ListFilesResultSchema>;

// ── get_screenshot ───────────────────────────────────────────────────────────
export const SCREENSHOT_FORMATS = ['PNG', 'JPG', 'SVG'] as const;
export type ScreenshotFormat = (typeof SCREENSHOT_FORMATS)[number];

/**
 * Per-node export; base64 is null when the node is missing or not exportable. `empty` is set when
 * the node rendered nothing (absoluteRenderBounds === null) — e.g. it's hidden, has no visible
 * content, or is fully clipped / off-canvas (a common marquee/edge case). The export then comes
 * back blank (transparent PNG / empty SVG); for an instance that should have art, re-export its
 * mainComponent.
 */
export const ScreenshotImageSchema = z.object({
  nodeId: z.string(),
  format: z.string(),
  base64: z.string().nullable(),
  empty: z.boolean().optional(),
});
export type ScreenshotImage = z.infer<typeof ScreenshotImageSchema>;

export const GetScreenshotResultSchema = z.object({ images: z.array(ScreenshotImageSchema) });
export type GetScreenshotResult = z.infer<typeof GetScreenshotResultSchema>;

// ── save_screenshots ───────────────────────────────────────────────────────
/**
 * Per-node write result; path is null when the node is missing or not exportable. `empty` mirrors
 * ScreenshotImage.empty — the file was written but the node rendered nothing (blank export).
 */
export const SavedScreenshotSchema = z.object({
  nodeId: z.string(),
  format: z.string(),
  path: z.string().nullable(),
  empty: z.boolean().optional(),
});
export type SavedScreenshot = z.infer<typeof SavedScreenshotSchema>;

export const SaveScreenshotsResultSchema = z.object({ saved: z.array(SavedScreenshotSchema) });
export type SaveScreenshotsResult = z.infer<typeof SaveScreenshotsResultSchema>;

// ── get_viewport ───────────────────────────────────────────────────────────
export const GetViewportResultSchema = z.object({
  center: z.object({ x: z.number(), y: z.number() }),
  zoom: z.number(),
  bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
});
export type GetViewportResult = z.infer<typeof GetViewportResultSchema>;

// ── get_fonts ──────────────────────────────────────────────────────────────
export const FontUsageSchema = z.object({
  fontName: SerializedFontNameSchema,
  count: z.number(),
});
export type FontUsage = z.infer<typeof FontUsageSchema>;

export const GetFontsResultSchema = z.object({ fonts: z.array(FontUsageSchema) });
export type GetFontsResult = z.infer<typeof GetFontsResultSchema>;

// ── get_annotations ──────────────────────────────────────────────────────────
export const SerializedAnnotationSchema = z.object({
  label: z.string().optional(),
  labelMarkdown: z.string().optional(),
  categoryId: z.string().optional(),
  /** The annotation's pinned property names, e.g. ["fills", "cornerRadius"]. */
  properties: z.array(z.string()).optional(),
});
export type SerializedAnnotation = z.infer<typeof SerializedAnnotationSchema>;

export const NodeAnnotationsSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  annotations: z.array(SerializedAnnotationSchema),
});
export type NodeAnnotations = z.infer<typeof NodeAnnotationsSchema>;

export const GetAnnotationsResultSchema = z.object({
  annotations: z.array(NodeAnnotationsSchema),
});
export type GetAnnotationsResult = z.infer<typeof GetAnnotationsResultSchema>;

// ── get_reactions ────────────────────────────────────────────────────────────
export const SerializedTriggerSchema = z.object({
  type: z.string(),
  timeout: z.number().optional(),
  delay: z.number().optional(),
});
export type SerializedTrigger = z.infer<typeof SerializedTriggerSchema>;

/**
 * Bounded action wire-format: common NODE / URL / BACK / CLOSE fields; exotic actions keep type
 * only.
 */
export const SerializedActionSchema = z.object({
  type: z.string(),
  destinationId: z.string().nullable().optional(),
  navigation: z.string().optional(),
  url: z.string().optional(),
  transition: z.object({ type: z.string(), duration: z.number().optional() }).nullable().optional(),
});
export type SerializedAction = z.infer<typeof SerializedActionSchema>;

export const SerializedReactionSchema = z.object({
  trigger: SerializedTriggerSchema.nullable(),
  actions: z.array(SerializedActionSchema),
});
export type SerializedReaction = z.infer<typeof SerializedReactionSchema>;

export const GetReactionsResultSchema = z.object({
  nodeId: z.string(),
  reactions: z.array(SerializedReactionSchema),
});
export type GetReactionsResult = z.infer<typeof GetReactionsResultSchema>;
