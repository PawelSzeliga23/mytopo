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
    const byId = (id: number) => scene.find((line) => line.lineId === id)!;
    expect([1, 2, 3, 4].map((id) => byId(id).label?.text)).toEqual(["1", "2", "2a", "3"]);
    expect(byId(1)).toMatchObject({ lineId: 1, points: [10, 90, 10, 50], color: BAND_COLORS.light[0], emphasis: "normal" });
    expect(byId(1).label).toMatchObject({ x: 10, y: 90, fill: BAND_COLORS.light[0], textColor: "#FFFFFF" });
    expect(byId(3).color).toBe(UNGRADED_COLOR.light);
  });

  it("wpinki tylko widoczne, numer wariantu obok punktu odejścia", () => {
    const scene = buildScene({ ...base, selectedRouteId: null, hoveredRouteId: null });
    const byId = (id: number) => scene.find((line) => line.lineId === id)!;
    expect(byId(2).marks).toEqual([{ x: 40, y: 60, kind: "ring" }, { x: 40, y: 40, kind: "stanowisko" }]);
    expect(byId(3).label).toMatchObject({ x: 56, y: 60 });
  });

  it("wybrana droga na wierzchu z całą ścieżką, pozostałe przygaszone", () => {
    const scene = buildScene({ ...base, selectedRouteId: 3, hoveredRouteId: 1 });
    expect(scene.map((line) => [line.lineId, line.emphasis])).toEqual([[4, "dim"], [2, "dim"], [1, "hover"], [3, "selected"]]);
    expect(scene[3].points).toEqual([40, 90, 40, 60, 60, 25]);
  });

  it("wybrana droga bez linii na tym zdjęciu nie przygasza niczego", () => {
    const scene = buildScene({ ...base, selectedRouteId: 99, hoveredRouteId: null });
    expect(scene.every((line) => line.emphasis === "normal")).toBe(true);
  });
});

describe("kolejność rysowania (nakładające się linie)", () => {
  const bands = makeWall(21, [
    ln(1, 10, 1, [pt(1, 0.5, 0.9, "start"), pt(2, 0.5, 0.1)]),
    ln(2, 20, 2, [pt(3, 0.5, 0.9, "start"), pt(4, 0.5, 0.1)]),
    ln(3, 30, 3, [pt(5, 0.5, 0.9, "start"), pt(6, 0.5, 0.1)]),
    ln(4, 40, 4, [pt(7, 0.5, 0.9, "start"), pt(8, 0.5, 0.1)]),
    ln(5, 50, null, [pt(9, 0.5, 0.9, "start"), pt(10, 0.5, 0.1)]),
  ]);
  const bandRoutes = new Map([
    [1, makeRoute(1, "czarna", { grade_sort: 220 })],
    [2, makeRoute(2, "czerwona", { grade_sort: 160 })],
    [3, makeRoute(3, "ciemnoniebieska", { grade_sort: 120 })],
    [4, makeRoute(4, "jasnoniebieska", { grade_sort: 60 })],
  ]);
  const args = { ...base, wall: bands, routes: bandRoutes, hoveredRouteId: null };

  it("łatwiejsze pasma nad trudniejszymi, bez wyceny na spodzie", () => {
    const scene = buildScene({ ...args, selectedRouteId: null });
    expect(scene.map((line) => line.lineId)).toEqual([5, 1, 2, 3, 4]);
    expect(scene.map((line) => line.layer)).toEqual([0, 1, 2, 3, 4]);
  });

  it("zaznaczona droga zawsze na wierzchu, także trudna", () => {
    const scene = buildScene({ ...args, selectedRouteId: 1 });
    expect(scene.at(-1)).toMatchObject({ lineId: 1, emphasis: "selected" });
    expect(scene.at(-1)!.layer).toBeGreaterThan(Math.max(...scene.slice(0, -1).map((line) => line.layer)));
  });
});
