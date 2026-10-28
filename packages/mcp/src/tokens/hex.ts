/**
 * A CSS hex color literal: #RGB, #RGBA, #RRGGBB or #RRGGBBAA — the only lengths CSS accepts.
 * Exported so a scan for hex-shaped strings (the value-reverse index) recognizes exactly what
 * normHex accepts, rather than keeping a second pattern that can drift from this one.
 */
export const HEX_LITERAL = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Normalize a hex color for comparison: expand shorthand (#RGB, #RGBA), drop a fully-opaque alpha,
 * uppercase. Returns null for anything that isn't a hex literal. Shared by the token join's
 * value-match and the value-reverse index so both sides agree on what "the same color" means.
 */
export const normHex = (raw: string): string | null => {
  const value = raw.trim();
  if (!HEX_LITERAL.test(value)) return null;
  let h = value.slice(1);
  if (h.length <= 4) h = [...h].map(c => c + c).join('');
  if (h.length === 8 && h.slice(6).toUpperCase() === 'FF') h = h.slice(0, 6);
  return `#${h.toUpperCase()}`;
};
