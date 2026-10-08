import { useEffect, useRef } from "react";
import { GradeBadge } from "@/components/GradeBadge";
import { labelTextColor, type RouteRow, type RouteRows } from "@/crag/topo";
import type { RouteOut } from "@/lib/api";
import { formatDecimal } from "@/lib/format";
import { bandColor } from "@/lib/grades";
import { useTheme } from "@/lib/theme";

interface RouteListProps {
  rows: RouteRows;
  wallNames: Map<number, string>;
  selectedRouteId: number | null;
  hoveredRouteId: number | null;
  onChoose: (row: RouteRow) => void;
  onHover: (routeId: number | null) => void;
}

function meta(route: RouteOut): string {
  const author = [route.first_ascent, route.year].filter((part) => part !== null).join(", ");
  return [route.protection, route.length_m !== null ? `${formatDecimal(route.length_m)} m` : null, author || null]
    .filter((part) => part !== null)
    .join(" · ");
}

function Row({ row, hint, selected, hovered, onChoose, onHover }: { row: RouteRow; hint: string | null; selected: boolean; hovered: boolean } & Pick<RouteListProps, "onChoose" | "onHover">) {
  const { theme } = useTheme();
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // Selecting on the photo brings the row into view; the scroll margin keeps it below the sticky photo on phones.
    if (selected) ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  const { route } = row;
  const details = meta(route);
  return (
    <li ref={ref} className="scroll-mt-[32vh] lg:scroll-mt-4">
      <button
        type="button"
        aria-pressed={selected}
        data-hovered={hovered || undefined}
        onClick={() => onChoose(row)}
        onMouseEnter={() => onHover(route.id)}
        onMouseLeave={() => onHover(null)}
        className={`flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left ${selected ? "bg-secondary" : hovered ? "bg-secondary/60" : "hover:bg-secondary/60"}`}
      >
        <span
          aria-hidden
          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${row.label ? "" : "bg-secondary text-muted-foreground"}`}
          style={row.label ? { backgroundColor: bandColor(route.grade_sort, theme), color: labelTextColor(route.grade_sort, theme) } : undefined}
        >
          {row.label ?? "–"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display font-semibold leading-snug">{route.name}</span>
          {details && <span className="block text-xs text-muted-foreground">{details}</span>}
          {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
          {selected && route.description && <span className="mt-1 block whitespace-pre-line text-sm">{route.description}</span>}
        </span>
        <GradeBadge grade={route.grade} sort={route.grade_sort} french={route.grade_fr} />
      </button>
    </li>
  );
}

function Group({ title, rows, hintFor, ...rest }: { title: string; rows: RouteRow[]; hintFor: (row: RouteRow) => string | null } & Omit<RouteListProps, "rows" | "wallNames">) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
      <ul aria-label={title} className="flex flex-col">
        {rows.map((row) => (
          <Row
            key={row.route.id}
            row={row}
            hint={hintFor(row)}
            selected={row.route.id === rest.selectedRouteId}
            hovered={row.route.id === rest.hoveredRouteId}
            onChoose={rest.onChoose}
            onHover={rest.onHover}
          />
        ))}
      </ul>
    </section>
  );
}

export function RouteList({ rows, wallNames, ...rest }: RouteListProps) {
  if (rows.onWall.length + rows.other.length === 0) return <p className="text-sm text-muted-foreground">Ta skała nie ma jeszcze dróg.</p>;
  const otherHint = (row: RouteRow) => (row.wallId === null ? "bez topo" : `na zdjęciu „${wallNames.get(row.wallId) ?? ""}”`);
  return (
    <div className="flex flex-col gap-4">
      {rows.onWall.length > 0 && <Group title="Na tym zdjęciu" rows={rows.onWall} hintFor={() => null} {...rest} />}
      {rows.other.length > 0 && <Group title={rows.onWall.length > 0 ? "Pozostałe drogi" : "Drogi"} rows={rows.other} hintFor={otherHint} {...rest} />}
    </div>
  );
}
