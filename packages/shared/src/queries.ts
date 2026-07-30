import { z } from 'zod';

import {
  PageRefSchema,
  SerializedAnnotationSchema,
  SerializedFontNameSchema,
} from './serialized-node.js';

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
 * Per-node export; base64 is null when the node is missing or not exportable.
 *
 * A node that renders nothing in place (absoluteRenderBounds === null — fully clipped / off-canvas,
 * as in a carousel, mask, or off-screen state) is automatically re-exported at its own bounding box
 * (useAbsoluteBounds) so its intrinsic art is recovered instead of shipping a blank;
 * `recovered:true` marks those. `empty:true` now means the node genuinely has nothing to render
 * even unclipped (hidden or no content) — the file is blank. At most one of `recovered` / `empty`
 * is set.
 */
export const ScreenshotImageSchema = z.object({
  nodeId: z.string(),
  format: z.string(),
  base64: z.string().nullable(),
  empty: z.boolean().optional(),
  recovered: z.boolean().optional(),
  /**
   * Raster export size (px) + the effective export scale — the anchor for mapping raster px back to
   * design px, essential when the scale was auto-fitted (omitted `scale` fits the long edge to a
   * legible window) or the node was recovered at intrinsic bounds. Computed from bounds × scale
   * (±1px of Figma's own rounding). Absent for SVG and when the node's bounds are unknown.
   */
  width: z.number().optional(),
  height: z.number().optional(),
  scale: z.number().optional(),
});
export type ScreenshotImage = z.infer<typeof ScreenshotImageSchema>;

export const GetScreenshotResultSchema = z.object({ images: z.array(ScreenshotImageSchema) });
export type GetScreenshotResult = z.infer<typeof GetScreenshotResultSchema>;

// ── save_screenshots ───────────────────────────────────────────────────────
/**
 * Per-node write result; path is null when the node is missing or not exportable. `recovered` and
 * `empty` mirror ScreenshotImage — `recovered:true` means a clipped/off-canvas node was rescued via
 * its intrinsic bounds, `empty:true` means the written file is genuinely blank.
 */
export const SavedScreenshotSchema = z.object({
  nodeId: z.string(),
  format: z.string(),
  path: z.string().nullable(),
  empty: z.boolean().optional(),
  recovered: z.boolean().optional(),
});
export type SavedScreenshot = z.infer<typeof SavedScreenshotSchema>;

export const SaveScreenshotsResultSchema = z.object({ saved: z.array(SavedScreenshotSchema) });
export type SaveScreenshotsResult = z.infer<typeof SaveScreenshotsResultSchema>;

// ── export_pdf ───────────────────────────────────────────────────────────────
/**
 * Plugin-side PDF export — one PDF page per node. The plugin `exportAsync` API renders a node (or a
 * whole page) as a single page; it can't paginate a page into one-frame-per-page (a Figma UI-only
 * feature) or combine nodes. base64 is null when the target is missing or not exportable; `empty`
 * is set when the node rendered nothing (absoluteRenderBounds === null); a PAGE has no such
 * property so it's never flagged empty.
 */
export const PdfExportSchema = z.object({
  nodeId: z.string(),
  base64: z.string().nullable(),
  empty: z.boolean().optional(),
});
export type PdfExport = z.infer<typeof PdfExportSchema>;

/** Result of export_pdf: the written file path (null when nothing was exported). */
export const ExportPdfResultSchema = z.object({
  nodeId: z.string(),
  path: z.string().nullable(),
  empty: z.boolean().optional(),
});
export type ExportPdfResult = z.infer<typeof ExportPdfResultSchema>;

// ── export_video (an animated top-level frame → MP4 / GIF / WebM) ────────────
export const VIDEO_FORMATS = ['MP4', 'GIF', 'WEBM'] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

/**
 * Why a video export produced no bytes. The first three are cheap pre-checks: `wrong-editor` (not
 * the Figma Design editor), `not-found` (missing node), `no-top-level-frame` (nothing resolves to a
 * top-level frame). `failed` is any exportAsync rejection — Figma's own message rides in `error`,
 * so the caller sees the real cause (a static frame with no animation, an unsupported setting, or
 * an export that raced another plugin call) instead of a single guessed label.
 */
export const VIDEO_EXPORT_MISS_REASONS = [
  'not-found',
  'no-top-level-frame',
  'wrong-editor',
  'failed',
] as const;
export type VideoExportMissReason = (typeof VIDEO_EXPORT_MISS_REASONS)[number];

/** Plugin-side video export: base64 bytes of the encoded frame, or null + a reason when it couldn't. */
export const VideoExportSchema = z.object({
  nodeId: z.string(),
  format: z.enum(VIDEO_FORMATS),
  base64: z.string().nullable(),
  reason: z.enum(VIDEO_EXPORT_MISS_REASONS).optional(),
  /** Figma's own rejection message, present when reason is `failed`. */
  error: z.string().optional(),
});
export type VideoExport = z.infer<typeof VideoExportSchema>;

/** Result of export_video: the written file path (null + reason when nothing was exported). */
export const ExportVideoResultSchema = z.object({
  nodeId: z.string(),
  format: z.enum(VIDEO_FORMATS),
  path: z.string().nullable(),
  reason: z.enum(VIDEO_EXPORT_MISS_REASONS).optional(),
  error: z.string().optional(),
});
export type ExportVideoResult = z.infer<typeof ExportVideoResultSchema>;

// ── save_image_fills ─────────────────────────────────────────────────────────
/**
 * One IMAGE fill's ORIGINAL bytes, as uploaded — no mask, clip, crop, scale, or effects applied
 * (unlike get_screenshot / save_screenshots, which re-render the composited node). `index` is the
 * paint's position in node.fills; `imageHash` identifies the shared asset (the same hash reused
 * across nodes points at one file). `base64` is null when the hash can't be resolved to an image.
 * `width`/`height` are the image's intrinsic pixel size; `scaleMode` is how the fill is displayed.
 */
export const ImageFillBytesSchema = z.object({
  index: z.number(),
  imageHash: z.string().nullable(),
  base64: z.string().nullable(),
  width: z.number().optional(),
  height: z.number().optional(),
  scaleMode: z.string().optional(),
});
export type ImageFillBytes = z.infer<typeof ImageFillBytesSchema>;

/**
 * A node's extractable image fills. `images` is empty when the node is missing, has no `fills`
 * property, or carries no IMAGE paint; `mixed:true` marks a node whose `fills` are mixed
 * (per-text-range) and so weren't enumerable.
 */
export const NodeImageFillsSchema = z.object({
  nodeId: z.string(),
  images: z.array(ImageFillBytesSchema),
  mixed: z.boolean().optional(),
});
export type NodeImageFills = z.infer<typeof NodeImageFillsSchema>;

/** Plugin-side result: raw image-fill bytes per node, before the server lands them on disk. */
export const ImageFillsResultSchema = z.object({ nodes: z.array(NodeImageFillsSchema) });
export type ImageFillsResult = z.infer<typeof ImageFillsResultSchema>;

/**
 * Per-fill write result. `path` is the written file (named by imageHash so identical images share
 * one file) or null when the fill's image couldn't be resolved. `format` is sniffed from the bytes
 * (PNG / JPG / GIF / WEBP, or BIN for an unrecognized container) and absent when path is null.
 */
export const SavedImageFillSchema = z.object({
  index: z.number(),
  imageHash: z.string().nullable(),
  format: z.string().optional(),
  path: z.string().nullable(),
  width: z.number().optional(),
  height: z.number().optional(),
  scaleMode: z.string().optional(),
});
export type SavedImageFill = z.infer<typeof SavedImageFillSchema>;

export const SavedNodeImageFillsSchema = z.object({
  nodeId: z.string(),
  images: z.array(SavedImageFillSchema),
  mixed: z.boolean().optional(),
});
export type SavedNodeImageFills = z.infer<typeof SavedNodeImageFillsSchema>;

export const SaveImageFillsResultSchema = z.object({ nodes: z.array(SavedNodeImageFillsSchema) });
export type SaveImageFillsResult = z.infer<typeof SaveImageFillsResultSchema>;

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
// SerializedAnnotationSchema lives in serialized-node.ts (this module imports from it), shared by
// the standalone tool result here and the per-node embedding on SerializedNode.
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

// ── Motion (beta): get_motion_styles / get_node_motion ───────────────────────
export const MotionStyleSchema = z.object({
  styleId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  props: z.record(z.string(), z.string()).optional(),
});
export type MotionStyle = z.infer<typeof MotionStyleSchema>;

export const GetMotionStylesResultSchema = z.object({ styles: z.array(MotionStyleSchema) });
export type GetMotionStylesResult = z.infer<typeof GetMotionStylesResultSchema>;

export const TimelineSchema = z.object({ id: z.string(), duration: z.number() });
export type Timeline = z.infer<typeof TimelineSchema>;

/**
 * A node's Motion state, mirrored from the plugin API. The keyframe structures (`animations`,
 * `manualKeyframeTracks`) are deep but plain JSON keyed by field name, so they pass through as
 * `unknown` rather than re-modeling every KeyframeBinding — the grounded write schema
 * (motion-schemas) is where authoring shape is enforced. `null` when the node supports no Motion.
 */
export const NodeMotionSchema = z.object({
  animationStyles: z.array(z.unknown()),
  animations: z.record(z.string(), z.unknown()),
  manualKeyframeTracks: z.record(z.string(), z.unknown()),
  timelines: z.array(TimelineSchema),
});
export type NodeMotion = z.infer<typeof NodeMotionSchema>;

export const GetNodeMotionResultSchema = z.object({
  nodeId: z.string(),
  motion: NodeMotionSchema.nullable(),
  /**
   * The Motion timeline playhead, in seconds — editor-wide state, not a property of this node,
   * hence a sibling of `motion` rather than a field inside it. Absent outside the Figma Design
   * editor, or when no Motion timeline is active. Useful as the `timelinePosition` for a keyframe
   * the user means to land "here".
   */
  playheadPosition: z.number().optional(),
});
export type GetNodeMotionResult = z.infer<typeof GetNodeMotionResultSchema>;
