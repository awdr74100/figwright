/**
 * Normalize a hex color for comparison: expand shorthand, drop a fully-opaque alpha, uppercase.
 * Returns null for anything that isn't a plain hex literal. Shared by the token join's value-match
 * and the value-reverse index so both sides agree on what "the same color" means.
 */
export const normHex = (raw: string): string | null => {
  const m = /^#([0-9a-fA-F]{3,8})$/.exec(raw.trim());
  if (m === null) return null;
  let h = m[1] ?? '';
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  if (h.length === 8 && h.slice(6).toUpperCase() === 'FF') h = h.slice(0, 6);
  return `#${h.toUpperCase()}`;
};
