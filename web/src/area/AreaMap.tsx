import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection, Point } from "geojson";
import { useMemo, useState } from "react";
import Map, { Layer, Source, type MapLayerMouseEvent } from "react-map-gl/maplibre";
import { api, type AreaDetail } from "@/lib/api";
import { collectionOfKind, itemsOfKind, useRouteKind } from "@/lib/routeKind";
import { useTheme } from "@/lib/theme";
import { MAP_COLORS } from "@/map/layers";
import { buildBaseStyle } from "@/map/style";

const FONT = ["Noto Sans Bold"];

/** A small map of an area: outlines of its sectors and pins of its crags; a pin opens the crag. */
export default function AreaMap({ area, onOpenCrag }: { area: AreaDetail; onOpenCrag: (slug: string) => void }) {
  const { theme } = useTheme();
  const colors = MAP_COLORS[theme];
  const { kind } = useRouteKind();
  const style = useMemo(() => buildBaseStyle("osm", theme === "dark"), [theme]);
  const hulls = useQuery({ queryKey: ["map", "sectors"], queryFn: api.sectorHulls });
  const [cursor, setCursor] = useState("");
  const sectors = useMemo(
    () => {
      const shown = collectionOfKind(hulls.data, kind);
      return shown && { ...shown, features: shown.features.filter((feature) => feature.properties.id === area.id || feature.properties.parent_id === area.id) };
    },
    [hulls.data, area.id, kind],
  );
  const crags = useMemo<FeatureCollection<Point, { slug: string; name: string }>>(
    () => ({
      type: "FeatureCollection",
      features: itemsOfKind(area.crags, kind)
        .filter((crag) => crag.lng !== null && crag.lat !== null)
        .map((crag) => ({ type: "Feature", geometry: { type: "Point", coordinates: [crag.lng!, crag.lat!] }, properties: { slug: crag.slug, name: crag.name } })),
    }),
    [area.crags, kind],
  );
  if (!area.bbox) return null;
  const [minX, minY, maxX, maxY] = area.bbox;
  const open = (event: MapLayerMouseEvent) => {
    const slug = event.features?.[0]?.properties?.slug;
    if (typeof slug === "string") onOpenCrag(slug);
  };
  return (
    <Map
      initialViewState={{ bounds: [minX, minY, maxX, maxY], fitBoundsOptions: { padding: 40, maxZoom: 16 } }}
      mapStyle={style}
      interactiveLayerIds={["area-crags"]}
      onClick={open}
      onMouseMove={(event) => setCursor(event.features?.length ? "pointer" : "")}
      cursor={cursor}
      attributionControl={false}
      style={{ position: "absolute", inset: 0 }}
    >
      {sectors && (
        <Source id="area-sectors" type="geojson" data={sectors}>
          <Layer id="area-sector-fill" type="fill" paint={{ "fill-color": colors.surface, "fill-opacity": 0.35 }} />
          <Layer id="area-sector-outline" type="line" paint={{ "line-color": colors.brand, "line-width": 1.5 }} />
        </Source>
      )}
      <Source id="area-crags-source" type="geojson" data={crags}>
        <Layer
          id="area-crags"
          type="circle"
          paint={{ "circle-radius": 6, "circle-color": colors.brand, "circle-stroke-color": colors.halo, "circle-stroke-width": 2 }}
        />
        <Layer
          id="area-crag-labels"
          type="symbol"
          minzoom={14}
          layout={{ "text-field": ["get", "name"], "text-font": FONT, "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top" }}
          paint={{ "text-color": colors.ink, "text-halo-color": colors.halo, "text-halo-width": 1.5 }}
        />
      </Source>
    </Map>
  );
}
