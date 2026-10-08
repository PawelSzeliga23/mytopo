import { describe, expect, it } from "vitest";
import { buildBaseStyle } from "@/map/style";
import { cragLayers, INTERACTIVE_LAYERS, MAP_COLORS, regionLayers, sectorLayers, ZOOM } from "@/map/layers";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

const colors = MAP_COLORS.light;

describe("warstwy mapy", () => {
  it("regiony znikają po przybliżeniu", () => {
    for (const layer of regionLayers(colors)) {
      if ("maxzoom" in layer) {
        expect(layer.maxzoom).toBe(ZOOM.regionsUntil);
      }
    }
  });

  it("sektory widoczne w środkowym zakresie", () => {
    for (const layer of sectorLayers(colors)) {
      if ("minzoom" in layer) {
        expect(layer.minzoom).toBe(ZOOM.sectorsFrom);
      }
      if ("maxzoom" in layer) {
        expect(layer.maxzoom).toBe(ZOOM.sectorsUntil);
      }
    }
  });

  it("test_crag_groups_have_zoom_gates", () => {
    const byId = Object.fromEntries(cragLayers(colors).map((layer) => [layer.id ?? "", layer]));
    expect("minzoom" in byId["crags-isolated"] ? byId["crags-isolated"].minzoom : undefined).toBeUndefined();
    expect("filter" in byId["crags-isolated"] ? byId["crags-isolated"].filter : undefined).toEqual(["==", ["get", "area_kind"], "obszar"]);
    expect("minzoom" in byId["crags-loose"] ? byId["crags-loose"].minzoom : undefined).toBe(ZOOM.looseCragsFrom);
    expect("filter" in byId["crags-loose"] ? byId["crags-loose"].filter : undefined).toEqual(["==", ["get", "area_kind"], "region"]);
    expect("minzoom" in byId["crags-sector"] ? byId["crags-sector"].minzoom : undefined).toBe(ZOOM.sectorCragsFrom);
    expect("filter" in byId["crags-sector"] ? byId["crags-sector"].filter : undefined).toEqual(["==", ["get", "area_kind"], "sektor"]);
  });

  it("klikalne są tylko punkty i obrysy", () => {
    const all = [...regionLayers(colors), ...sectorLayers(colors), ...cragLayers(colors)].map((layer) => layer.id ?? "");
    for (const id of INTERACTIVE_LAYERS) expect(all).toContain(id);
  });

  it("pełny styl i warstwy przechodzą walidację MapLibre", () => {
    const style = buildBaseStyle("osm", false);

    // Add GeoJSON sources for data layers
    style.sources.regions = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    style.sources.sectors = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    style.sources.crags = { type: "geojson", data: { type: "FeatureCollection", features: [] } };

    // Add all data layers
    const allLayers = [...regionLayers(colors), ...sectorLayers(colors), ...cragLayers(colors)];

    // Set source references for layers
    const layersWithSources = allLayers.map((layer) => {
      let source: string;
      const id = (layer.id ?? "") as string;
      if (id.startsWith("region")) source = "regions";
      else if (id.startsWith("sector")) source = "sectors";
      else source = "crags";
      return { ...layer, source };
    });

    style.layers.push(...(layersWithSources as any));

    // Validate the complete style
    const errors = validateStyleMin(style);
    expect(errors).toEqual([]);
  });
});
