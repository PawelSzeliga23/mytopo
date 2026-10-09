import type { CragDetail, LineOut, PointKind, PointOut, RouteOut, WallOut } from "@/lib/api";

export const pt = (id: number, x: number, y: number, kind: PointKind = "ring"): PointOut => ({
  id, sort_order: id, x, y, kind, visible: kind !== "start" && kind !== "przelot",
});

export function ln(id: number, sortOrder: number, routeId: number | null, points: PointOut[], parent: [lineId: number, pointId: number] | null = null): LineOut {
  return {
    id, route_id: routeId, color: "#FF0000", sort_order: sortOrder,
    parent_line_id: parent?.[0] ?? null, parent_point_id: parent?.[1] ?? null, points,
  };
}

export function makeWall(id: number, lines: LineOut[], extra: Partial<WallOut> = {}): WallOut {
  return {
    id, name: null, description: null, sort_order: 0, version: 1,
    image_url: `/media/walls/${id}/display.webp`, thumb_url: `/media/walls/${id}/thumb.webp`,
    image_width: 100, image_height: 100, depth_url: null, depth_status: "pending", depth_model: null,
    segments_url: null, show_3d: false, vegetation_ratio: null, lines, ...extra,
  };
}

export function makeRoute(id: number, name: string, extra: Partial<RouteOut> = {}): RouteOut {
  return {
    id, number: id, name, grade: "VI.1", grade_fr: "6b", grade_sort: 120, length_m: null, protection: null,
    first_ascent: null, year: null, description: null, ...extra,
  };
}

export function makeCrag(walls: WallOut[], routes: RouteOut[], extra: Partial<CragDetail> = {}): CragDetail {
  return {
    id: 44, name: "Brzuchata Turniczka", slug: "brzuchata-turniczka",
    path: [
      { id: 1, name: "Jura Krakowsko Częstochowska", slug: "jura", kind: "obszar" },
      { id: 2, name: "Dolina Kobylańska", slug: "dolina-kobylanska", kind: "region" },
    ],
    lng: 19.764721, lat: 50.166141, rock_type: "wapień", height_min: 10, height_max: 10, aspects: ["N"],
    formations: [], approach_minutes: 5, child_friendly: true, surroundings: null, description: null,
    approach_description: null, needs_location: false, source: "portalgorski", source_url: "https://topo.portalgorski.pl/skala,365",
    walls, routes, ...extra,
  };
}
