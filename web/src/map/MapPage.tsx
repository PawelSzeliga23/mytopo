import "@/map/worker";
import { useMemo, useRef, useState } from "react";
import Map, { Layer, Source, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import { useNavigate } from "react-router";
import { aggregateBands } from "@/lib/aggregate";
import type { AreaProps, CragProps } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { DetailCard } from "@/map/DetailCard";
import { cragLayers, INTERACTIVE_LAYERS, isClickableAt, MAP_COLORS, regionLayers, sectorLayers } from "@/map/layers";
import { LayerSwitcher } from "@/map/LayerSwitcher";
import type { Selection } from "@/map/selection";
import { BASE_LAYERS, buildBaseStyle, type BaseLayer } from "@/map/style";
import { TopBar } from "@/map/TopBar";
import { useMapData } from "@/map/useMapData";

const BASE_KEY = "topo-base";
const INITIAL_VIEW = { longitude: 19.8, latitude: 50.35, zoom: 8 };

function readBase(): BaseLayer {
  try {
    const saved = localStorage.getItem(BASE_KEY);
    return BASE_LAYERS.some((layer) => layer.id === saved) ? (saved as BaseLayer) : "osm";
  } catch {
    return "osm";
  }
}

function saveBase(base: BaseLayer): void {
  try {
    localStorage.setItem(BASE_KEY, base);
  } catch {
    // not remembered in private mode
  }
}

function byId<P extends { id: number }>(collection?: { features: { properties: P }[] }): globalThis.Map<number, P> {
  return new globalThis.Map((collection?.features ?? []).map((feature) => [feature.properties.id, feature.properties]));
}

export default function MapPage() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const mapRef = useRef<MapRef>(null);
  const [base, setBase] = useState<BaseLayer>(readBase);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [cursor, setCursor] = useState("");
  const { regions, sectors, crags, error } = useMapData();

  const style = useMemo(() => buildBaseStyle(base, theme === "dark"), [base, theme]);
  const colors = MAP_COLORS[theme];
  const index = useMemo(
    () => ({ regions: byId<AreaProps>(regions), sectors: byId<AreaProps>(sectors), crags: byId<CragProps>(crags) }),
    [regions, sectors, crags],
  );
  const bands = useMemo(
    () => aggregateBands([...index.sectors.values()], [...index.crags.values()]),
    [index],
  );

  // Feature properties coming back from MapLibre lose nested arrays (bbox, bands), so look the originals up by id.
  function handleClick(event: MapLayerMouseEvent) {
    const zoom = event.target.getZoom();
    const feature = event.features?.find((candidate) => isClickableAt(candidate.layer.id, zoom));
    if (!feature) {
      setSelection(null);
      return;
    }
    const id = Number(feature.properties?.id);
    const layer = feature.layer.id;
    if (layer === "region-points" || layer === "sector-fill") {
      const area = (layer === "region-points" ? index.regions : index.sectors).get(id);
      if (area) setSelection({ type: area.kind === "sektor" ? "sektor" : "region", area, bands: bands.get(id) ?? [0, 0, 0, 0] });
      return;
    }
    const crag = index.crags.get(id);
    if (crag) setSelection({ type: "crag", crag });
  }

  function zoomTo([minX, minY, maxX, maxY]: [number, number, number, number]) {
    mapRef.current?.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding: 80, duration: 800 },
    );
    setSelection(null);
  }

  return (
    <div className="fixed inset-0 bg-map-bg">
      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        mapStyle={style}
        interactiveLayerIds={INTERACTIVE_LAYERS}
        onClick={handleClick}
        onMouseMove={(event) =>
          setCursor(event.features?.some((feature) => isClickableAt(feature.layer.id, event.target.getZoom())) ? "pointer" : "")
        }
        onMouseLeave={() => setCursor("")}
        cursor={cursor}
        style={{ position: "absolute", inset: 0 }}
        attributionControl={{ compact: true }}
      >
        {sectors && (
          <Source id="sectors" type="geojson" data={sectors}>
            {sectorLayers(colors).map((layer) => (
              <Layer key={layer.id} {...layer} />
            ))}
          </Source>
        )}
        {regions && (
          <Source id="regions" type="geojson" data={regions}>
            {regionLayers(colors).map((layer) => (
              <Layer key={layer.id} {...layer} />
            ))}
          </Source>
        )}
        {crags && (
          <Source id="crags" type="geojson" data={crags}>
            {cragLayers(colors).map((layer) => (
              <Layer key={layer.id} {...layer} />
            ))}
          </Source>
        )}
      </Map>
      <TopBar />
      <LayerSwitcher
        value={base}
        onChange={(next) => {
          setBase(next);
          saveBase(next);
        }}
      />
      {error && (
        <div role="alert" className="absolute inset-x-3 top-20 z-10 rounded-[10px] bg-destructive px-4 py-2 text-sm text-white lg:w-[520px]">
          Nie udało się wczytać mapy: {error.message}
        </div>
      )}
      <DetailCard
        selection={selection}
        onClose={() => setSelection(null)}
        onZoom={zoomTo}
        onOpenCrag={(slug) => navigate(`/skaly/${slug}`)}
      />
    </div>
  );
}
