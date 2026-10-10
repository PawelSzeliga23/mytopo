import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { GradeBadge } from "@/components/GradeBadge";
import { api, type AreaProps, type SearchParams, type SearchResult, type SearchType } from "@/lib/api";
import { bandColor, GRADE_CHOICES } from "@/lib/grades";
import { countLabel, DROGI } from "@/lib/plural";
import { useTheme } from "@/lib/theme";
import { useDebounced } from "@/lib/useDebounced";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;
const TYPES: { value: SearchType; label: string }[] = [
  { value: "all", label: "wszystko" },
  { value: "routes", label: "drogi" },
  { value: "crags", label: "skały" },
];

type Hit =
  | { kind: "area"; item: SearchResult["areas"][number] }
  | { kind: "crag"; item: SearchResult["crags"][number] }
  | { kind: "wall"; item: SearchResult["walls"][number] }
  | { kind: "route"; item: SearchResult["routes"][number] };

interface Props {
  /** Regions and sectors for the area filter (from the map data). */
  areas: AreaProps[];
  /** A region or sector picked: the map frames and selects it. */
  onPickArea(id: number): void;
  /** A crag picked: the map flies to it and selects it. */
  onPickCrag(id: number): void;
}

/** The search field of the map's top bar: suggestions and filter chips below it (mockup variant A). */
export function SearchBox({ areas, onPickArea, onPickCrag }: Props) {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [type, setType] = useState<SearchType>("all");
  const [gradeMin, setGradeMin] = useState("");
  const [gradeMax, setGradeMax] = useState("");
  const [area, setArea] = useState("");
  // The highlighted suggestion belongs to one result list: a new list starts at its first entry (Enter opens it).
  const [cursor, setCursor] = useState<{ list: unknown; index: number }>({ list: null, index: 0 });

  const params = useDebounced<SearchParams>(
    { q: q.trim(), type, grade_min: gradeMin || undefined, grade_max: gradeMax || undefined, area: area || undefined },
    DEBOUNCE_MS,
  );
  const enabled = params.q.length >= MIN_QUERY || !!params.grade_min || !!params.grade_max || !!params.area;
  const search = useInfiniteQuery({
    queryKey: ["search", params],
    queryFn: ({ pageParam }) => api.search({ ...params, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.routes.length, 0);
      return loaded < last.totals.routes ? loaded : undefined;
    },
    enabled,
    staleTime: 60_000,
  });
  const first = search.data?.pages[0];
  const hits = useMemo<Hit[]>(() => {
    if (!first || !enabled) return [];
    return [
      ...first.areas.map((item) => ({ kind: "area" as const, item })),
      ...first.crags.map((item) => ({ kind: "crag" as const, item })),
      ...first.walls.map((item) => ({ kind: "wall" as const, item })),
      ...search.data!.pages.flatMap((page) => page.routes).map((item) => ({ kind: "route" as const, item })),
    ];
  }, [first, search.data, enabled]);
  const active = cursor.list === first ? cursor.index : 0;
  const setActive = (index: number) => setCursor({ list: first, index });


  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const regions = useMemo(() => areas.filter((candidate) => candidate.kind === "region").sort((a, b) => a.name.localeCompare(b.name, "pl")), [areas]);
  const sectorsOf = (regionId: number) =>
    areas.filter((candidate) => candidate.kind === "sektor" && candidate.parent_id === regionId).sort((a, b) => a.name.localeCompare(b.name, "pl"));

  function pick(hit: Hit) {
    setOpen(false);
    input.current?.blur();
    if (hit.kind === "area") {
      if (hit.item.kind === "obszar") navigate(`/obszary/${hit.item.slug}`);
      else onPickArea(hit.item.id);
    } else if (hit.kind === "crag") onPickCrag(hit.item.id);
    else if (hit.kind === "wall") navigate(`/skaly/${hit.item.crag_slug}?sciana=${hit.item.id}`);
    else navigate(`/skaly/${hit.item.crag_slug}?droga=${hit.item.id}`);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (hits.length) setActive((active + (event.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[active] ?? hits[0];
      if (hit) pick(hit);
    } else if (event.key === "Escape") {
      setOpen(false);
      input.current?.blur();
    }
  }

  const total = first?.totals;
  const more = search.hasNextPage && total ? total.routes - hits.filter((hit) => hit.kind === "route").length : 0;
  const row = (hit: Hit, content: ReactNode) => {
    // Its place in the keyboard order (areas, crags, walls, routes).
    const position = hits.findIndex((candidate) => candidate.kind === hit.kind && candidate.item.id === hit.item.id);
    return (
      <li key={`${hit.kind}-${hit.item.id}`} role="option" aria-selected={active === position}>
        <button
          type="button"
          onMouseEnter={() => setActive(position)}
          onClick={() => pick(hit)}
          className={cn("flex w-full items-center gap-2.5 px-3 py-1.5 text-left", active === position && "bg-secondary")}
        >
          {content}
        </button>
      </li>
    );
  };
  const group = (title: string, items: ReactNode[]) =>
    items.length > 0 && (
      <li>
        <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</p>
        <ul>{items}</ul>
      </li>
    );
  const name = (text: string, sub: string) => (
    <span className="min-w-0">
      <span className="block truncate font-display text-[15px] font-semibold">{text}</span>
      <span className="block truncate text-xs text-muted-foreground">{sub}</span>
    </span>
  );
  const dot = (className: string, style?: CSSProperties) => <span aria-hidden className={cn("size-3 shrink-0 rounded-full", className)} style={style} />;

  const chip = "rounded-full bg-secondary px-2.5 py-0.5 text-xs aria-pressed:bg-foreground aria-pressed:text-background";
  const select = "rounded-full bg-secondary px-2 py-0.5 text-xs";
  return (
    <div ref={box} className="min-w-0 flex-1">
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="search-results"
        aria-label="Szukaj skały, ściany lub drogi"
        placeholder="Szukaj skały, ściany lub drogi…"
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        className="w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm placeholder:text-muted-foreground"
      />
      {open && (
        <div className="absolute inset-x-0 top-full mt-1.5 overflow-hidden rounded-[10px] bg-background shadow-float">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
            {TYPES.map((option) => (
              <button key={option.value} type="button" aria-pressed={type === option.value} onClick={() => setType(option.value)} className={chip}>
                {option.label}
              </button>
            ))}
            <label className="flex items-center gap-1 text-xs">
              wycena
              <select aria-label="Wycena od" value={gradeMin} onChange={(event) => setGradeMin(event.target.value)} className={select}>
                <option value="">od</option>
                {GRADE_CHOICES.map((grade) => (
                  <option key={grade}>{grade}</option>
                ))}
              </select>
              –
              <select aria-label="Wycena do" value={gradeMax} onChange={(event) => setGradeMax(event.target.value)} className={select}>
                <option value="">do</option>
                {GRADE_CHOICES.map((grade) => (
                  <option key={grade}>{grade}</option>
                ))}
              </select>
            </label>
            <select aria-label="Obszar" value={area} onChange={(event) => setArea(event.target.value)} className={cn(select, "max-w-44")}>
              <option value="">obszar: wszędzie</option>
              {regions.map((region) => (
                <optgroup key={region.id} label={region.name}>
                  <option value={region.slug}>{region.name}</option>
                  {sectorsOf(region.id).map((sector) => (
                    <option key={sector.id} value={sector.slug}>
                      · {sector.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {(gradeMin || gradeMax || area) && (
              <button
                type="button"
                aria-label="Wyczyść filtry"
                onClick={() => {
                  setGradeMin("");
                  setGradeMax("");
                  setArea("");
                }}
                className="text-xs text-muted-foreground underline"
              >
                ✕ filtry
              </button>
            )}
          </div>
          <ul id="search-results" role="listbox" aria-label="Podpowiedzi" className="max-h-[60dvh] overflow-y-auto pb-1">
            {!enabled && <li className="px-3 py-2 text-xs text-muted-foreground">Wpisz co najmniej 2 litery albo wybierz filtr.</li>}
            {enabled && search.isPending && <li className="px-3 py-2 text-xs text-muted-foreground">Szukam…</li>}
            {enabled && first && hits.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">Nic nie znaleziono.</li>}
            {first && (
              <>
                {group(
                  "Obszary",
                  first.areas.map((item) =>
                    row({ kind: "area", item }, <>{dot("border-2 border-brand")}{name(item.name, [item.kind, item.parent_name].filter(Boolean).join(" · "))}</>),
                  ),
                )}
                {group(
                  "Skały",
                  first.crags.map((item) =>
                    row({ kind: "crag", item }, <>{dot("bg-brand")}{name(item.name, `${item.area_name} · ${countLabel(item.route_count, DROGI)}`)}</>),
                  ),
                )}
                {group(
                  "Ściany",
                  first.walls.map((item) => row({ kind: "wall", item }, <>{dot("rounded-sm bg-secondary")}{name(item.name, `ściana · ${item.crag_name}`)}</>)),
                )}
                {group(
                  total ? `Drogi · ${total.routes}` : "Drogi",
                  hits
                    .filter((hit): hit is Extract<Hit, { kind: "route" }> => hit.kind === "route")
                    .map((hit) =>
                      row(
                        hit,
                        <>
                          {dot("", { backgroundColor: bandColor(hit.item.grade_sort, theme) })}
                          {name(hit.item.name, [hit.item.crag_name, hit.item.length_m ? `${hit.item.length_m} m` : null].filter(Boolean).join(" · "))}
                          <span className="ml-auto">
                            <GradeBadge grade={hit.item.grade} sort={hit.item.grade_sort} />
                          </span>
                        </>,
                      ),
                    ),
                )}
              </>
            )}
          </ul>
          <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
            <span>↑↓ wybór · Enter otwiera</span>
            {more > 0 && (
              <button type="button" disabled={search.isFetchingNextPage} onClick={() => void search.fetchNextPage()} className="underline">
                jeszcze {countLabel(more, DROGI)} ▾
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
