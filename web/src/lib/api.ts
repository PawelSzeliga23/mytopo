import type { FeatureCollection, Point, Polygon } from "geojson";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export type AreaKind = "obszar" | "region" | "sektor";

export interface AreaProps {
  id: number;
  name: string;
  slug: string;
  kind: AreaKind;
  parent_id: number | null;
  crag_count: number;
  route_count: number;
  center: [number, number];
  bbox: [number, number, number, number];
}

export interface CragProps {
  id: number;
  name: string;
  slug: string;
  area_id: number;
  area_kind: AreaKind;
  in_sector: boolean;
  route_count: number;
  grade_bands: number[];
}

export interface AreaRef {
  id: number;
  name: string;
  slug: string;
  kind: AreaKind;
}

export interface CragDetail {
  id: number;
  name: string;
  slug: string;
  path: AreaRef[];
  lng: number;
  lat: number;
  rock_type: string | null;
  height_min: number | null;
  height_max: number | null;
  aspects: string[];
  approach_minutes: number | null;
  child_friendly: boolean | null;
  description: string | null;
}

export async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError(0, "Brak połączenia z serwerem");
  }
  if (!response.ok) {
    let message = `Błąd serwera (${response.status})`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // body is not JSON — keep the generic message
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export const api = {
  regions: () => getJson<FeatureCollection<Point, AreaProps>>("/api/map/areas?kind=region"),
  sectorHulls: () => getJson<FeatureCollection<Polygon, AreaProps>>("/api/map/areas?kind=sektor&geometry=hull"),
  crags: () => getJson<FeatureCollection<Point, CragProps>>("/api/map/crags"),
  crag: (slug: string) => getJson<CragDetail>(`/api/crags/${encodeURIComponent(slug)}`),
};
