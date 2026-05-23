import * as v from 'valibot';

import { PageRefSchema, SerializedFontNameSchema } from './serialized-node.js';

// ── list_files ───────────────────────────────────────────────────────────────
/**
 * A plugin only sees its host document, so this returns a single-element list
 * describing the current file (kept as an array for parity with multi-file backends).
 */
export const FileInfoSchema = v.object({
  fileKey: v.nullable(v.string()),
  fileName: v.string(),
  currentPage: PageRefSchema,
});
export type FileInfo = v.InferOutput<typeof FileInfoSchema>;

export const ListFilesResultSchema = v.object({ files: v.array(FileInfoSchema) });
export type ListFilesResult = v.InferOutput<typeof ListFilesResultSchema>;

// ── get_screenshot ───────────────────────────────────────────────────────────
export const SCREENSHOT_FORMATS = ['PNG', 'JPG', 'SVG'] as const;
export type ScreenshotFormat = (typeof SCREENSHOT_FORMATS)[number];

/** Per-node export; base64 is null when the node is missing or not exportable. */
export const ScreenshotImageSchema = v.object({
  nodeId: v.string(),
  format: v.string(),
  base64: v.nullable(v.string()),
});
export type ScreenshotImage = v.InferOutput<typeof ScreenshotImageSchema>;

export const GetScreenshotResultSchema = v.object({ images: v.array(ScreenshotImageSchema) });
export type GetScreenshotResult = v.InferOutput<typeof GetScreenshotResultSchema>;

// ── save_screenshots ───────────────────────────────────────────────────────
/** Per-node write result; path is null when the node is missing or not exportable. */
export const SavedScreenshotSchema = v.object({
  nodeId: v.string(),
  format: v.string(),
  path: v.nullable(v.string()),
});
export type SavedScreenshot = v.InferOutput<typeof SavedScreenshotSchema>;

export const SaveScreenshotsResultSchema = v.object({ saved: v.array(SavedScreenshotSchema) });
export type SaveScreenshotsResult = v.InferOutput<typeof SaveScreenshotsResultSchema>;

// ── get_viewport ───────────────────────────────────────────────────────────
export const GetViewportResultSchema = v.object({
  center: v.object({ x: v.number(), y: v.number() }),
  zoom: v.number(),
  bounds: v.object({ x: v.number(), y: v.number(), width: v.number(), height: v.number() }),
});
export type GetViewportResult = v.InferOutput<typeof GetViewportResultSchema>;

// ── get_fonts ──────────────────────────────────────────────────────────────
export const FontUsageSchema = v.object({
  fontName: SerializedFontNameSchema,
  count: v.number(),
});
export type FontUsage = v.InferOutput<typeof FontUsageSchema>;

export const GetFontsResultSchema = v.object({ fonts: v.array(FontUsageSchema) });
export type GetFontsResult = v.InferOutput<typeof GetFontsResultSchema>;

// ── get_annotations ──────────────────────────────────────────────────────────
export const SerializedAnnotationSchema = v.object({
  label: v.exactOptional(v.string()),
  labelMarkdown: v.exactOptional(v.string()),
  categoryId: v.exactOptional(v.string()),
  /** The annotation's pinned property names, e.g. ["fills", "cornerRadius"]. */
  properties: v.exactOptional(v.array(v.string())),
});
export type SerializedAnnotation = v.InferOutput<typeof SerializedAnnotationSchema>;

export const NodeAnnotationsSchema = v.object({
  nodeId: v.string(),
  nodeName: v.string(),
  annotations: v.array(SerializedAnnotationSchema),
});
export type NodeAnnotations = v.InferOutput<typeof NodeAnnotationsSchema>;

export const GetAnnotationsResultSchema = v.object({
  annotations: v.array(NodeAnnotationsSchema),
});
export type GetAnnotationsResult = v.InferOutput<typeof GetAnnotationsResultSchema>;

// ── get_reactions ────────────────────────────────────────────────────────────
export const SerializedTriggerSchema = v.object({
  type: v.string(),
  timeout: v.exactOptional(v.number()),
  delay: v.exactOptional(v.number()),
});
export type SerializedTrigger = v.InferOutput<typeof SerializedTriggerSchema>;

/** Bounded action wire-format: common NODE / URL / BACK / CLOSE fields; exotic actions keep type only. */
export const SerializedActionSchema = v.object({
  type: v.string(),
  destinationId: v.exactOptional(v.nullable(v.string())),
  navigation: v.exactOptional(v.string()),
  url: v.exactOptional(v.string()),
  transition: v.exactOptional(
    v.nullable(v.object({ type: v.string(), duration: v.exactOptional(v.number()) })),
  ),
});
export type SerializedAction = v.InferOutput<typeof SerializedActionSchema>;

export const SerializedReactionSchema = v.object({
  trigger: v.nullable(SerializedTriggerSchema),
  actions: v.array(SerializedActionSchema),
});
export type SerializedReaction = v.InferOutput<typeof SerializedReactionSchema>;

export const GetReactionsResultSchema = v.object({
  nodeId: v.string(),
  reactions: v.array(SerializedReactionSchema),
});
export type GetReactionsResult = v.InferOutput<typeof GetReactionsResultSchema>;
