import { describe, expect, it } from "vitest";
import { BAND_COLORS, gradeBand } from "@/lib/grades";

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
