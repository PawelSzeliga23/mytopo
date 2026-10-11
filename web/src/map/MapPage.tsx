import "@/map/worker";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { AttributionControl, Layer, Marker, Source, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { formatViewHash, parseViewHash } from "@/map/view";
import { Button } from "@/components/ui/button";
import { aggregateBands, aggregateRanges, cragsByArea } from "@/lib/aggregate";
import type { AreaProps, CragProps } from "@/lib/api";
import { collectionOfKind, useRouteKind } from "@/lib/routeKind";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { DetailCard } from "@/map/DetailCard";
import { convexHull } from "@/map/edit/geo";
import { BROWSE, parseMoveParam, toggleCrag, type LngLat, type MapMode } from "@/map/edit/mode";
import { MoveCragBar } from "@/map/edit/MoveCragBar";
import { NewSectorBar } from "@/map/edit/NewSectorBar";
import {
  cragLayers,
  hullLayers,
  INTERACTIVE_LAYERS,
  isClickableAt,
  MAP_COLORS,
  moveLineLayer,
  regionLayers,
  sectorLayers,
  selectedCragLayer,
} from "@/map/layers";
import { LayerSwitcher } from "@/map/LayerSwitcher";
import type { Selection } from "@/map/selection";
import { BASE_LAYERS, buildBaseStyle, type BaseLayer } from "@/map/style";
import { TopBar } from "@/map/TopBar";
import { useMapData } from "@/map/useMapData";

// Edit-only dialogs: loaded when first opened, not with the map.
const AddCragBar = lazy(() => import("@/map/edit/AddCragDialog").then((m) => ({ default: m.AddCragBar })));
const AddCragDialog = lazy(() => import("@/map/edit/AddCragDialog").then((m) => ({ default: m.AddCragDialog })));
const NewSectorDialog = lazy(() => import("@/map/edit/NewSectorDialog").then((m) => ({ default: m.NewSectorDialog })));

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
  const location = useLocation();
  // The map view lives in the URL hash, so going back from a crag page (or reloading) restores it.
  const [initialView] = useState(() => parseViewHash(location.hash) ?? INITIAL_VIEW);
  const mapRef = useRef<MapRef>(null);
  const [base, setBase] = useState<BaseLayer>(readBase);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [cursor, setCursor] = useState("");
  const data = useMapData();
  const { kind: chosenKind } = useRouteKind();
  const { isEditor, reauthenticating } = useSession();
  // While the login dialog is open after a 401 the session is empty, but the edit UI must stay as it is.
  const editable = isEditor || reauthenticating;
  const [modeState, setMode] = useState<MapMode>(BROWSE);
  const [sectorDialog, setSectorDialog] = useState(false);
  // "Przesuń na mapie" on a crag page arrives as ?przesun=ID; it is read once and dropped from the address.
  const [pendingMove, setPendingMove] = useState(() => parseMoveParam(location.search));
  // The sport / trad filter hides crags and areas without such routes; editing the map (or a move about to start) shows everything.
  const kind = modeState.kind === "browse" && pendingMove === null ? chosenKind : "all";
  const regions = useMemo(() => collectionOfKind(data.regions, kind), [data.regions, kind]);
  const sectors = useMemo(() => collectionOfKind(data.sectors, kind), [data.sectors, kind]);
  const crags = useMemo(() => collectionOfKind(data.crags, kind), [data.crags, kind]);
  const { error } = data;
  // A card opened under another filter shows other numbers (or a hidden crag): close it when the filter changes.
  const [selectionKind, setSelectionKind] = useState(kind);
  if (selectionKind !== kind) {
    setSelectionKind(kind);
    setSelection(null);
  }

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
  const ranges = useMemo(
    () => aggregateRanges([...index.sectors.values()], [...index.crags.values()]),
    [index],
  );
  const cragLists = useMemo(
    () => cragsByArea([...index.sectors.values()], [...index.crags.values()]),
    [index],
  );
  const cragCenters = useMemo(
    () => new globalThis.Map((crags?.features ?? []).map((feature) => [feature.properties.id, feature.geometry.coordinates as LngLat])),
    [crags],
  );
  // A crag being moved that vanished from the map data (deleted meanwhile) ends the move: there is nothing to drag.
  const movedCragGone = modeState.kind === "move" && cragCenters.size > 0 && !cragCenters.has(modeState.crag.id);
  const mode = movedCragGone ? BROWSE : modeState;
  useEffect(() => {
    if (movedCragGone) toast.error("Tej skały już nie ma na mapie");
  }, [movedCragGone]);

  const selected = mode.kind === "sector" ? mode.selected : null;
  const hull = useMemo(() => {
    if (!selected) return null;
    const ring = convexHull(selected.map((id) => cragCenters.get(id)).filter((point): point is LngLat => !!point));
    const geometry =
      ring.length >= 3
        ? { type: "Polygon" as const, coordinates: [[...ring, ring[0]]] }
        : ring.length === 2
          ? { type: "LineString" as const, coordinates: ring }
          : null;
    return { type: "FeatureCollection" as const, features: geometry ? [{ type: "Feature" as const, properties: {}, geometry }] : [] };
  }, [selected, cragCenters]);

  const leaveEdit = useCallback(() => {
    setMode(BROWSE);
    setSectorDialog(false);
  }, []);

  useEffect(() => {
    if (pendingMove === null || !crags) return;
    const crag = index.crags.get(pendingMove);
    if (crag) setMode({ kind: "move", crag, target: null });
    setPendingMove(null);
    navigate({ hash: location.hash }, { replace: true });
  }, [pendingMove, crags, index, navigate, location.hash]);

  const editing = mode.kind !== "browse";
  useEffect(() => {
    if (!editing) return;
    function onKey(event: KeyboardEvent) {
      // An open dialog takes Escape for itself.
      if (event.key === "Escape" && !document.querySelector('[role="dialog"]')) leaveEdit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, leaveEdit]);

  function startMove(crag: CragProps) {
    setSelection(null);
    setMode({ kind: "move", crag, target: null });
    const center = cragCenters.get(crag.id);
    const map = mapRef.current;
    if (center && map) map.flyTo({ center, zoom: Math.max(map.getZoom(), 16), duration: 800 });
  }

  function startSector(region: AreaProps) {
    setSelection(null);
    setMode({ kind: "sector", region, selected: [] });
    const [minX, minY, maxX, maxY] = region.bbox;
    mapRef.current?.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding: 80, duration: 800 },
    );
  }

  function regionOf(crag: CragProps): number | null {
    return crag.area_kind === "sektor" ? (index.sectors.get(crag.area_id)?.parent_id ?? null) : crag.area_id;
  }

  // Feature properties coming back from MapLibre lose nested arrays (bbox, bands), so look the originals up by id.
  function handleClick(event: MapLayerMouseEvent) {
    const zoom = event.target.getZoom();
    const place: LngLat = [event.lngLat.lng, event.lngLat.lat];
    // The edit modes own the click: it never opens a card.
    if (mode.kind === "move") return setMode({ ...mode, target: place });
    if (mode.kind === "add") return setMode({ kind: "add", point: place });
    if (mode.kind === "sector") {
      const hit = event.features?.find((candidate) => candidate.layer.id.startsWith("crags-") && isClickableAt(candidate.layer.id, zoom));
      const clicked = hit && index.crags.get(Number(hit.properties?.id));
      if (!clicked) return;
      if (regionOf(clicked) === mode.region.id) setMode(toggleCrag(mode, clicked.id));
      else toast.error("Ta skała jest w innym regionie");
      return;
    }
    const feature = event.features?.find((candidate) => isClickableAt(candidate.layer.id, zoom));
    if (!feature) {
      setSelection(null);
      return;
    }
    const id = Number(feature.properties?.id);
    const layer = feature.layer.id;
    if (layer === "region-points" || layer === "sector-fill" || layer === "sector-outline-hit") {
      const area = (layer === "region-points" ? index.regions : index.sectors).get(id);
      if (area) selectArea(area);
      return;
    }
    const crag = index.crags.get(id);
    if (crag) setSelection({ type: "crag", crag });
  }

  function selectArea(area: AreaProps) {
    setSelection({
      type: area.kind === "sektor" ? "sektor" : "region",
      area,
      bands: bands.get(area.id) ?? [0, 0, 0, 0],
      range: ranges.get(area.id) ?? null,
      crags: cragLists.get(area.id) ?? [],
    });
  }

  // A region or sector picked in the search: framed on the map, with its card open.
  function focusArea(id: number) {
    const area = index.regions.get(id) ?? index.sectors.get(id);
    if (!area) return;
    zoomTo(area.bbox);
    selectArea(area);
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

  function selectCrag(crag: CragProps) {
    setSelection({ type: "crag", crag });
    const center = cragCenters.get(crag.id);
    const map = mapRef.current;
    if (center && map) map.flyTo({ center, zoom: Math.max(map.getZoom(), 15), duration: 800 });
  }

  const moveOrigin = mode.kind === "move" ? cragCenters.get(mode.crag.id) : undefined;

  return (
    <div className="fixed inset-0 bg-map-bg">
      <Map
        ref={mapRef}
        initialViewState={initialView}
        mapStyle={style}
        interactiveLayerIds={INTERACTIVE_LAYERS}
        onClick={handleClick}
        onMouseMove={(event) =>
          setCursor(event.features?.some((feature) => isClickableAt(feature.layer.id, event.target.getZoom())) ? "pointer" : "")
        }
        onMouseLeave={() => setCursor("")}
        onMoveEnd={(event) => {
          // A move can end after a search pick already left the map: the view must not replace that page's address.
          if (window.location.pathname === "/") navigate({ hash: formatViewHash(event.viewState) }, { replace: true });
        }}
        cursor={mode.kind === "move" || mode.kind === "add" ? "crosshair" : cursor}
        style={{ position: "absolute", inset: 0 }}
        attributionControl={false}
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
            {mode.kind === "sector" && <Layer {...selectedCragLayer(colors, mode.selected)} />}
          </Source>
        )}
        {hull && (
          <Source id="edit-hull" type="geojson" data={hull}>
            {hullLayers(colors).map((layer) => (
              <Layer key={layer.id} {...layer} />
            ))}
          </Source>
        )}
        {mode.kind === "move" && moveOrigin && mode.target && (
          <Source
            id="edit-move"
            type="geojson"
            data={{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [moveOrigin, mode.target] } }}
          >
            <Layer {...moveLineLayer(colors)} />
          </Source>
        )}
        {mode.kind === "move" && moveOrigin && (
          <>
            <Marker longitude={moveOrigin[0]} latitude={moveOrigin[1]}>
              <div aria-hidden className="size-3.5 rounded-full border-2 border-background bg-brand opacity-35" />
            </Marker>
            <Marker
              longitude={(mode.target ?? moveOrigin)[0]}
              latitude={(mode.target ?? moveOrigin)[1]}
              draggable
              onDrag={(event) => {
                const target: LngLat = [event.lngLat.lng, event.lngLat.lat];
                setMode((current) => (current.kind === "move" ? { ...current, target } : current));
              }}
            >
              <div role="img" aria-label="Nowe położenie skały" className="size-[18px] cursor-grab rounded-full border-2 border-background bg-brand shadow-float" />
            </Marker>
          </>
        )}
        {mode.kind === "add" && mode.point && (
          <Marker longitude={mode.point[0]} latitude={mode.point[1]}>
            <div aria-hidden className="size-3.5 rounded-full border-2 border-background bg-foreground" />
          </Marker>
        )}
        {/* Bottom-left, so the base-layer switcher in the bottom-right corner never covers it. */}
        <AttributionControl position="bottom-left" compact />
      </Map>
      {mode.kind === "browse" && (
        <TopBar
          areas={[...index.regions.values(), ...index.sectors.values()]}
          onPickArea={focusArea}
          onPickCrag={(id) => {
            const crag = index.crags.get(id);
            if (crag) selectCrag(crag);
          }}
        />
      )}
      <LayerSwitcher
        value={base}
        onChange={(next) => {
          setBase(next);
          saveBase(next);
        }}
      />
      {error && (
        <div role="alert" className="absolute inset-x-3 top-28 z-10 rounded-[10px] bg-destructive md:top-20 px-4 py-2 text-sm text-white lg:w-[520px]">
          Nie udało się wczytać mapy: {error.message}
        </div>
      )}
      {mode.kind === "browse" && editable && (
        <Button
          className="absolute bottom-32 right-3 z-10 shadow-float"
          onClick={() => {
            setSelection(null);
            setMode({ kind: "add", point: null });
          }}
        >
          + Dodaj skałę
        </Button>
      )}
      {mode.kind === "move" && moveOrigin && (
        <MoveCragBar crag={mode.crag} origin={moveOrigin} target={mode.target} onCancel={leaveEdit} onSaved={leaveEdit} />
      )}
      {/* One boundary per lazy part: a dialog loading for the first time must not hide the bar beside it. */}
      <Suspense fallback={null}>{mode.kind === "add" && !mode.point && <AddCragBar onCancel={leaveEdit} />}</Suspense>
      <Suspense fallback={null}>
        {mode.kind === "add" && mode.point && (
          <AddCragDialog point={mode.point} regions={[...index.regions.values()]} sectors={[...index.sectors.values()]} onClose={leaveEdit} />
        )}
      </Suspense>
      {mode.kind === "sector" && (
        <NewSectorBar
          crags={mode.selected.length}
          routes={mode.selected.reduce((sum, id) => sum + (index.crags.get(id)?.route_count ?? 0), 0)}
          onCancel={leaveEdit}
          onNext={() => setSectorDialog(true)}
        />
      )}
      <Suspense fallback={null}>
        {mode.kind === "sector" && sectorDialog && (
          <NewSectorDialog
            region={mode.region}
            crags={mode.selected.flatMap((id) => {
              const crag = index.crags.get(id);
              if (!crag) return [];
              const fromSector = crag.area_kind === "sektor" ? (index.sectors.get(crag.area_id)?.name ?? null) : null;
              return [{ id, name: crag.name, fromSector }];
            })}
            onBack={() => setSectorDialog(false)}
            onCreated={leaveEdit}
          />
        )}
      </Suspense>
      <DetailCard
        selection={mode.kind === "browse" ? selection : null}
        onClose={() => setSelection(null)}
        onZoom={zoomTo}
        onSelectCrag={selectCrag}
        onOpenCrag={(slug) => navigate(`/skaly/${slug}`)}
        onOpenArea={(slug) => navigate(`/obszary/${slug}`)}
        editable={editable}
        onNewSector={startSector}
        onMoveCrag={startMove}
        onAreaEdited={() => setSelection(null)}
      />
    </div>
  );
}
