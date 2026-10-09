import type { ExpressionSpecification } from "maplibre-gl";
import type { LayerProps } from "react-map-gl/maplibre";
import type { Theme } from "@/lib/theme";

export const ZOOM = {
  regionsUntil: 10.5,
  sectorsFrom: 10,
  sectorsUntil: 15,
  looseCragsFrom: 10,
  sectorCragsFrom: 12.5,
} as const;

export interface MapColors {
  brand: string;
  halo: string;
  ink: string;
  surface: string;
}

export const MAP_COLORS: Record<Theme, MapColors> = {
  light: { brand: "#C2541B", halo: "#F4ECDD", ink: "#2B2420", surface: "#E6D8BF" },
  dark: { brand: "#E2763A", halo: "#1D1916", ink: "#EDE3D2", surface: "#2E2722" },
};

/** Crags still waiting to be placed on the map (e.g. after "Zamień w sektor"). */
export const NEEDS_LOCATION_COLOR = "#E0A100";

export const INTERACTIVE_LAYERS = ["region-points", "sector-fill", "crags-isolated", "crags-loose", "crags-sector"];

const FONT = ["Noto Sans Bold"];
const e = (expression: unknown) => expression as ExpressionSpecification;
const fadeOut = (until: number) => e(["interpolate", ["linear"], ["zoom"], until - 0.5, 1, until, 0]);
const fadeIn = (from: number) => e(["interpolate", ["linear"], ["zoom"], from, 0, from + 0.5, 1]);

function labelPaint(c: MapColors, opacity: ExpressionSpecification | number = 1) {
  return { "text-color": c.ink, "text-halo-color": c.halo, "text-halo-width": 1.5, "text-opacity": opacity };
}

export function regionLayers(c: MapColors): LayerProps[] {
  const opacity = fadeOut(ZOOM.regionsUntil);
  return [
    {
      id: "region-points",
      type: "circle",
      maxzoom: ZOOM.regionsUntil,
      paint: {
        "circle-radius": 8,
        "circle-color": c.brand,
        "circle-stroke-color": c.halo,
        "circle-stroke-width": 2,
        "circle-opacity": opacity,
        "circle-stroke-opacity": opacity,
      },
    },
    {
      id: "region-labels",
      type: "symbol",
      maxzoom: ZOOM.regionsUntil,
      layout: {
        "text-field": e(["concat", ["get", "name"], " · ", ["to-string", ["get", "crag_count"]]]),
        "text-font": FONT,
        "text-size": 13,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
      },
      paint: labelPaint(c, opacity),
    },
  ];
}

export function sectorLayers(c: MapColors): LayerProps[] {
  const { sectorsFrom: from, sectorsUntil: until } = ZOOM;
  const labelOpacity = e(["interpolate", ["linear"], ["zoom"], from, 0, from + 0.5, 1, until - 0.5, 1, until, 0]);
  const fillOpacity = e(["interpolate", ["linear"], ["zoom"], from, 0, from + 0.5, 0.35, until - 0.5, 0.35, until, 0]);
  return [
    {
      id: "sector-fill",
      type: "fill",
      minzoom: from,
      maxzoom: until,
      paint: { "fill-color": c.surface, "fill-opacity": fillOpacity },
    },
    // The outline stays at every closer zoom, so a sector's extent is visible next to its crags; only its name goes.
    {
      id: "sector-outline",
      type: "line",
      minzoom: from,
      paint: { "line-color": c.brand, "line-width": 1.2, "line-opacity": fadeIn(from) },
    },
    {
      id: "sector-labels",
      type: "symbol",
      minzoom: from,
      maxzoom: until,
      layout: { "text-field": e(["get", "name"]), "text-font": FONT, "text-size": 12 },
      paint: labelPaint(c, labelOpacity),
    },
  ];
}

export function cragLayers(c: MapColors): LayerProps[] {
  const groups: { id: string; kind: string; minzoom?: number }[] = [
    { id: "crags-isolated", kind: "obszar" },
    { id: "crags-loose", kind: "region", minzoom: ZOOM.looseCragsFrom },
    { id: "crags-sector", kind: "sektor", minzoom: ZOOM.sectorCragsFrom },
  ];
  return groups.flatMap(({ id, kind, minzoom }) => {
    const filter = e(["==", ["get", "area_kind"], kind]);
    const opacity = minzoom === undefined ? 1 : fadeIn(minzoom);
    return [
      {
        id,
        type: "circle",
        ...(minzoom === undefined ? {} : { minzoom }),
        filter,
        paint: {
          "circle-radius": e(["interpolate", ["linear"], ["zoom"], 9, 4, 15, 7]),
          "circle-color": e(["case", ["get", "needs_location"], NEEDS_LOCATION_COLOR, c.brand]),
          "circle-stroke-color": c.halo,
          "circle-stroke-width": 1.5,
          "circle-opacity": opacity,
          "circle-stroke-opacity": opacity,
        },
      },
      {
        id: `${id}-labels`,
        type: "symbol",
        minzoom: Math.max(minzoom ?? 0, 12),
        filter,
        layout: {
          "text-field": e(["get", "name"]),
          "text-font": FONT,
          "text-size": 11,
          "text-offset": [0, 0.9],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: labelPaint(c),
      },
    ] satisfies LayerProps[];
  });
}

/** Accent ring around the crags picked for a new sector (goes into the "crags" source). */
export function selectedCragLayer(c: MapColors, ids: number[]): LayerProps {
  return {
    id: "crag-selected",
    type: "circle",
    filter: e(["in", ["get", "id"], ["literal", ids]]),
    paint: {
      "circle-radius": e(["interpolate", ["linear"], ["zoom"], 9, 7, 15, 10]),
      "circle-color": c.ink,
      "circle-stroke-color": c.brand,
      "circle-stroke-width": 3,
    },
  };
}

/** Live outline of the new sector (goes into the "edit-hull" source). */
export function hullLayers(c: MapColors): LayerProps[] {
  return [
    { id: "edit-hull-fill", type: "fill", filter: e(["==", ["geometry-type"], "Polygon"]), paint: { "fill-color": c.surface, "fill-opacity": 0.45 } },
    { id: "edit-hull-line", type: "line", paint: { "line-color": c.brand, "line-width": 1.5, "line-dasharray": [3, 2] } },
  ];
}

/** Dashed line from the old place of a moved crag to the new one (goes into the "edit-move" source). */
export function moveLineLayer(c: MapColors): LayerProps {
  return { id: "edit-move-line", type: "line", paint: { "line-color": c.brand, "line-width": 2, "line-dasharray": [2, 2] } };
}

const FADE_HALF =0.25;
// [fade-in start, fade-out end] per interactive layer; null = no fade on that side.
const CLICKABLE_RANGE: Record<string, [number | null, number | null]> = {
  "region-points": [null, ZOOM.regionsUntil],
  "sector-fill": [ZOOM.sectorsFrom, ZOOM.sectorsUntil],
  "crags-isolated": [null, null],
  "crags-loose": [ZOOM.looseCragsFrom, null],
  "crags-sector": [ZOOM.sectorCragsFrom, null],
};

/** A layer is clickable only once its opacity ramp is at least halfway, so near-invisible objects can't be hit. */
export function isClickableAt(layerId: string, zoom: number): boolean {
  const range = CLICKABLE_RANGE[layerId];
  if (!range) return false;
  const [fadeInStart, fadeOutEnd] = range;
  if (fadeInStart !== null && zoom < fadeInStart + FADE_HALF) return false;
  if (fadeOutEnd !== null && zoom > fadeOutEnd - FADE_HALF) return false;
  return true;
}
