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
  grade_min: string | null;
  grade_min_sort: number | null;
  grade_max: string | null;
  grade_max_sort: number | null;
}

export interface AreaRef {
  id: number;
  name: string;
  slug: string;
  kind: AreaKind;
}

export type PointKind = "start" | "ring" | "hak" | "ucho" | "stanowisko" | "ogranicznik" | "przelot";

export interface PointOut {
  id: number;
  sort_order: number;
  /** 0–1, relative to the photo */
  x: number;
  y: number;
  kind: PointKind;
  visible: boolean;
}

export interface LineOut {
  id: number;
  route_id: number | null;
  color: string;
  sort_order: number;
  parent_line_id: number | null;
  parent_point_id: number | null;
  points: PointOut[];
}

export interface WallOut {
  id: number;
  name: string | null;
  description: string | null;
  sort_order: number;
  version: number;
  image_url: string | null;
  thumb_url: string | null;
  image_width: number | null;
  image_height: number | null;
  depth_url: string | null;
  depth_status: string;
  depth_model: string | null;
  lines: LineOut[];
}

export interface RouteOut {
  id: number;
  number: number | null;
  name: string;
  grade: string | null;
  grade_fr: string | null;
  grade_sort: number | null;
  length_m: number | null;
  protection: string | null;
  first_ascent: string | null;
  year: number | null;
  description: string | null;
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
  formations: string[];
  surroundings: string | null;
  description: string | null;
  approach_description: string | null;
  source: string;
  source_url: string | null;
  walls: WallOut[];
  routes: RouteOut[];
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
