/**
 * Dependency-free geometry helpers for the vision pipeline.
 * Every box is { x1, y1, x2, y2 } in pixel space.
 */

export const clamp = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);

export const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** Euclidean distance between two {x, y} points. */
export const distance = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** Bounding box that tightly wraps the given keypoints above `minScore`. */
export function boxFromPoints(points, minScore = 0.3) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  let count = 0;

  for (const point of points) {
    if (!point || !isNumber(point.x) || !isNumber(point.y)) continue;
    if ((point.score ?? 0) < minScore) continue;
    count += 1;
    if (point.x < x1) x1 = point.x;
    if (point.y < y1) y1 = point.y;
    if (point.x > x2) x2 = point.x;
    if (point.y > y2) y2 = point.y;
  }

  if (count < 2 || x2 <= x1 || y2 <= y1) return null;
  return { x1, y1, x2, y2 };
}

/** Intersection-over-union of two boxes. Returns 0 for degenerate input. */
export function iou(a, b) {
  if (!a || !b) return 0;

  const interX1 = Math.max(a.x1, b.x1);
  const interY1 = Math.max(a.y1, b.y1);
  const interX2 = Math.min(a.x2, b.x2);
  const interY2 = Math.min(a.y2, b.y2);

  const interW = interX2 - interX1;
  const interH = interY2 - interY1;
  if (interW <= 0 || interH <= 0) return 0;

  const interArea = interW * interH;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - interArea;

  return union > 0 ? interArea / union : 0;
}

export const boxCenter = (box) => ({
  x: (box.x1 + box.x2) / 2,
  y: (box.y1 + box.y2) / 2,
});

export const boxWidth = (box) => Math.max(0, box.x2 - box.x1);

export const boxHeight = (box) => Math.max(0, box.y2 - box.y1);

export const boxArea = (box) => boxWidth(box) * boxHeight(box);

/** Exponential moving average toward `next`. `alpha` = how much of the new value to take. */
export const ema = (prev, next, alpha) => (isNumber(prev) ? prev + alpha * (next - prev) : next);

/** Smooth a box towards `next`, keeping it visually stable between frames. */
export function smoothBox(prev, next, alpha = 0.55) {
  if (!prev) return { ...next };
  return {
    x1: ema(prev.x1, next.x1, alpha),
    y1: ema(prev.y1, next.y1, alpha),
    x2: ema(prev.x2, next.x2, alpha),
    y2: ema(prev.y2, next.y2, alpha),
  };
}

/** Expand a box by a fraction of its own size on every side. */
export function padBox(box, ratio = 0.08) {
  const padX = boxWidth(box) * ratio;
  const padY = boxHeight(box) * ratio;
  return { x1: box.x1 - padX, y1: box.y1 - padY, x2: box.x2 + padX, y2: box.y2 + padY };
}
