import { describe, expect, it } from "vitest";
import { BAND_COLORS, bandColor, cragGradeRange, formatGradeRange, gradeBand, mergeGradeRanges } from "@/lib/grades";

describe("gradeBand", () => {
  it.each([
    [null, null],
    [86, 0],
    [93, 0],
    [94, 1],
    [133, 1],
    [140, 2],
    [193, 2],
    [200, 3],
  ])("%s → %s", (sort, band) => {
    expect(gradeBand(sort)).toBe(band);
  });

  it("ma kolory pasm dla obu motywów", () => {
    expect(BAND_COLORS.light).toEqual(["#3E8FB0", "#2F4FA0", "#B23A2B", "#2B2420"]);
    expect(BAND_COLORS.dark).toEqual(["#4FA8CC", "#5C7BD6", "#E0604E", "#EDE3D2"]);
  });
});

describe("zakres wycen", () => {
  const crag = (min: string | null, minSort: number | null, max: string | null, maxSort: number | null) => ({
    grade_min: min, grade_min_sort: minSort, grade_max: max, grade_max_sort: maxSort,
  });

  it("formatuje zakres", () => {
    expect(formatGradeRange(cragGradeRange(crag("V", 80, "VI.3", 160)))).toBe("V – VI.3");
    expect(formatGradeRange(cragGradeRange(crag("IV", 60, "IV", 60)))).toBe("IV");
    expect(formatGradeRange(cragGradeRange(crag(null, null, null, null)))).toBeNull();
  });

  it("łączy zakresy", () => {
    const merged = mergeGradeRanges(cragGradeRange(crag("V", 80, "VI.1", 120)), cragGradeRange(crag("IV", 60, "VI.3", 160)));
    expect(formatGradeRange(merged)).toBe("IV – VI.3");
    expect(mergeGradeRanges(null, null)).toBeNull();
  });

  it("kolor pasma, a bez wyceny przygaszony atrament", () => {
    expect(bandColor(150, "light")).toBe("#B23A2B");
    expect(bandColor(null, "dark")).toBe("rgba(237,227,210,0.65)");
  });
});
