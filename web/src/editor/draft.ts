import type { Draft, DraftLine, DraftRouteRef } from "@/editor/types";
import type { SaveLinesBody, SaveLinesResult, WallOut } from "@/lib/api";

/** The topo of a photo as an editable draft: saved lines in sort order, keyed `l{id}` / `p{id}`. */
export function draftFromWall(wall: WallOut): Draft {
  const lines = [...wall.lines].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  return {
    wallId: wall.id,
    baseVersion: wall.version,
    newRoutes: [],
    lines: lines.map((line) => ({
      key: `l${line.id}`,
      id: line.id,
      route: line.route_id === null ? null : { routeId: line.route_id },
      parent:
        line.parent_line_id !== null && line.parent_point_id !== null
          ? { lineKey: `l${line.parent_line_id}`, pointKey: `p${line.parent_point_id}` }
          : null,
      points: [...line.points]
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
        .map((point) => ({ key: `p${point.id}`, id: point.id, x: point.x, y: point.y, kind: point.kind })),
    })),
  };
}

const idOrRef = (item: { id: number | null; key: string }) => (item.id !== null ? { id: item.id } : { ref: item.key });

function routeOf(route: DraftRouteRef): { route_id: number | null } | { route_ref: string } {
  if (route === null) return { route_id: null };
  return "routeId" in route ? { route_id: route.routeId } : { route_ref: route.routeKey };
}

function parentOf(draft: Draft, line: DraftLine): SaveLinesBody["lines"][number]["parent"] {
  if (!line.parent) return null;
  const parentLine = draft.lines.find((candidate) => candidate.key === line.parent!.lineKey);
  const point = parentLine?.points.find((candidate) => candidate.key === line.parent!.pointKey);
  if (!parentLine || !point) return null;
  return {
    ...(parentLine.id !== null ? { line_id: parentLine.id } : { line_ref: parentLine.key }),
    ...(point.id !== null ? { point_id: point.id } : { point_ref: point.key }),
  };
}

export function toSaveBody(draft: Draft, comment: string | null): SaveLinesBody {
  return {
    version: draft.baseVersion,
    comment,
    new_routes: draft.newRoutes.map((route) => ({ ref: route.key, name: route.name, grade: route.grade })),
    lines: draft.lines.map((line, index) => ({
      ...idOrRef(line),
      ...routeOf(line.route),
      sort_order: index,
      parent: parentOf(draft, line),
      points: line.points.map((point, order) => ({ ...idOrRef(point), sort_order: order, x: point.x, y: point.y, kind: point.kind })),
    })),
  };
}

/** The draft after a save: database ids for new objects, routes made in the editor become saved routes. */
export function applySaved(draft: Draft, result: SaveLinesResult): Draft {
  const { ids } = result;
  const withId = <T extends { id: number | null; key: string }>(item: T): T =>
    item.id === null && ids[item.key] !== undefined ? { ...item, id: ids[item.key] } : item;
  const route = (ref: DraftRouteRef): DraftRouteRef =>
    ref !== null && "routeKey" in ref && ids[ref.routeKey] !== undefined ? { routeId: ids[ref.routeKey] } : ref;
  return {
    ...draft,
    baseVersion: result.version,
    newRoutes: draft.newRoutes.filter((r) => ids[r.key] === undefined),
    lines: draft.lines.map((line) => ({ ...withId(line), route: route(line.route), points: line.points.map(withId) })),
  };
}

/** Lines added, removed or changed since `base`, plus routes added in the editor. */
export function countChanges(base: Draft, draft: Draft): number {
  const before = new Map(base.lines.map((line, index) => [line.key, JSON.stringify({ ...line, index })]));
  let count = draft.newRoutes.length;
  const seen = new Set<string>();
  draft.lines.forEach((line, index) => {
    seen.add(line.key);
    if (before.get(line.key) !== JSON.stringify({ ...line, index })) count += 1;
  });
  for (const key of before.keys()) if (!seen.has(key)) count += 1;
  return count;
}

export const draftKey = (wallId: number) => `topo-draft-${wallId}`;

export function saveLocal(draft: Draft, now: Date = new Date()): void {
  try {
    localStorage.setItem(draftKey(draft.wallId), JSON.stringify({ draft, savedAt: now.toISOString() }));
  } catch {
    // Private mode or full storage: the draft just isn't kept across reloads.
  }
}

export function loadLocal(wallId: number): { draft: Draft; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(draftKey(wallId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { draft?: Draft; savedAt?: string };
    if (!parsed.draft || !Array.isArray(parsed.draft.lines) || typeof parsed.savedAt !== "string") return null;
    return { draft: parsed.draft, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function clearLocal(wallId: number): void {
  try {
    localStorage.removeItem(draftKey(wallId));
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}
