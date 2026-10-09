import type { FeatureCollection, Point, Polygon } from "geojson";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  /** The whole error response (for a 409 revert it carries `conflicts`). */
  readonly body: unknown;

  constructor(status: number, message: string, code: string | null = null, body: unknown = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
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
  needs_location: boolean;
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
  /** Segmentation (rock / ground / vegetation / sky) — only with a ready depth map. */
  segments_url: string | null;
  /** Show 2.5D by default: depth ready and the rock not overgrown (or switched on by hand). */
  show_3d: boolean;
  vegetation_ratio: number | null;
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
  needs_location: boolean;
  source: string;
  source_url: string | null;
  walls: WallOut[];
  routes: RouteOut[];
}

/** Fields an edit may send; the API changes only what is present. `comment` goes with every write. */
export interface CragPatch {
  name?: string;
  area_id?: number;
  location?: [number, number];
  rock_type?: string | null;
  height_min?: number | null;
  height_max?: number | null;
  aspects?: string[];
  formations?: string[];
  approach_minutes?: number | null;
  child_friendly?: boolean | null;
  surroundings?: string | null;
  description?: string | null;
  approach_description?: string | null;
  comment?: string | null;
}

export interface RoutePatch {
  name?: string;
  number?: number | null;
  grade?: string | null;
  length_m?: number | null;
  protection?: string | null;
  first_ascent?: string | null;
  year?: number | null;
  description?: string | null;
  comment?: string | null;
}

export interface WallPatch {
  name?: string | null;
  description?: string | null;
  sort_order?: number;
  comment?: string | null;
}

export interface AreaPatch {
  name?: string;
  description?: string | null;
  parent_id?: number;
  comment?: string | null;
}

export interface CragCreate {
  name: string;
  area_id: number;
  location: [number, number];
  comment?: string | null;
}

export interface RouteCreate {
  name: string;
  grade?: string | null;
  length_m?: number | null;
  protection?: string | null;
  first_ascent?: string | null;
  year?: number | null;
  description?: string | null;
  comment?: string | null;
}

export interface AreaCreate {
  kind: "region" | "sektor";
  parent_id: number;
  name: string;
  description?: string | null;
  crag_ids?: number[];
  comment?: string | null;
}

export interface PatchResult {
  id: number;
  slug?: string;
  changed: string[];
}

export interface ToSectorPreview {
  kind: "sektor" | "region";
  sector_name: string;
  crags: string[];
  copied_routes: number;
  unplaced: number;
}

export interface ToSectorResult {
  sector: { id: number; slug: string; kind: "sektor" | "region" };
  crags: { id: number; slug: string; name: string; needs_location: boolean }[];
}

export interface FieldDiffOut {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ObjectChangeOut {
  kind: "area" | "crag" | "wall" | "route" | "topo";
  id: number;
  name: string | null;
  op: "created" | "updated" | "deleted";
  diffs: FieldDiffOut[];
  /** "topo" only, e.g. "zmieniono 3 linie, 7 punktów". */
  summary: string | null;
}

export interface ChangeOut {
  id: number;
  author: string | null;
  comment: string | null;
  issued_at: string;
  is_import: boolean;
  reverts_id: number | null;
  reverted_by: number | null;
  crag: { id: number; name: string; slug: string | null } | null;
  area_path: AreaRef[];
  objects: ObjectChangeOut[];
}

export interface ChangesPage {
  items: ChangeOut[];
  next_before: number | null;
}

/** One field (or, with `field` "*", a whole object) changed after the transaction being reverted. */
export interface RevertConflict {
  kind: string;
  id: number;
  name: string | null;
  field: string;
  author: string | null;
  issued_at: string | null;
  current: unknown;
  restored: unknown;
}

export interface ChangesQuery {
  crag?: number;
  kind?: "all" | "deleted";
  include_import?: boolean;
  before?: number;
  limit?: number;
}

async function failure(response: Response): Promise<ApiError> {
  let message = `Błąd serwera (${response.status})`;
  let code: string | null = null;
  let body: unknown = null;
  try {
    body = await response.json();
    const parsed = body as { message?: unknown; code?: unknown };
    if (typeof parsed.message === "string" && parsed.message) message = parsed.message;
    if (typeof parsed.code === "string") code = parsed.code;
  } catch {
    // body is not JSON — keep the generic message
  }
  return new ApiError(response.status, message, code, body);
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, "Brak połączenia z serwerem");
  }
  if (!response.ok) throw await failure(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getJson<T>(path: string): Promise<T> {
  return request<T>(path, { headers: { Accept: "application/json" } });
}

export function sendJson<T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function withComment(path: string, comment?: string): string {
  return comment ? `${path}?comment=${encodeURIComponent(comment)}` : path;
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  const text = query.toString();
  return text ? `?${text}` : "";
}

export const api = {
  regions: () => getJson<FeatureCollection<Point, AreaProps>>("/api/map/areas?kind=region"),
  sectorHulls: () => getJson<FeatureCollection<Polygon, AreaProps>>("/api/map/areas?kind=sektor&geometry=hull"),
  crags: () => getJson<FeatureCollection<Point, CragProps>>("/api/map/crags"),
  crag: (slug: string) => getJson<CragDetail>(`/api/crags/${encodeURIComponent(slug)}`),
  area: (slug: string) => getJson<{ description: string | null }>(`/api/areas/${encodeURIComponent(slug)}`),
  me: () => getJson<{ nick: string }>("/api/auth/me"),
  login: (password: string, nick: string) => sendJson<{ nick: string }>("POST", "/api/auth/login", { password, nick }),
  logout: () => sendJson<void>("POST", "/api/auth/logout"),
  createCrag: (body: CragCreate) => sendJson<{ id: number; slug: string }>("POST", "/api/crags", body),
  patchCrag: (id: number, patch: CragPatch) => sendJson<PatchResult>("PATCH", `/api/crags/${id}`, patch),
  deleteCrag: (id: number, comment?: string) => sendJson<void>("DELETE", withComment(`/api/crags/${id}`, comment)),
  createRoute: (cragId: number, body: RouteCreate) => sendJson<{ id: number }>("POST", `/api/crags/${cragId}/routes`, body),
  patchRoute: (id: number, patch: RoutePatch) => sendJson<PatchResult>("PATCH", `/api/routes/${id}`, patch),
  deleteRoute: (id: number, comment?: string) => sendJson<void>("DELETE", withComment(`/api/routes/${id}`, comment)),
  patchWall: (id: number, patch: WallPatch) => sendJson<PatchResult>("PATCH", `/api/walls/${id}`, patch),
  deleteWall: (id: number, comment?: string) => sendJson<void>("DELETE", withComment(`/api/walls/${id}`, comment)),
  createArea: (body: AreaCreate) => sendJson<{ id: number; slug: string }>("POST", "/api/areas", body),
  patchArea: (id: number, patch: AreaPatch) => sendJson<PatchResult>("PATCH", `/api/areas/${id}`, patch),
  deleteArea: (id: number) => sendJson<void>("DELETE", `/api/areas/${id}`),
  toSectorPreview: (cragId: number) => getJson<ToSectorPreview>(`/api/crags/${cragId}/to-sector/preview`),
  toSector: (cragId: number, comment?: string) =>
    sendJson<ToSectorResult>("POST", `/api/crags/${cragId}/to-sector`, { comment }),
  changes: (query: ChangesQuery = {}) => getJson<ChangesPage>(`/api/changes${queryString({ ...query })}`),
  revert: (id: number, mode?: "safe" | "all", comment?: string) =>
    sendJson<{ transaction_id: number | null }>("POST", `/api/changes/${id}/revert`, { mode, comment }),
};
