import { describe, expect, it } from "vitest";
import { cragLayers, INTERACTIVE_LAYERS, MAP_COLORS, regionLayers, sectorLayers, ZOOM } from "@/map/layers";

const colors = MAP_COLORS.light;

describe("warstwy mapy", () => {
  it("regiony znikają po przybliżeniu", () => {
    for (const layer of regionLayers(colors)) {
      const l = layer as unknown as { maxzoom?: number };
      expect(l.maxzoom).toBe(ZOOM.regionsUntil);
    }
  });

  it("sektory widoczne w środkowym zakresie", () => {
    for (const layer of sectorLayers(colors)) {
      const l = layer as unknown as { minzoom?: number; maxzoom?: number };
      expect(l.minzoom).toBe(ZOOM.sectorsFrom);
      expect(l.maxzoom).toBe(ZOOM.sectorsUntil);
    }
  });

  it("test_crag_groups_have_zoom_gates", () => {
    const byId = Object.fromEntries(
      cragLayers(colors).map((layer) => [layer.id, layer as unknown as { minzoom?: number; filter?: unknown }])
    );
    expect(byId["crags-isolated"].minzoom).toBeUndefined();
    expect(byId["crags-isolated"].filter).toEqual(["==", ["get", "area_kind"], "obszar"]);
    expect(byId["crags-loose"].minzoom).toBe(ZOOM.looseCragsFrom);
    expect(byId["crags-loose"].filter).toEqual(["==", ["get", "area_kind"], "region"]);
    expect(byId["crags-sector"].minzoom).toBe(ZOOM.sectorCragsFrom);
    expect(byId["crags-sector"].filter).toEqual(["==", ["get", "area_kind"], "sektor"]);
  });

  it("klikalne są tylko punkty i obrysy", () => {
    const all = [...regionLayers(colors), ...sectorLayers(colors), ...cragLayers(colors)].map((layer) => layer.id);
    for (const id of INTERACTIVE_LAYERS) expect(all).toContain(id);
  });
});
