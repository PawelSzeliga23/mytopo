import { describe, expect, it } from "vitest";
import { buildBaseStyle, GLYPHS_URL } from "@/map/style";

const ids = (style: ReturnType<typeof buildBaseStyle>) => style.layers.map((layer) => layer.id);

describe("buildBaseStyle", () => {
  it("domyślny podkład: OSM z cieniowaniem Geoportalu", () => {
    const style = buildBaseStyle("osm", false);
    expect(ids(style)).toEqual(["background", "base", "hillshade"]);
    expect(style.glyphs).toBe(GLYPHS_URL);
    expect(JSON.stringify(style.sources)).toContain("tile.openstreetmap.org");
    expect(JSON.stringify(style.sources)).toContain("ShadedRelief");
    expect(JSON.stringify(style.sources)).toContain("{bbox-epsg-3857}");
  });

  it("ortofotomapa i OpenTopoMap bez cieniowania", () => {
    expect(ids(buildBaseStyle("orto", false))).toEqual(["background", "base"]);
    expect(JSON.stringify(buildBaseStyle("orto", false).sources)).toContain("ORTOFOTOMAPA");
    expect(JSON.stringify(buildBaseStyle("topo", false).sources)).toContain("opentopomap.org");
  });

  it("w ciemnym motywie przyciemnia podkład", () => {
    const base = buildBaseStyle("osm", true).layers.find((layer) => layer.id === "base");
    expect(base).toMatchObject({ paint: { "raster-brightness-max": 0.55 } });
    const light = buildBaseStyle("osm", false).layers.find((layer) => layer.id === "base");
    expect(light).toMatchObject({ paint: { "raster-brightness-max": 1 } });
  });

  it("w ciemnym motywie zmniejsza nasycenie podkładu", () => {
    const dark = buildBaseStyle("osm", true).layers.find((layer) => layer.id === "base");
    expect(dark).toMatchObject({ paint: { "raster-saturation": -0.3 } });
    const light = buildBaseStyle("osm", false).layers.find((layer) => layer.id === "base");
    expect(light).toMatchObject({ paint: { "raster-saturation": 0 } });
  });

  it("cieniowanie pojawia się od zoomu 10 i jest przyciemnione w ciemnym motywie", () => {
    const dark = buildBaseStyle("osm", true).layers.find((layer) => layer.id === "hillshade");
    expect(dark).toMatchObject({ minzoom: 10, paint: { "raster-opacity": 0.25, "raster-brightness-max": 0.4 } });
    const light = buildBaseStyle("osm", false).layers.find((layer) => layer.id === "hillshade");
    expect(light).toMatchObject({ minzoom: 10, paint: { "raster-opacity": 0.35, "raster-brightness-max": 1 } });
  });
});
