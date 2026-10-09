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
      sortOrder: line.sort_order,
      id: line.id,
      route: line.route_id === null ? null : { routeId: line.route_id },
      parent:
        line.parent_line_id !== null && line.parent_point_id !== null
          ? {
              lineKey: `l${line.parent_line_id}`,
              pointKey: `p${line.parent_point_id}`,
            }
          : null,
      points: [...line.points]
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
        .map((point) => ({
          key: `p${point.id}`,
          id: point.id,
          x: point.x,
          y: point.y,
          kind: point.kind,
        })),
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

/**
 * `sort_order` to send: a line keeps its saved value while it still follows the previous line's, otherwise the next
 * number. Imported photos use 10, 20, 30…, so renumbering every line would show each one as changed in the history.
 */
export function sortOrders(draft: Draft): number[] {
  let previous: number | null = null;
  return draft.lines.map((line) => {
    const saved = line.sortOrder ?? null;
    const order = saved !== null && (previous === null || saved > previous) ? saved : previous === null ? 0 : previous + 1;
    previous = order;
    return order;
  });
}

/** Routes added in the editor that some line still climbs; unused ones are not sent (nor counted). */
function usedNewRoutes(draft: Draft) {
  const used = new Set(draft.lines.flatMap((line) => (line.route && "routeKey" in line.route ? [line.route.routeKey] : [])));
  return draft.newRoutes.filter((route) => used.has(route.key));
}

export function toSaveBody(draft: Draft, comment: string | null): SaveLinesBody {
  const orders = sortOrders(draft);
  return {
    version: draft.baseVersion,
    comment,
    new_routes: usedNewRoutes(draft).map((route) => ({ ref: route.key, name: route.name, grade: route.grade })),
    lines: draft.lines.map((line, index) => ({
      ...idOrRef(line),
      ...routeOf(line.route),
      sort_order: orders[index],
      parent: parentOf(draft, line),
      points: line.points.map((point, order) => ({ ...idOrRef(point), sort_order: order, x: point.x, y: point.y, kind: point.kind })),
    })),
  };
}

/** The draft after a save: database ids for new objects, routes made in the editor become saved routes. */
export function applySaved(draft: Draft, result: SaveLinesResult): Draft {
  const { ids } = result;
  const orders = sortOrders(draft);
  const withId = <T extends { id: number | null; key: string }>(item: T): T =>
    item.id === null && ids[item.key] !== undefined ? { ...item, id: ids[item.key] } : item;
  const route = (ref: DraftRouteRef): DraftRouteRef =>
    ref !== null && "routeKey" in ref && ids[ref.routeKey] !== undefined ? { routeId: ids[ref.routeKey] } : ref;
  return {
    ...draft,
    baseVersion: result.version,
    newRoutes: draft.newRoutes.filter((r) => ids[r.key] === undefined),
    lines: draft.lines.map((line, index) => ({
      ...withId(line),
      sortOrder: orders[index],
      route: route(line.route),
      points: line.points.map(withId),
    })),
  };
}

/**
 * Ids the database no longer has become refs again (the key is sent instead), and routes that are gone are cleared:
 * undoing past a save that deleted a line, or overwriting someone else's save, then re-creates instead of failing.
 */
export function forgetMissing(draft: Draft, saved: Draft, routeIds?: Set<number>): Draft {
  const lineIds = new Set(saved.lines.flatMap((line) => (line.id === null ? [] : [line.id])));
  const pointIds = new Set(saved.lines.flatMap((line) => line.points.flatMap((point) => (point.id === null ? [] : [point.id]))));
  const route = (ref: DraftRouteRef): DraftRouteRef =>
    routeIds && ref !== null && "routeId" in ref && !routeIds.has(ref.routeId) ? null : ref;
  return {
    ...draft,
    lines: draft.lines.map((line) => ({
      ...line,
      id: line.id !== null && lineIds.has(line.id) ? line.id : null,
      route: route(line.route),
      points: line.points.map((point) => ({ ...point, id: point.id !== null && pointIds.has(point.id) ? point.id : null })),
    })),
  };
}

/** Lines added, removed or changed since `base`, plus routes added in the editor and used by a line. */
export function countChanges(base: Draft, draft: Draft): number {
  const shape = (line: DraftLine, index: number) => JSON.stringify({ ...line, sortOrder: undefined, index });
  const before = new Map(base.lines.map((line, index) => [line.key, shape(line, index)]));
  let count = usedNewRoutes(draft).length;
  const seen = new Set<string>();
  draft.lines.forEach((line, index) => {
    seen.add(line.key);
    if (before.get(line.key) !== shape(line, index)) count += 1;
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
