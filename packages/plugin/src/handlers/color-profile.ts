/**
 * The colour space the open document stores its colours in (`figma.root.documentColorProfile`), or
 * `undefined` where the editor does not report one. Read defensively: the field is typed as always
 * there, but an editor that predates colour management has nothing to report.
 */
export const documentColorProfile = (figmaCtx: typeof figma): string | undefined => {
  const root = figmaCtx.root as { documentColorProfile?: unknown } | undefined;
  const profile = root?.documentColorProfile;
  return typeof profile === 'string' ? profile : undefined;
};

/**
 * The leading `colorProfile` key of a colour-carrying read: `{ colorProfile: 'DISPLAY_P3' }` in a
 * Display P3 document, `{}` otherwise. Spread first, so the marker precedes the first colour.
 */
export const displayP3Marker = (figmaCtx: typeof figma): { colorProfile?: 'DISPLAY_P3' } =>
  documentColorProfile(figmaCtx) === 'DISPLAY_P3' ? { colorProfile: 'DISPLAY_P3' } : {};
