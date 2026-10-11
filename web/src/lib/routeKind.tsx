import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { RouteKind } from "@/lib/api";

/** The global route filter: every route, or sport / trad only. */
export type KindFilter = "all" | RouteKind;
export const KIND_KEY = "topo-route-kind";
export const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "Wszystkie" },
  { value: "sport", label: "Sport" },
  { value: "trad", label: "Trad" },
];

interface KindState {
  kind: KindFilter;
  setKind: (kind: KindFilter) => void;
}

// Without the provider (isolated components, tests) every route counts.
const KindContext = createContext<KindState>({ kind: "all", setKind: () => {} });

function readKind(): KindFilter {
  try {
    const saved = localStorage.getItem(KIND_KEY);
    return KIND_FILTERS.some((filter) => filter.value === saved) ? (saved as KindFilter) : "all";
  } catch {
    return "all";
  }
}

export function RouteKindProvider({ children }: { children: ReactNode }) {
  const [kind, setState] = useState<KindFilter>(readKind);
  const setKind = useCallback((next: KindFilter) => {
    setState(next);
    try {
      localStorage.setItem(KIND_KEY, next);
    } catch {
      // private mode / blocked storage: the filter works, it just is not remembered
    }
  }, []);
  return <KindContext.Provider value={{ kind, setKind }}>{children}</KindContext.Provider>;
}

export function useRouteKind(): KindState {
  return useContext(KindContext);
}

/**
 * The item with its statistics (route count, grade bands, grade range, crag count) for the chosen kind only:
 * the flat fields hold every route, `by_kind` the sport and trad variants.
 */
export function applyKind<T extends { route_count: number; by_kind?: Partial<Record<RouteKind, object>> }>(item: T, kind: KindFilter): T {
  if (kind === "all") return item;
  const variant = item.by_kind?.[kind];
  return variant ? { ...item, ...variant } : { ...item, route_count: 0 };
}

/** The items with statistics for the chosen kind, without those that have no route of it. */
export function itemsOfKind<T extends { route_count: number; by_kind?: Partial<Record<RouteKind, object>> }>(items: T[], kind: KindFilter): T[] {
  if (kind === "all") return items;
  return items.map((item) => applyKind(item, kind)).filter((item) => item.route_count > 0);
}

/** A GeoJSON collection filtered the same way (properties replaced, features without routes of the kind dropped). */
export function collectionOfKind<C extends { features: { properties: { route_count: number; by_kind?: Partial<Record<RouteKind, object>> } }[] }>(
  collection: C | undefined,
  kind: KindFilter,
): C | undefined {
  if (!collection || kind === "all") return collection;
  const features = collection.features
    .map((feature) => ({ ...feature, properties: applyKind(feature.properties, kind) }))
    .filter((feature) => feature.properties.route_count > 0);
  return { ...collection, features };
}

/** A route stays emphasised when it matches the filter. */
export function matchesKind(route: { kind?: RouteKind }, kind: KindFilter): boolean {
  return kind === "all" || route.kind === undefined || route.kind === kind;
}
