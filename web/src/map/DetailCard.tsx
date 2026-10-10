import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { Chip } from "@/components/Chip";
import { GradeBadge } from "@/components/GradeBadge";
import { GradeBar } from "@/components/GradeBar";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { api, type AreaProps, type CragProps } from "@/lib/api";
import { cragGradeRange, formatGradeRange } from "@/lib/grades";
import { countLabel, DROGI, SKALY } from "@/lib/plural";
import { compareRoutes } from "@/lib/routes";
import { useIsDesktop } from "@/lib/useMediaQuery";
import type { Selection } from "@/map/selection";

const AreaEditDialog = lazy(() => import("@/map/edit/AreaEditDialog").then((m) => ({ default: m.AreaEditDialog })));

type BBox = [number, number, number, number];

interface BodyProps {
  selection: Selection;
  onZoom: (bbox: BBox) => void;
  onOpenCrag: (slug: string) => void;
  /** Opens the page of a region or sector (its crag list); without it the button is hidden. */
  onOpenArea?: (slug: string) => void;
  onSelectCrag: (crag: CragProps) => void;
  /** Shows the edit controls (logged in, or logging in again). */
  editable?: boolean;
  onNewSector?: (region: AreaProps) => void;
  /** Starts moving the crag's pin on the map. */
  onMoveCrag?: (crag: CragProps) => void;
  /** The area was edited or deleted, so the card is stale. */
  onAreaEdited?: () => void;
}

const KIND_LABEL = { region: "Region", sektor: "Sektor", crag: "Skała" } as const;

const PREVIEW_LIMIT = 8;

function CragRoutesPreview({ slug, onOpen }: { slug: string; onOpen: () => void }) {
  // Same query key as the crag page, so opening the crag afterwards is instant.
  const { data, isPending, isError } = useQuery({ queryKey: ["crag", slug], queryFn: () => api.crag(slug) });
  if (isPending) return <p className="text-xs text-muted-foreground">Wczytywanie dróg…</p>;
  if (isError) return <p className="text-xs text-muted-foreground">Nie udało się wczytać listy dróg.</p>;
  const routes = [...data.routes].sort(compareRoutes);
  if (routes.length === 0) return null;
  const rest = routes.length - PREVIEW_LIMIT;
  return (
    <div className="flex flex-col">
      <ul aria-label="Drogi" className="flex flex-col divide-y divide-border text-sm">
        {routes.slice(0, PREVIEW_LIMIT).map((route) => (
          <li key={route.id} className="flex items-center justify-between gap-2 py-1">
            <span className="truncate font-display font-semibold">{route.name}</span>
            <GradeBadge grade={route.grade} sort={route.grade_sort} />
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <button type="button" onClick={onOpen} className="mt-1 self-start text-xs font-semibold text-brand hover:underline">
          {`i jeszcze ${countLabel(rest, DROGI)} →`}
        </button>
      )}
    </div>
  );
}

function AreaCragList({ crags, onSelect }: { crags: CragProps[]; onSelect: (crag: CragProps) => void }) {
  if (crags.length === 0) return null;
  const sorted = [...crags].sort((a, b) => b.route_count - a.route_count || a.name.localeCompare(b.name, "pl"));
  const rest = sorted.length - PREVIEW_LIMIT;
  return (
    <div className="flex flex-col">
      <ul aria-label="Skały" className="flex flex-col divide-y divide-border text-sm">
        {sorted.slice(0, PREVIEW_LIMIT).map((crag) => (
          <li key={crag.id}>
            <button type="button" onClick={() => onSelect(crag)} className="flex w-full items-center justify-between gap-2 py-1 text-left hover:text-brand">
              <span className="truncate font-display font-semibold">{crag.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{countLabel(crag.route_count, DROGI)}</span>
            </button>
          </li>
        ))}
      </ul>
      {rest > 0 && <p className="mt-1 text-xs text-muted-foreground">{`i jeszcze ${countLabel(rest, SKALY)}`}</p>}
    </div>
  );
}

function UnplacedList({ crags, onPlace }: { crags: CragProps[]; onPlace: (crag: CragProps) => void }) {
  const unplaced = crags.filter((crag) => crag.needs_location);
  if (unplaced.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold">{`Do rozstawienia: ${unplaced.length}`}</p>
      <ul aria-label="Do rozstawienia" className="flex flex-col divide-y divide-border text-sm">
        {unplaced.map((crag) => (
          <li key={crag.id} className="flex items-center justify-between gap-2 py-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-[#E0A100]" />
              <span className="truncate">{crag.name}</span>
            </span>
            <Button type="button" size="xs" onClick={() => onPlace(crag)}>
              Ustaw na mapie
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DetailCardBody({ selection, onZoom, onOpenCrag, onOpenArea, onSelectCrag, editable, onNewSector, onMoveCrag, onAreaEdited }: BodyProps) {
  const [editingArea, setEditingArea] = useState(false);
  const name = selection.type === "crag" ? selection.crag.name : selection.area.name;
  const range = formatGradeRange(selection.type === "crag" ? cragGradeRange(selection.crag) : selection.range);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{KIND_LABEL[selection.type]}</p>
      {/* The pencil sits beside the heading, not in it: the heading's name is the area's name alone. */}
      <div className="flex items-baseline gap-2 pr-6">
        <h2 className="font-display text-2xl font-extrabold leading-tight tracking-tight">{name}</h2>
        {editable && selection.type !== "crag" && (
          <button type="button" aria-label="Edytuj obszar" onClick={() => setEditingArea(true)} className="text-base text-muted-foreground hover:text-foreground">
            ✎
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {selection.type === "crag" ? (
          <Chip>{countLabel(selection.crag.route_count, DROGI)}</Chip>
        ) : (
          <>
            <Chip>{countLabel(selection.area.crag_count, SKALY)}</Chip>
            <Chip>{countLabel(selection.area.route_count, DROGI)}</Chip>
          </>
        )}
        {range && <Chip>{range}</Chip>}
      </div>
      <GradeBar bands={selection.type === "crag" ? selection.crag.grade_bands : selection.bands} />
      {selection.type === "crag" ? (
        <>
          <CragRoutesPreview slug={selection.crag.slug} onOpen={() => onOpenCrag(selection.crag.slug)} />
          <Button className="mt-2" onClick={() => onOpenCrag(selection.crag.slug)}>
            Otwórz skałę
          </Button>
          {editable && onMoveCrag && (
            <Button variant="outline" onClick={() => onMoveCrag(selection.crag)}>
              Przesuń na mapie
            </Button>
          )}
        </>
      ) : (
        <>
          <AreaCragList crags={selection.crags} onSelect={onSelectCrag} />
          {editable && onMoveCrag && <UnplacedList crags={selection.crags} onPlace={onMoveCrag} />}
          <div className="mt-2 flex gap-2">
            <Button className="flex-1" onClick={() => onZoom(selection.area.bbox)}>
              Przybliż
            </Button>
            {onOpenArea && (
              <Button variant="outline" className="flex-1" onClick={() => onOpenArea(selection.area.slug)}>
                Lista skał
              </Button>
            )}
          </div>
          {editable && selection.type === "region" && onNewSector && (
            <Button variant="outline" onClick={() => onNewSector(selection.area)}>
              + Nowy sektor
            </Button>
          )}
          {editingArea && (
            <Suspense fallback={null}>
            <AreaEditDialog
              area={selection.area}
              onClose={() => setEditingArea(false)}
              onDone={() => {
                setEditingArea(false);
                onAreaEdited?.();
              }}
            />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}

interface CardProps extends Omit<BodyProps, "selection"> {
  selection: Selection | null;
  onClose: () => void;
}

export function DetailCard({ selection, onClose, ...body }: CardProps) {
  const isDesktop = useIsDesktop();
  // Keep the last selection so the phone drawer keeps its content while it animates closed.
  const [lastSelection, setLastSelection] = useState(selection);
  if (selection !== null && selection !== lastSelection) setLastSelection(selection);
  if (isDesktop) {
    if (selection === null) return null;
    return (
      <aside className="absolute right-3 top-3 z-20 max-h-[calc(100vh-1.5rem)] w-80 overflow-y-auto rounded-[10px] bg-background p-4 shadow-float">
        <button type="button" aria-label="Zamknij" onClick={onClose} className="absolute right-3 top-2 text-lg text-muted-foreground hover:text-foreground">
          ×
        </button>
        <DetailCardBody selection={selection} {...body} />
      </aside>
    );
  }
  return (
    <Drawer open={selection !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[85vh] px-4 pb-6">
        <DrawerTitle className="sr-only">Szczegóły</DrawerTitle>
        <DrawerDescription className="sr-only">Informacje o wybranym miejscu na mapie</DrawerDescription>
        <div className="overflow-y-auto">
          {lastSelection && <DetailCardBody selection={lastSelection} {...body} />}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
