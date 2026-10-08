import { describe, expect, it } from "vitest";
import { compactSpacer, nextCompact, phoneViewerHeight } from "@/crag/useCompactOnScroll";

describe("zwijanie zdjęcia na telefonie", () => {
  it("zwija się po przewinięciu, rozwija dopiero blisko góry (bez migania)", () => {
    expect(nextCompact(false, 100)).toBe(false);
    expect(nextCompact(false, 121)).toBe(true);
    expect(nextCompact(true, 30)).toBe(true);
    expect(nextCompact(true, 10)).toBe(false);
  });
});

describe("wysokość zdjęcia na telefonie", () => {
  it("zwinięte zdjęcie oddaje różnicę wysokości przekładką, rozwinięte jej nie ma", () => {
    expect(phoneViewerHeight(0.75, false)).toBe("min(75vw, 65vh)");
    expect(phoneViewerHeight(0.75, true)).toBe("30vh");
    expect(compactSpacer(0.75, false)).toBeNull();
    expect(compactSpacer(0.75, true)).toBe("calc(min(75vw, 65vh) - 30vh)");
  });
});
