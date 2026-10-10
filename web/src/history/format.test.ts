import { describe, expect, it } from "vitest";
import type { ChangeOut, ObjectChangeOut } from "@/lib/api";
import { changeHeadline, FIELD_LABELS, formatValue, formatWhen, objectTitle } from "./format";

const object = (kind: ObjectChangeOut["kind"], op: ObjectChangeOut["op"], name: string | null = null, diffs: ObjectChangeOut["diffs"] = []): ObjectChangeOut => ({
  kind, id: 1, name, op, diffs, summary: null,
});
const change = (objects: ObjectChangeOut[]): ChangeOut => ({
  id: 5, author: "ania", comment: null, issued_at: "2026-10-09T12:00:00Z", is_import: false, reverts_id: null, reverted_by: null,
  crag: null, area_path: [], objects,
});

describe("format", () => {
  it("ma polskie etykiety pól", () => {
    expect(FIELD_LABELS.grade).toBe("wycena");
    expect(FIELD_LABELS.approach_minutes).toBe("czas dojścia");
    expect(FIELD_LABELS.location).toBe("położenie");
    expect(FIELD_LABELS.area_id).toBe("obszar");
  });

  it("formatuje wartości", () => {
    expect(formatValue("approach_minutes", 10)).toBe("10 min");
    expect(formatValue("length_m", 15)).toBe("15 m");
    expect(formatValue("location", [19.6513, 50.4721])).toBe("50.4721, 19.6513");
    expect(formatValue("aspects", ["N", "E"])).toBe("N, E");
    expect(formatValue("grade", null)).toBe("—");
    expect(formatValue("description", "x".repeat(100))).toBe(`${"x".repeat(80)}…`);
  });

  it("formatuje pola modelu 2.5D", () => {
    expect([FIELD_LABELS.model_path, FIELD_LABELS.rock_color, FIELD_LABELS.depth_enabled]).toEqual(["model 2.5D", "kolor skały", "2.5D"]);
    expect(formatValue("model_path", null)).toBe("oryginał");
    expect(formatValue("model_path", "walls/5/1/model-3")).toBe("wersja 3");
    expect(formatValue("rock_color", null)).toBe("domyślny");
    expect(formatValue("ground_color", "#aabbcc")).toBe("#aabbcc");
    expect([true, false, null].map((v) => formatValue("depth_enabled", v))).toEqual(["zawsze", "nigdy", "auto"]);
  });

  it("formatuje zdjęcie ściany", () => {
    expect(FIELD_LABELS.image_path).toBe("zdjęcie");
    expect(formatValue("image_path", "walls/5/display.webp")).toBe("z importu");
    expect(formatValue("image_path", "walls/5/3/display.webp")).toBe("wersja 3");
  });

  it("buduje tytuły obiektów", () => {
    expect(objectTitle(object("crag", "updated", "Żabi Koń"))).toBe("Skała");
    expect(objectTitle(object("route", "updated", "Filar"))).toBe("Droga Filar");
    expect(objectTitle(object("wall", "updated", "2"))).toBe("Ściana 2");
    expect(objectTitle(object("area", "created", "Pieninki", [{ field: "kind", before: null, after: "sektor" }]))).toBe("Sektor Pieninki");
  });

  it("opisuje usunięcie skały i zamianę w sektor", () => {
    const deleted = change([
      object("crag", "deleted", "Mała Baszta"),
      object("wall", "deleted"),
      object("wall", "deleted"),
      ...Array.from({ length: 9 }, () => object("route", "deleted", "D")),
    ]);
    expect(changeHeadline(deleted)).toBe("Usunięto skałę (2 ściany, 9 dróg)");
    const converted = change([
      object("area", "created", "Pieninki", [{ field: "kind", before: null, after: "sektor" }]),
      object("crag", "deleted", "Pieninki"),
    ]);
    expect(changeHeadline(converted)).toBe("Zamieniono skałę w sektor");
    const intoRegion = change([
      object("area", "created", "Pieninki", [{ field: "kind", before: null, after: "region" }]),
      object("crag", "deleted", "Pieninki"),
    ]);
    expect(changeHeadline(intoRegion)).toBe("Zamieniono skałę w region");
    expect(changeHeadline(change([object("route", "updated", "Filar")]))).toBeNull();
  });

  it("formatuje czas: dziś, wczoraj, data", () => {
    const now = new Date(2026, 9, 9, 15, 0);
    expect(formatWhen(new Date(2026, 9, 9, 14, 2).toISOString(), now)).toBe("dziś 14:02");
    expect(formatWhen(new Date(2026, 9, 8, 23, 0).toISOString(), now)).toBe("wczoraj");
    expect(formatWhen(new Date(2026, 9, 1, 10, 0).toISOString(), now)).toBe("1 paź");
  });
});
