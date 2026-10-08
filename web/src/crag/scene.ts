import { labelTextColor, linePath, orderedLines } from "@/crag/topo";
import { toScreen, type Point, type Size, type View } from "@/crag/view";
import type { PointKind, RouteOut, WallOut } from "@/lib/api";
import { bandColor } from "@/lib/grades";
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
  emphasis: "normal" | "dim" | "hover" | "selected";
  marks: SceneMark[];
  label: { x: number; y: number; text: string; fill: string; textColor: string } | null;
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
}

/** A variant's number sits beside its branch point (a bolt of the parent line), not on top of it. */
const VARIANT_LABEL_OFFSET = 16;
const PAINT_ORDER = { dim: 0, normal: 1, hover: 2, selected: 3 } as const;

/** Everything the 2D viewer draws for one photo, in stage pixels and paint order (emphasised lines last, on top). */
export function buildScene({ wall, routes, image, container, view, theme, selectedRouteId, hoveredRouteId }: SceneArgs): SceneLine[] {
  const lines = new Map(wall.lines.map((line) => [line.id, line]));
  // Dim the rest only when the selected route is drawn on this photo; otherwise nothing would be emphasised.
  const selectedHere = selectedRouteId !== null && wall.lines.some((line) => line.route_id === selectedRouteId);
  const screen = (point: Point) => toScreen(point, image, container, view);
  const scene = orderedLines(wall).map(({ line, label }): SceneLine => {
    const sort = line.route_id === null ? null : (routes.get(line.route_id)?.grade_sort ?? null);
    const color = bandColor(sort, theme);
    const emphasis: SceneLine["emphasis"] =
      line.route_id !== null && line.route_id === selectedRouteId
        ? "selected"
        : line.route_id !== null && line.route_id === hoveredRouteId
          ? "hover"
          : selectedHere
            ? "dim"
            : "normal";
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
      label: at ? { x: at.x + offset, y: at.y, text: label, fill: color, textColor: labelTextColor(sort, theme) } : null,
    };
  });
  return scene.sort((a, b) => PAINT_ORDER[a.emphasis] - PAINT_ORDER[b.emphasis]);
}
