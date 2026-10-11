import { useQuery } from "@tanstack/react-query";
import { Fragment, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Chip } from "@/components/Chip";
import { GradeBar } from "@/components/GradeBar";
import { BackAndMap } from "@/components/BackAndMap";
import { Logo } from "@/components/Logo";
import { RouteKindToggle } from "@/components/RouteKindToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { sortCrags, type CragSort } from "@/area/sort";
import { api, ApiError, type AreaDetail } from "@/lib/api";
import { countLabel, DROGI, REGIONY, SEKTORY, SKALY } from "@/lib/plural";
import { itemsOfKind, useRouteKind } from "@/lib/routeKind";
import { formatViewHash } from "@/map/view";

const AreaMap = lazy(() => import("@/area/AreaMap"));

type Sort = CragSort;
const SORTS: { value: Sort; label: string }[] = [
  { value: "name", label: "nazwa" },
  { value: "routes", label: "liczba dróg" },
  { value: "grade", label: "trudność" },
];
const KIND_LABEL = { obszar: "Obszar", region: "Region", sektor: "Sektor" } as const;



/** The main map framed on the area: zoom from the width of its bounding box. */
function mapLink(area: AreaDetail): string {
  if (!area.center || !area.bbox) return "/";
  const width = Math.max(area.bbox[2] - area.bbox[0], (area.bbox[3] - area.bbox[1]) * 1.5, 0.002);
  const zoom = Math.min(16, Math.max(8, Math.log2(360 / width) - 0.8));
  return `/${formatViewHash({ longitude: area.center[0], latitude: area.center[1], zoom })}`;
}

export default function AreaPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { data: area, error, isPending } = useQuery({ queryKey: ["area", slug], queryFn: () => api.area(slug) });
  const [sort, setSort] = useState<Sort>("name");
  // The sport / trad filter: statistics of that kind only, areas and crags without such routes hidden.
  const { kind } = useRouteKind();
  const children = useMemo(() => itemsOfKind(area?.children ?? [], kind), [area, kind]);
  const crags = useMemo(() => sortCrags(itemsOfKind(area?.crags ?? [], kind), sort), [area, sort, kind]);

  useEffect(() => {
    if (!area) return;
    document.title = `${area.name} · topo`;
    return () => {
      document.title = "topo";
    };
  }, [area]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 lg:px-6">
      <header className="flex items-center justify-between py-3">
        <Link to="/" aria-label="topo — mapa">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <RouteKindToggle />
          <UserMenu />
          <ThemeToggle />
        </div>
      </header>
      {isPending && <p className="text-muted-foreground">Wczytywanie…</p>}
      {error && <p role="alert">{error instanceof ApiError && error.status === 404 ? "Nie znaleziono obszaru" : error.message}</p>}
      {area && (
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[44fr_56fr] lg:items-start lg:gap-8">
          <div className="flex flex-col gap-3 lg:sticky lg:top-4">
            <div>
              <nav className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <BackAndMap mapHref={mapLink(area)} />
                {area.path.map((parent) => (
                  <Fragment key={parent.id}>
                    {" · "}
                    <Link to={`/obszary/${parent.slug}`} className="hover:text-foreground">
                      {parent.name}
                    </Link>
                  </Fragment>
                ))}
              </nav>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{KIND_LABEL[area.kind]}</p>
              <h1 className="font-display text-4xl font-extrabold tracking-tight">{area.name}</h1>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {children.length > 0 && (
                <Chip>{area.kind === "obszar" ? countLabel(children.length, REGIONY) : countLabel(children.length, SEKTORY)}</Chip>
              )}
              <Chip>{countLabel(area.kind === "obszar" ? children.reduce((sum, child) => sum + child.crag_count, 0) : crags.length, SKALY)}</Chip>
              <Chip>
                {countLabel(
                  area.kind === "obszar" ? children.reduce((sum, child) => sum + child.route_count, 0) : crags.reduce((sum, crag) => sum + crag.route_count, 0),
                  DROGI,
                )}
              </Chip>
            </div>
            {area.description && <p className="text-sm text-muted-foreground">{area.description}</p>}
            {area.kind !== "obszar" && area.bbox && (
              <div className="relative h-[35dvh] overflow-hidden rounded-[10px] bg-secondary lg:h-[calc(100vh-18rem)]">
                <Suspense fallback={null}>
                  <AreaMap area={area} onOpenCrag={(crag) => navigate(`/skaly/${crag}`)} />
                </Suspense>
                <Link to={mapLink(area)} className="absolute bottom-2 right-2 rounded-full bg-background px-3 py-1 text-xs shadow-float">
                  Na mapie ↗
                </Link>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-4">
            {children.length > 0 && (
              <Section title={area.kind === "obszar" ? "Regiony" : "Sektory"}>
                <ul className="flex flex-col gap-1.5">
                  {children.map((child) => (
                    <li key={child.id}>
                      <Link to={`/obszary/${child.slug}`} className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2 hover:bg-secondary/70">
                        <span className="font-display font-semibold">{child.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {countLabel(child.crag_count, SKALY)} · {countLabel(child.route_count, DROGI)}
                        </span>
                        <span className="ml-auto w-24 shrink-0">
                          <GradeBar bands={child.grade_bands} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {area.kind !== "obszar" && (
              <Section
                title="Skały"
                action={
                  <div role="radiogroup" aria-label="Sortuj skały" className="flex items-center gap-1 text-xs text-muted-foreground">
                    sortuj:
                    {SORTS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={sort === option.value}
                        onClick={() => setSort(option.value)}
                        className="rounded-full bg-secondary px-2.5 py-0.5 aria-checked:bg-foreground aria-checked:text-background"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                }
              >
                {crags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{kind === "all" ? "Brak skał." : `Brak skał z drogami ${kind === "sport" ? "sportowymi" : "tradowymi"}.`}</p>
                ) : (
                  <ul className="flex flex-col">
                    {crags.map((crag) => (
                      <li key={crag.id} className="border-b border-border">
                        <Link to={`/skaly/${crag.slug}`} className="flex items-center gap-3 px-1 py-2 hover:bg-secondary/60">
                          <span className="min-w-0">
                            <span className="block font-display text-[15px] font-semibold">{crag.name}</span>
                            <span className="block text-xs text-muted-foreground">
                              {[crag.sector_name, crag.grade_min && crag.grade_max ? (crag.grade_min === crag.grade_max ? crag.grade_min : `${crag.grade_min} – ${crag.grade_max}`) : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                          <span className="ml-auto w-24 shrink-0">
                            <GradeBar bands={crag.grade_bands} />
                          </span>
                          <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums" title="Liczba dróg">
                            {crag.route_count}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
