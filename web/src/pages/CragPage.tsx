import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { CragInfo } from "@/crag/CragInfo";
import { CragEditForm } from "@/crag/edit/CragEditForm";
import { CragMenu } from "@/crag/edit/CragMenu";
import { RouteEditPanel } from "@/crag/edit/RouteEditPanel";
import { HistoryPanel } from "@/history/HistoryPanel";
import { RouteList } from "@/crag/RouteList";
import { routeRows, type RouteRow } from "@/crag/topo";
import { compactSpacer, phoneViewerHeight, useCompactOnScroll } from "@/crag/useCompactOnScroll";
import { WallThumbnails, wallLabel } from "@/crag/WallThumbnails";
import { WallViewer } from "@/crag/WallViewer";
import { api, ApiError, type RouteOut } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { formatViewHash } from "@/map/view";

const CRAG_ZOOM = 15;

export default function CragPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const compact = useCompactOnScroll(!isDesktop);
  const { isEditor, reauthenticating } = useSession();
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data: crag, error, isPending } = useQuery({ queryKey: ["crag", slug], queryFn: () => api.crag(slug) });
  const [wallId, setWallId] = useState<number | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [hoveredRouteId, setHoveredRouteId] = useState<number | null>(null);
  // The route panel: null = closed, { route: null } = a new route. It stays mounted while open, whatever the session does.
  const [panel, setPanel] = useState<{ route: RouteOut | null } | null>(null);

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

  // Named after the wall, or "Ściana n"; a lone unnamed wall needs no caption.
  const wallCaption = wall && crag && (wall.name ?? (crag.walls.length > 1 ? `Ściana ${crag.walls.indexOf(wall) + 1}` : null));

  function backToMap() {
    // Came from the map: go back, so the map restores its view from the URL. Opened from a link: show the map at this crag.
    if (location.key !== "default") navigate(-1);
    else navigate(crag ? `/${formatViewHash({ longitude: crag.lng, latitude: crag.lat, zoom: CRAG_ZOOM })}` : "/");
  }

  function chooseRow(row: RouteRow) {
    if (row.wallId !== null && row.wallId !== wall?.id) setWallId(row.wallId);
    setSelectedRouteId((current) => (current === row.route.id ? null : row.route.id));
  }

  function editRoute(route: RouteOut) {
    setSelectedRouteId(route.id);
    setPanel({ route });
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
              {!editing && (
                <div className="flex items-start justify-between gap-2">
                  <h1 className="font-display text-4xl font-extrabold tracking-tight">{crag.name}</h1>
                  {(isEditor || reauthenticating) && (
                    <div className="flex shrink-0 items-center gap-1.5 pt-1.5">
                      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                        ✎ Edytuj skałę
                      </Button>
                      <CragMenu crag={crag} wall={wall} onHistory={() => setHistoryOpen(true)} />
                    </div>
                  )}
                </div>
              )}
            </div>
            {wallCaption && (
              <p data-testid="wall-caption" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {crag.name} · {wallCaption}
              </p>
            )}
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
            {editing ? <CragEditForm crag={crag} onDone={() => setEditing(false)} /> : <CragInfo crag={crag} descriptionOpen={isDesktop} />}
            <RouteList
              rows={rows}
              wallNames={wallNames}
              selectedRouteId={selectedRouteId}
              hoveredRouteId={hoveredRouteId}
              onChoose={chooseRow}
              onHover={setHoveredRouteId}
              editable={isEditor || reauthenticating}
              onEdit={editRoute}
              onAdd={() => setPanel({ route: null })}
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
          {historyOpen && <HistoryPanel crag={crag} onClose={() => setHistoryOpen(false)} />}
          {panel && <RouteEditPanel key={panel.route?.id ?? "new"} cragId={crag.id} slug={crag.slug} route={panel.route} onClose={() => setPanel(null)} />}
        </div>
      )}
    </div>
  );
}
