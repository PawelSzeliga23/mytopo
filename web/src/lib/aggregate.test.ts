import { describe, expect, it } from "vitest";
import type { AreaProps, CragProps } from "@/lib/api";
import { aggregateBands } from "@/lib/aggregate";

const area = (id: number, kind: AreaProps["kind"], parent_id: number | null): AreaProps => ({
  id, name: `A${id}`, slug: `a${id}`, kind, parent_id, crag_count: 0, route_count: 0, center: [0, 0], bbox: [0, 0, 0, 0],
});
const crag = (id: number, area_id: number, area_kind: CragProps["area_kind"], grade_bands: number[]): CragProps => ({
  id, name: `C${id}`, slug: `c${id}`, area_id, area_kind, in_sector: area_kind === "sektor", route_count: 0, grade_bands,
});

describe("aggregateBands", () => {
  it("sumuje skały sektora i skały bezpośrednio w regionie", () => {
    const sectors = [area(10, "sektor", 1), area(11, "sektor", 1)];
    const crags = [crag(100, 10, "sektor", [1, 2, 0, 0]), crag(101, 11, "sektor", [0, 1, 1, 0]), crag(102, 1, "region", [2, 0, 0, 1])];
    const bands = aggregateBands(sectors, crags);
    expect(bands.get(10)).toEqual([1, 2, 0, 0]);
    expect(bands.get(11)).toEqual([0, 1, 1, 0]);
    expect(bands.get(1)).toEqual([3, 3, 1, 1]);
  });

  it("nie zmienia danych wejściowych", () => {
    const crags = [crag(100, 1, "region", [1, 0, 0, 0])];
    aggregateBands([], crags);
    expect(crags[0].grade_bands).toEqual([1, 0, 0, 0]);
  });
});
