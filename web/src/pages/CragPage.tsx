import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { CragInfo } from "@/crag/CragInfo";
import { RouteList } from "@/crag/RouteList";
import { routeRows, type RouteRow } from "@/crag/topo";
import { compactSpacer, phoneViewerHeight, useCompactOnScroll } from "@/crag/useCompactOnScroll";
import { WallThumbnails, wallLabel } from "@/crag/WallThumbnails";
import { WallViewer } from "@/crag/WallViewer";
import { api, ApiError } from "@/lib/api";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { formatViewHash } from "@/map/view";

const CRAG_ZOOM = 15;

export default function CragPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const compact = useCompactOnScroll(!isDesktop);
  const { data: crag, error, isPending } = useQuery({ queryKey: ["crag", slug], queryFn: () => api.crag(slug) });
  const [wallId, setWallId] = useState<number | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [hoveredRouteId, setHoveredRouteId] = useState<number | null>(null);

  useEffect(() => {
    if (!crag) return;
    document.title = `${crag.name} · topo`;
    return () => {
      document.title = "topo";
    };
  }, [crag]);

  const routes = useMemo(() => new Map((crag?.routes ?? []).map((route) => [route.id, route])), [crag]);
  const wall = crag?.walls.find((candidate) => candidate.id === wallId) ?? crag?.walls[0] ?? null;
  const rows = useMemo(() => (crag ? routeRows(crag, wall?.id ?? null) : { onWall: [], other: [] }), [crag, wall]);
  const wallNames = useMemo(() => new Map((crag?.walls ?? []).map((candidate, index) => [candidate.id, wallLabel(candidate, index)])), [crag]);

  function backToMap() {
    // Came from the map: go back, so the map restores its view from the URL. Opened from a link: show the map at this crag.
    if (location.key !== "default") navigate(-1);
    else navigate(crag ? `/${formatViewHash({ longitude: crag.lng, latitude: crag.lat, zoom: CRAG_ZOOM })}` : "/");
  }

  function chooseRow(row: RouteRow) {
    if (row.wallId !== null && row.wallId !== wall?.id) setWallId(row.wallId);
    setSelectedRouteId((current) => (current === row.route.id ? null : row.route.id));
  }

  const aspect = wall?.image_width && wall.image_height ? wall.image_height / wall.image_width : 4 / 3;
  const viewerHeight = isDesktop ? "calc(100vh - 13rem)" : phoneViewerHeight(aspect, compact);
  const spacer = compactSpacer(aspect, compact);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 lg:px-6">
      <header className="flex items-center justify-between py-3">
        <button type="button" onClick={backToMap} aria-label="Wróć do mapy">
          <Logo />
        </button>
        <div className="flex items-center gap-2">
          <UserMenu />
          <ThemeToggle />
        </div>
      </header>
      {isPending && <p className="text-muted-foreground">Wczytywanie…</p>}
      {error && <p role="alert">{error instanceof ApiError && error.status === 404 ? "Nie znaleziono skały" : error.message}</p>}
      {crag && (
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[58fr_42fr] lg:items-start lg:gap-8">
          {/* Phone: "contents" makes these direct children of the long column, so the photo can stick while the list scrolls. */}
          <div className="contents lg:sticky lg:top-4 lg:flex lg:flex-col lg:gap-3">
            <div>
              <nav className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <button type="button" onClick={backToMap} className="uppercase hover:text-foreground">
                  ← Mapa
                </button>
                {crag.path.map((area) => (
                  <Fragment key={area.id}>
                    {" · "}
                    <span>{area.name}</span>
                  </Fragment>
                ))}
              </nav>
              <h1 className="font-display text-4xl font-extrabold tracking-tight">{crag.name}</h1>
            </div>
            {wall ? (
              <div className="sticky top-0 z-10 -mx-4 bg-background lg:static lg:mx-0">
                <WallViewer
                  key={wall.id}
                  wall={wall}
                  routes={routes}
                  selectedRouteId={selectedRouteId}
                  hoveredRouteId={hoveredRouteId}
                  onSelectRoute={setSelectedRouteId}
                  onHoverRoute={setHoveredRouteId}
                  className="transition-[height] duration-200 lg:rounded-[10px]"
                  style={{ height: viewerHeight }}
                />
              </div>
            ) : (
              <p className="rounded-[10px] bg-secondary p-4 text-sm text-muted-foreground">Ta skała nie ma jeszcze zdjęć z topo.</p>
            )}
            {crag.walls.length > 1 && <WallThumbnails walls={crag.walls} activeId={wall?.id ?? null} onSelect={setWallId} />}
          </div>
          <div className="flex flex-col gap-4">
            <CragInfo crag={crag} descriptionOpen={isDesktop} />
            <RouteList
              rows={rows}
              wallNames={wallNames}
              selectedRouteId={selectedRouteId}
              hoveredRouteId={hoveredRouteId}
              onChoose={chooseRow}
              onHover={setHoveredRouteId}
            />
            {crag.source === "portalgorski" && crag.source_url && (
              <p className="text-xs text-muted-foreground">
                Źródło danych:{" "}
                <a href={crag.source_url} target="_blank" rel="noreferrer" className="underline">
                  Portal Górski
                </a>
              </p>
            )}
          </div>
          {spacer && <div aria-hidden style={{ height: spacer }} />}
        </div>
      )}
    </div>
  );
}
