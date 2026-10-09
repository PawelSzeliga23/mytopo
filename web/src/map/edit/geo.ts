import type { AreaProps } from "@/lib/api";
import type { LngLat } from "./mode";

const EARTH_RADIUS_M = 6371008.8;
const SECTOR_RADIUS_M = 3000;

/** Haversine distance in metres between two [lng, lat] points. */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function cross(o: LngLat, a: LngLat, b: LngLat): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Monotone chain; fewer than 3 points come back unchanged. */
export function convexHull(points: LngLat[]): LngLat[] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (input: LngLat[]) => {
    const chain: LngLat[] = [];
    for (const point of input) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** The area whose centre is nearest to `point`, within `maxMeters` (3 km by default). */
export function nearestSector(point: LngLat, sectors: AreaProps[], maxMeters = SECTOR_RADIUS_M): AreaProps | null {
  let best: AreaProps | null = null;
  let bestDistance = maxMeters;
  for (const sector of sectors) {
    const distance = distanceMeters(point, sector.center);
    if (distance <= bestDistance) {
      best = sector;
      bestDistance = distance;
    }
  }
  return best;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}
