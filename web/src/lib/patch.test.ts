import { describe, expect, it } from "vitest";
import { changedFields } from "@/lib/patch";

describe("changedFields", () => {
  it("zwraca tylko zmienione pola", () => {
    const original = { name: "Żabi Koń", rock_type: "wapień", height_max: 12 };
    expect(changedFields(original, { ...original, height_max: 15 })).toEqual({ height_max: 15 });
  });

  it("nic nie zwraca, gdy nic się nie zmieniło", () => {
    const original = { name: "A", description: null };
    expect(changedFields(original, { ...original })).toEqual({});
  });

  it("traktuje pusty tekst jak brak wartości", () => {
    expect(changedFields({ description: null as string | null }, { description: "" })).toEqual({});
    expect(changedFields({ description: "opis" as string | null }, { description: "" })).toEqual({ description: "" });
  });

  it("nie liczy samych spacji jako zmiany", () => {
    expect(changedFields({ name: "Filar", description: null as string | null }, { name: "Filar ", description: "  " })).toEqual({});
  });

  it("porównuje tablice po zawartości", () => {
    expect(changedFields({ aspects: ["S"] }, { aspects: ["S"] })).toEqual({});
    expect(changedFields({ aspects: ["S"] }, { aspects: ["S", "W"] })).toEqual({ aspects: ["S", "W"] });
  });
});
