import { describe, expect, it } from "vitest";
import { countLabel, DROGI, SKALY } from "@/lib/plural";

describe("countLabel", () => {
  it.each([
    [0, "0 skał"],
    [1, "1 skała"],
    [2, "2 skały"],
    [4, "4 skały"],
    [5, "5 skał"],
    [12, "12 skał"],
    [14, "14 skał"],
    [22, "22 skały"],
    [49, "49 skał"],
    [112, "112 skał"],
    [124, "124 skały"],
  ])("%s skał", (n, label) => {
    expect(countLabel(n, SKALY)).toBe(label);
  });

  it("odmienia drogi", () => {
    expect(countLabel(1, DROGI)).toBe("1 droga");
    expect(countLabel(3, DROGI)).toBe("3 drogi");
    expect(countLabel(645, DROGI)).toBe("645 dróg");
  });
});
