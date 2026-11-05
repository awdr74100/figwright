/**
 * The width / height a create_* call asked for, checked before the node exists.
 *
 * Figma's own check runs inside `resize()`, after the node has been created and appended to the
 * page: a negative side threw there and left the new layer behind at its default size (measured),
 * and a 0 was taken and stored as 0.0001 — a layer nobody can see, answered ok (measured). So a
 * side must be a finite number of at least 0.01, the floor resize_nodes holds too, and a refused
 * call creates nothing.
 */
export interface CreateSize {
  width?: number;
  height?: number;
}

export const readCreateSize = (
  p: { width?: unknown; height?: unknown },
  tool: string,
): CreateSize => {
  const size: CreateSize = {};
  for (const side of ['width', 'height'] as const) {
    const value = p[side];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.01) {
      throw new TypeError(`${tool}: ${side} must be a number of at least 0.01`);
    }
    size[side] = value;
  }
  return size;
};

/**
 * Size a new node: a side left out keeps the one the node already has — its default (100, or 496
 * for a section, measured) — so a width alone sets the width, rather than being dropped because no
 * height came with it.
 */
export const applyCreateSize = (
  node: { width: number; height: number },
  size: CreateSize,
  resize: (width: number, height: number) => void,
): void => {
  if (size.width === undefined && size.height === undefined) return;
  resize(size.width ?? node.width, size.height ?? node.height);
};
