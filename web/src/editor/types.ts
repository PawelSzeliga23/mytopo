import type { PointKind } from "@/lib/api";

/** Keys: `l{id}` / `p{id}` for saved lines and points, `n1`, `n2`… for ones added in the editor. */
export interface DraftPoint {
  key: string;
  id: number | null;
  x: number;
  y: number;
  kind: PointKind;
}

export interface DraftParent {
  lineKey: string;
  pointKey: string;
}

/** Route of a line: an existing route id or the key of a route added in the editor. */
export type DraftRouteRef = { routeId: number } | { routeKey: string } | null;

export interface DraftLine {
  key: string;
  id: number | null;
  route: DraftRouteRef;
  parent: DraftParent | null;
  points: DraftPoint[];
  /** Saved sort_order (imported photos number 10, 20, 30…); kept on save while the order allows it. */
  sortOrder?: number | null;
}

export interface DraftRoute {
  key: string;
  name: string;
  grade: string | null;
}

/** Lines in topo order (array index = sort_order). */
export interface Draft {
  wallId: number;
  baseVersion: number;
  lines: DraftLine[];
  newRoutes: DraftRoute[];
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface At {
  x: number;
  y: number;
}
