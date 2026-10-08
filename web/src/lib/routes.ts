import type { RouteOut } from "@/lib/api";

/** Route order on lists: by route number (routes without one last), then by name. */
export function compareRoutes(a: RouteOut, b: RouteOut): number {
  return (a.number ?? Infinity) - (b.number ?? Infinity) || a.name.localeCompare(b.name, "pl");
}
