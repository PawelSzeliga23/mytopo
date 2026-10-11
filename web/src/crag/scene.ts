import { labelTextColor, linePath, orderedLines } from "@/crag/topo";
import { toScreen, type Point, type Size, type View } from "@/crag/view";
import type { PointKind, RouteOut, WallOut } from "@/lib/api";
import { matchesKind, type KindFilter } from "@/lib/routeKind";
import { bandColor, gradeBand } from "@/lib/grades";
import type { Theme } from "@/lib/theme";

export interface SceneMark {
  x: number;
  y: number;
  kind: PointKind;
}

export interface SceneLine {
  lineId: number;
  routeId: number | null;
  /** Flat [x0, y0, x1, y1, …] in stage pixels. */
  points: number[];
  color: string;
  emphasis: "normal" | "dim" | "muted" | "hover" | "selected";
  marks: SceneMark[];
  label: { x: number; y: number; text: string; fill: string; textColor: string } | null;
  /** Paint order, higher on top: see {@link lineLayer}. */
  layer: number;
}

interface SceneArgs {
  wall: WallOut;
  routes: Map<number, RouteOut>;
  image: Size;
  container: Size;
  view: View;
  theme: Theme;
  selectedRouteId: number | null;
  hoveredRouteId: number | null;
  /** The global sport / trad filter: routes of the other kind are muted (grey, faint, lowest). */
  kind?: KindFilter;
}

/** A variant's number sits beside its branch point (a bolt of the parent line), not on top of it. */
const VARIANT_LABEL_OFFSET = 16;
/** Layers above every grade band: the hovered route, then the selected one. */
const HOVER_LAYER = 5;
const SELECTED_LAYER = 6;
const MUTED_LAYER = -1;
const MUTED_COLOR = { light: "#9ca3af", dark: "#6b7280" } as const;

/**
 * Where overlapping lines meet, a fixed order instead of flicker: easier bands above harder ones
 * (light blue 4 › dark blue 3 › red 2 › black 1), ungraded routes lowest (0); hovered and selected on top.
 */
export function lineLayer(sort: number | null, emphasis: SceneLine["emphasis"]): number {
  if (emphasis === "selected") return SELECTED_LAYER;
  if (emphasis === "hover") return HOVER_LAYER;
  if (emphasis === "muted") return MUTED_LAYER;
  const band = gradeBand(sort);
  return band === null ? 0 : 4 - band;
}

/** Everything the viewers draw for one photo, in stage pixels and paint order (see {@link lineLayer}). */
export function buildScene({ wall, routes, image, container, view, theme, selectedRouteId, hoveredRouteId, kind = "all" }: SceneArgs): SceneLine[] {
  const lines = new Map(wall.lines.map((line) => [line.id, line]));
  // Dim the rest only when the selected route is drawn on this photo; otherwise nothing would be emphasised.
  const selectedHere = selectedRouteId !== null && wall.lines.some((line) => line.route_id === selectedRouteId);
  const screen = (point: Point) => toScreen(point, image, container, view);
  const scene = orderedLines(wall).map(({ line, label }): SceneLine => {
    const route = line.route_id === null ? undefined : routes.get(line.route_id);
    const sort = route?.grade_sort ?? null;
    const emphasis: SceneLine["emphasis"] =
      line.route_id !== null && line.route_id === selectedRouteId
        ? "selected"
        : line.route_id !== null && line.route_id === hoveredRouteId
          ? "hover"
          : route && !matchesKind(route, kind)
            ? "muted"
            : selectedHere
              ? "dim"
              : "normal";
    const muted = emphasis === "muted";
    const color = muted ? MUTED_COLOR[theme] : bandColor(sort, theme);
    // Only an emphasised variant repeats its parent's trunk; otherwise the trunk would be overdrawn in several colours.
    const path = emphasis === "selected" || emphasis === "hover" ? linePath(line, lines) : line.points;
    const first = line.points[0];
    const offset = line.parent_line_id === null ? 0 : VARIANT_LABEL_OFFSET;
    const at = first ? screen(first) : null;
    return {
      lineId: line.id,
      routeId: line.route_id,
      points: path.flatMap((point) => {
        const { x, y } = screen(point);
        return [x, y];
      }),
      color,
      emphasis,
      marks: line.points.filter((point) => point.visible).map((point) => ({ ...screen(point), kind: point.kind })),
      label: at ? { x: at.x + offset, y: at.y, text: label, fill: color, textColor: muted ? "#ffffff" : labelTextColor(sort, theme) } : null,
      layer: lineLayer(sort, emphasis),
    };
  });
  return scene.sort((a, b) => a.layer - b.layer);
}
