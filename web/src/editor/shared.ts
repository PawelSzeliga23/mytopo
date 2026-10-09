import type { At, Draft, ImageSize } from "@/editor/types";

/** Points closer than this share of the photo's longer side are one place (one bolt used by several lines). */
export const SHARE_RADIUS = 0.003;

const distance = (a: At, b: At, image: ImageSize) => Math.hypot((a.x - b.x) * image.width, (a.y - b.y) * image.height);

export function isSamePlace(a: At, b: At, image: ImageSize): boolean {
  return distance(a, b, image) < SHARE_RADIUS * Math.max(image.width, image.height);
}

/** Every point (the given one included) lying in the same place as the given point. */
export function coincident(draft: Draft, image: ImageSize, lineKey: string, pointKey: string): { lineKey: string; pointKey: string }[] {
  const origin = draft.lines.find((line) => line.key === lineKey)?.points.find((point) => point.key === pointKey);
  if (!origin) return [];
  return draft.lines.flatMap((line) =>
    line.points.filter((point) => isSamePlace(point, origin, image)).map((point) => ({ lineKey: line.key, pointKey: point.key })),
  );
}

/** The position of the nearest existing point within the share radius, or `at` itself. */
export function snapTo(draft: Draft, image: ImageSize, at: At): At {
  let best: At | null = null;
  let bestDistance = Infinity;
  for (const line of draft.lines) {
    for (const point of line.points) {
      const d = distance(point, at, image);
      if (d < bestDistance && isSamePlace(point, at, image)) {
        best = { x: point.x, y: point.y };
        bestDistance = d;
      }
    }
  }
  return best ?? at;
}
