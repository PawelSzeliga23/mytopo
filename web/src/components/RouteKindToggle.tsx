import { KIND_FILTERS, useRouteKind } from "@/lib/routeKind";

/** The global sport / trad filter: three segments from `md` up, a single pill stepping through them on phones. */
export function RouteKindToggle() {
  const { kind, setKind } = useRouteKind();
  const index = KIND_FILTERS.findIndex((filter) => filter.value === kind);
  const next = KIND_FILTERS[(index + 1) % KIND_FILTERS.length];
  return (
    <>
      <button
        type="button"
        aria-label={`Rodzaj dróg: ${KIND_FILTERS[index].label}. Zmień na: ${next.label}`}
        onClick={() => setKind(next.value)}
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold md:hidden ${kind === "all" ? "bg-secondary text-muted-foreground" : "bg-foreground text-background"}`}
      >
        {KIND_FILTERS[index].label}
      </button>
      <div role="radiogroup" aria-label="Rodzaj dróg" className="hidden shrink-0 items-center rounded-full bg-secondary p-0.5 text-xs md:flex">
        {KIND_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            role="radio"
            aria-checked={kind === filter.value}
            onClick={() => setKind(filter.value)}
            className="rounded-full px-2.5 py-0.5 text-muted-foreground aria-checked:bg-foreground aria-checked:font-semibold aria-checked:text-background"
          >
            {filter.label}
          </button>
        ))}
      </div>
    </>
  );
}
