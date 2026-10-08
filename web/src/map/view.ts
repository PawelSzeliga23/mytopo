export interface MapView {
  longitude: number;
  latitude: number;
  zoom: number;
}

/** "#13.26/50.16614/19.76472" (zoom/lat/lng, like MapLibre's own hash) → view, or null when malformed or out of range. */
export function parseViewHash(hash: string): MapView | null {
  const parts = hash.replace(/^#/, "").split("/");
  if (parts.length !== 3 || parts.some((part) => part.trim() === "")) return null;
  const [zoom, latitude, longitude] = parts.map(Number);
  if (![zoom, latitude, longitude].every(Number.isFinite)) return null;
  if (zoom < 0 || zoom > 22 || Math.abs(latitude) > 85 || Math.abs(longitude) > 180) return null;
  return { longitude, latitude, zoom };
}

export function formatViewHash({ longitude, latitude, zoom }: MapView): string {
  return `#${zoom.toFixed(2)}/${latitude.toFixed(5)}/${longitude.toFixed(5)}`;
}
