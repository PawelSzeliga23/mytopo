import { describe, expect, it } from "vitest";
import { labelTextColor, linePath, orderedLines, routeRows } from "@/crag/topo";
import type { LineOut } from "@/lib/api";
import { ln, makeCrag, makeRoute, makeWall, pt } from "@/test/fixtures";

// Like "Zjazdowa Turnia": route 2 has two variants, one of them branching off the other.
const lines: LineOut[] = [
  ln(139, 30, 6, [pt(50, 0.8, 0.9, "start"), pt(51, 0.8, 0.5)]),
  ln(135, 10, 1, [pt(1, 0.1, 0.9, "start"), pt(2, 0.1, 0.5)]),
  ln(136, 20, 2, [pt(10, 0.4, 0.9, "start"), pt(11, 0.4, 0.6), pt(12, 0.4, 0.4), pt(13, 0.4, 0.2, "stanowisko")]),
  ln(137, 21, 3, [pt(20, 0.4, 0.4), pt(21, 0.5, 0.2)], [136, 12]),
  ln(138, 22, 4, [pt(30, 0.4, 0.6), pt(31, 0.3, 0.3)], [136, 11]),
  ln(146, 23, 5, [pt(40, 0.5, 0.2), pt(41, 0.6, 0.1)], [137, 21]),
];
const wall = makeWall(20, lines);
const byId = new Map(lines.map((line) => [line.id, line]));

describe("orderedLines", () => {
  it("numery według kolejności linii, warianty z literą", () => {
    expect(orderedLines(wall).map(({ line, label }) => [line.id, label])).toEqual([
      [135, "1"], [136, "2"], [137, "2a"], [138, "2b"], [146, "2c"], [139, "3"],
    ]);
  });

  it("cykl wariantów nie zawiesza numeracji i nie gubi linii", () => {
    const broken = makeWall(1, [ln(1, 10, 1, [pt(1, 0, 0)], [2, 2]), ln(2, 20, 2, [pt(2, 0, 0)], [1, 1])]);
    expect(orderedLines(broken)).toHaveLength(2);
  });
});

describe("linePath", () => {
  it("wariant zaczyna się od linii nadrzędnej do punktu odejścia, bez powtórzonego punktu", () => {
    expect(linePath(byId.get(137)!, byId).map((point) => point.id)).toEqual([10, 11, 12, 21]);
    expect(linePath(byId.get(146)!, byId).map((point) => point.id)).toEqual([10, 11, 12, 21, 41]);
  });

  it("linia bez wariantu albo bez punktu odejścia: tylko własne punkty", () => {
    expect(linePath(byId.get(135)!, byId).map((point) => point.id)).toEqual([1, 2]);
    const orphan = ln(150, 40, 7, [pt(60, 0.2, 0.2)], [136, 999]);
    expect(linePath(orphan, byId).map((point) => point.id)).toEqual([60]);
  });

  it("cykl nie zawiesza ścieżki", () => {
    const a = ln(1, 10, 1, [pt(1, 0, 0)], [2, 2]);
    const b = ln(2, 20, 2, [pt(2, 0.5, 0.5)], [1, 1]);
    expect(linePath(a, new Map([[1, a], [2, b]])).length).toBeGreaterThan(0);
  });
});

describe("routeRows", () => {
  const other = makeWall(21, [ln(200, 10, 7, [pt(70, 0.5, 0.9, "start"), pt(71, 0.5, 0.5)]), ln(201, 20, 6, [pt(72, 0.7, 0.9, "start")])], { name: "Prawa ściana" });
  const routes = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => makeRoute(id, `Droga ${id}`));
  const crag = makeCrag([wall, other], routes);

  it("drogi zdjęcia w kolejności topo, pozostałe ze ścianą, na której są", () => {
    const rows = routeRows(crag, 20);
    expect(rows.onWall.map((row) => [row.route.id, row.label])).toEqual([[1, "1"], [2, "2"], [3, "2a"], [4, "2b"], [5, "2c"], [6, "3"]]);
    expect(rows.onWall.every((row) => row.wallId === 20)).toBe(true);
    expect(rows.other.map((row) => [row.route.id, row.label, row.wallId])).toEqual([[7, null, 21], [8, null, null]]);
  });

  it("ta sama droga ma inny numer na innym zdjęciu", () => {
    const rows = routeRows(crag, 21);
    expect(rows.onWall.map((row) => [row.route.id, row.label])).toEqual([[7, "1"], [6, "2"]]);
  });

  it("skała bez zdjęć: wszystkie drogi bez numerów", () => {
    const rows = routeRows(makeCrag([], routes), null);
    expect(rows.onWall).toEqual([]);
    expect(rows.other.map((row) => row.wallId)).toEqual(Array(8).fill(null));
  });
});

describe("labelTextColor", () => {
  it("ciemny tekst tylko na jasnym kółku w ciemnym motywie", () => {
    expect(labelTextColor(210, "dark")).toBe("#1D1916");
    expect(labelTextColor(null, "dark")).toBe("#1D1916");
    expect(labelTextColor(210, "light")).toBe("#FFFFFF");
    expect(labelTextColor(120, "dark")).toBe("#FFFFFF");
  });
});
