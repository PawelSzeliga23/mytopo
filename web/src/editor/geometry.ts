import { fitImage, type Point, type Size, type View } from "@/crag/view";

/** Handle radius in screen pixels (constant at every zoom); touch handles give a ≥ 24 px target. */
export const HANDLE_RADIUS = { mouse: 7, touch: 12 } as const;
/** How close (screen px) a click must be to a line to hit it. */
export const LINE_HIT = 10;

/** Stage position → photo-relative point (0–1); the inverse of `toScreen`. */
export function toPhoto(screen: Point, image: Size, container: Size, view: View): Point {
  const fit = fitImage(container, image);
  return {
    x: ((screen.x - view.x) / view.zoom - fit.x) / (image.width * fit.scale),
    y: ((screen.y - view.y) / view.zoom - fit.y) / (image.height * fit.scale),
  };
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The segment of a polyline (screen px) nearest to `at`: index of the point before it, or null when farther than `maxDistance`. */
export function nearestSegment(points: Point[], at: Point, maxDistance: number): { index: number; distance: number } | null {
  let best: { index: number; distance: number } | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const distance = distanceToSegment(at, points[i], points[i + 1]);
    if (distance <= maxDistance && (!best || distance < best.distance)) best = { index: i, distance };
  }
  return best;
}
