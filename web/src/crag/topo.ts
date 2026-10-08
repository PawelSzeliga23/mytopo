import type { CragDetail, LineOut, PointOut, RouteOut, WallOut } from "@/lib/api";
import { gradeBand } from "@/lib/grades";
import { compareRoutes } from "@/lib/routes";
import type { Theme } from "@/lib/theme";

export interface RouteRow {
  route: RouteOut;
  /** Number on the current photo ("3", "5a"); null when the route has no line on it. */
  label: string | null;
  lineId: number | null;
  /** Photo to show when the row is chosen: the current one, the first other photo with the route, or null (no topo). */
  wallId: number | null;
}

export interface RouteRows {
  onWall: RouteRow[];
  other: RouteRow[];
}

const byOrder = (a: LineOut, b: LineOut) => a.sort_order - b.sort_order || a.id - b.id;
const letter = (index: number) => (index < 26 ? String.fromCharCode(97 + index) : `z${index - 25}`);

/** The top-level line a variant branches from, following parents on this photo; stops on broken data (cycles, missing parents). */
function rootOf(line: LineOut, lines: Map<number, LineOut>): LineOut {
  const seen = new Set<number>();
  let current = line;
  while (current.parent_line_id !== null && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = lines.get(current.parent_line_id);
    if (!parent) break;
    current = parent;
  }
  return current;
}

/** Lines of a photo in topo order: top-level lines numbered 1, 2, 3… by sort_order; variants get their root's number plus a letter (5a, 5b). */
export function orderedLines(wall: WallOut): { line: LineOut; label: string }[] {
  const lines = new Map(wall.lines.map((line) => [line.id, line]));
  const groups = new Map<number, LineOut[]>();
  for (const line of [...wall.lines].sort(byOrder)) {
    const root = rootOf(line, lines);
    groups.set(root.id, [...(groups.get(root.id) ?? []), line]);
  }
  const roots = wall.lines.filter((line) => groups.has(line.id)).sort(byOrder);
  return roots.flatMap((root, index) => {
    const number = String(index + 1);
    const variants = (groups.get(root.id) ?? []).filter((line) => line.id !== root.id);
    return [{ line: root, label: number }, ...variants.map((line, i) => ({ line, label: `${number}${letter(i)}` }))];
  });
}

const samePoint = (a: PointOut, b: PointOut) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** Points of the whole climb: a variant starts with its parent's points up to the branch point. */
export function linePath(line: LineOut, lines: Map<number, LineOut>, seen = new Set<number>()): PointOut[] {
  if (line.parent_line_id === null || line.parent_point_id === null || seen.has(line.id)) return line.points;
  seen.add(line.id);
  const parent = lines.get(line.parent_line_id);
  if (!parent) return line.points;
  const trunk = linePath(parent, lines, seen);
  const branchAt = trunk.findIndex((point) => point.id === line.parent_point_id);
  if (branchAt === -1) return line.points;
  const head = trunk.slice(0, branchAt + 1);
  const own = line.points.length > 0 && samePoint(line.points[0], head[head.length - 1]) ? line.points.slice(1) : line.points;
  return [...head, ...own];
}

/** Rows of the route list for the shown photo: its routes in topo order, then the crag's other routes. */
export function routeRows(crag: CragDetail, wallId: number | null): RouteRows {
  const routes = new Map(crag.routes.map((route) => [route.id, route]));
  const onWall: RouteRow[] = [];
  const shown = new Set<number>();
  const wall = crag.walls.find((candidate) => candidate.id === wallId);
  if (wall) {
    for (const { line, label } of orderedLines(wall)) {
      const route = line.route_id === null ? undefined : routes.get(line.route_id);
      if (!route || shown.has(route.id)) continue;
      shown.add(route.id);
      onWall.push({ route, label, lineId: line.id, wallId: wall.id });
    }
  }
  const firstWall = new Map<number, number>();
  for (const candidate of crag.walls) {
    for (const line of candidate.lines) {
      if (line.route_id !== null && !firstWall.has(line.route_id)) firstWall.set(line.route_id, candidate.id);
    }
  }
  const other = crag.routes
    .filter((route) => !shown.has(route.id))
    .sort(compareRoutes)
    .map((route) => ({ route, label: null, lineId: null, wallId: firstWall.get(route.id) ?? null }));
  return { onWall, other };
}

/** Text on a numbered circle: white, except on the pale circles of the dark theme (≥ VI.5 and ungraded). */
export function labelTextColor(sort: number | null, theme: Theme): string {
  const band = gradeBand(sort);
  return theme === "dark" && (band === 3 || band === null) ? "#1D1916" : "#FFFFFF";
}
