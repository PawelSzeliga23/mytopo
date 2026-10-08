import { describe, expect, it } from "vitest";
import { buildScene } from "@/crag/scene";
import { IDENTITY } from "@/crag/view";
import { BAND_COLORS, UNGRADED_COLOR } from "@/lib/grades";
import { ln, makeRoute, makeWall, pt } from "@/test/fixtures";

// 100×100 photo in a 100×100 stage: photo coordinates × 100 = stage pixels.
const wall = makeWall(20, [
  ln(1, 10, 1, [pt(1, 0.1, 0.9, "start"), pt(2, 0.1, 0.5)]),
  ln(2, 20, 2, [pt(10, 0.4, 0.9, "start"), pt(11, 0.4, 0.6), pt(12, 0.4, 0.4, "stanowisko")]),
  ln(3, 21, 3, [pt(20, 0.4, 0.6), pt(21, 0.6, 0.25)], [2, 11]),
  ln(4, 30, null, [pt(30, 0.8, 0.9, "start"), pt(31, 0.8, 0.5)]),
]);
const routes = new Map([
  [1, makeRoute(1, "A", { grade_sort: 80 })],
  [2, makeRoute(2, "B", { grade_sort: 150 })],
  [3, makeRoute(3, "C", { grade: null, grade_sort: null })],
]);
const base = { wall, routes, image: { width: 100, height: 100 }, container: { width: 100, height: 100 }, view: IDENTITY, theme: "light" as const };

describe("buildScene", () => {
  it("linie w kolejności topo, numery, kolory pasm", () => {
    const scene = buildScene({ ...base, selectedRouteId: null, hoveredRouteId: null });
    expect(scene.map((line) => line.label?.text)).toEqual(["1", "2", "2a", "3"]);
    expect(scene[0]).toMatchObject({ lineId: 1, points: [10, 90, 10, 50], color: BAND_COLORS.light[0], emphasis: "normal" });
    expect(scene[0].label).toMatchObject({ x: 10, y: 90, fill: BAND_COLORS.light[0], textColor: "#FFFFFF" });
    expect(scene[2].color).toBe(UNGRADED_COLOR.light);
  });

  it("wpinki tylko widoczne, numer wariantu obok punktu odejścia", () => {
    const scene = buildScene({ ...base, selectedRouteId: null, hoveredRouteId: null });
    expect(scene[1].marks).toEqual([{ x: 40, y: 60, kind: "ring" }, { x: 40, y: 40, kind: "stanowisko" }]);
    expect(scene[2].label).toMatchObject({ x: 56, y: 60 });
  });

  it("wybrana droga na wierzchu z całą ścieżką, pozostałe przygaszone", () => {
    const scene = buildScene({ ...base, selectedRouteId: 3, hoveredRouteId: 1 });
    expect(scene.map((line) => [line.lineId, line.emphasis])).toEqual([[2, "dim"], [4, "dim"], [1, "hover"], [3, "selected"]]);
    expect(scene[3].points).toEqual([40, 90, 40, 60, 60, 25]);
  });

  it("wybrana droga bez linii na tym zdjęciu nie przygasza niczego", () => {
    const scene = buildScene({ ...base, selectedRouteId: 99, hoveredRouteId: null });
    expect(scene.every((line) => line.emphasis === "normal")).toBe(true);
  });
});
