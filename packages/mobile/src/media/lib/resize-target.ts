/** architecture.md section 6 asks for a resize before upload; 2048 keeps a readable photo small. */
export const MAX_IMAGE_EDGE = 2048;

/**
 * The size to render an image at so its longest edge fits `maxEdge`, or null when it already
 * does. Only one dimension is returned; the manipulator derives the other and keeps the ratio.
 */
export function resizeTargetForImage(
  width: number,
  height: number,
  maxEdge: number = MAX_IMAGE_EDGE,
): { width: number } | { height: number } | null {
  if (width <= 0 || height <= 0) return null;
  if (width <= maxEdge && height <= maxEdge) return null;
  return width >= height ? { width: maxEdge } : { height: maxEdge };
}
