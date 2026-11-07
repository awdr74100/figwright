// Figma stores sizes as floats; anything closer than its own minimum size (0.01) is the same size.
const SIZE_EPSILON = 0.01;

export const sameSize = (a: number, b: number): boolean => Math.abs(a - b) < SIZE_EPSILON;
