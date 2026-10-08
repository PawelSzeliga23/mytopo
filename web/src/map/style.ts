import type { StyleSpecification } from "maplibre-gl";

export type BaseLayer = "osm" | "orto" | "topo";

export const BASE_LAYERS: { id: BaseLayer; label: string }[] = [
  { id: "osm", label: "Mapa + cieniowanie" },
  { id: "orto", label: "Ortofotomapa" },
  { id: "topo", label: "OpenTopoMap" },
];

export const GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

const GEOPORTAL = "https://mapy.geoportal.gov.pl/wss/service/PZGIK";
const HILLSHADE_URL =
  `${GEOPORTAL}/NMT/GRID1/WMS/ShadedRelief?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=Raster&STYLES=` +
  "&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE";
const ORTO_URL =
  `${GEOPORTAL}/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA` +
  "&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}";

const BASE_SOURCES = {
  osm: { tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], maxzoom: 19, attribution: "© OpenStreetMap" },
  orto: { tiles: [ORTO_URL], maxzoom: 19, attribution: "© GUGiK (Geoportal)" },
  topo: { tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"], maxzoom: 17, attribution: "© OpenTopoMap (CC-BY-SA)" },
} as const;

export function buildBaseStyle(base: BaseLayer, dark: boolean): StyleSpecification {
  const source = BASE_SOURCES[base];
  const style: StyleSpecification = {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      base: { type: "raster", tiles: [...source.tiles], tileSize: 256, maxzoom: source.maxzoom, attribution: source.attribution },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": dark ? "#26201c" : "#e9ddc6" } },
      {
        id: "base",
        type: "raster",
        source: "base",
        paint: { "raster-brightness-max": dark ? 0.55 : 1, "raster-saturation": dark ? -0.3 : 0 },
      },
    ],
  };
  if (base === "osm") {
    style.sources.hillshade = {
      type: "raster",
      tiles: [HILLSHADE_URL],
      tileSize: 256,
      attribution: "© GUGiK (Geoportal)",
    };
    style.layers.push({
      id: "hillshade",
      type: "raster",
      source: "hillshade",
      minzoom: 10,
      paint: { "raster-opacity": dark ? 0.25 : 0.35, "raster-brightness-max": dark ? 0.4 : 1 },
    });
  }
  return style;
}
