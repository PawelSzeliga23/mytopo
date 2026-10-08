import { describe, expect, it } from "vitest";
import { nextCompact } from "@/crag/useCompactOnScroll";

describe("zwijanie zdjęcia na telefonie", () => {
  it("zwija się po przewinięciu, rozwija dopiero blisko góry (bez migania)", () => {
    expect(nextCompact(false, 100)).toBe(false);
    expect(nextCompact(false, 121)).toBe(true);
    expect(nextCompact(true, 30)).toBe(true);
    expect(nextCompact(true, 10)).toBe(false);
  });
});
