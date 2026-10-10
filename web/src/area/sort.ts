import type { AreaCrag } from "@/lib/api";

export type CragSort = "name" | "routes" | "grade";

export function sortCrags(crags: AreaCrag[], sort: CragSort): AreaCrag[] {
  const byName = (a: AreaCrag, b: AreaCrag) => a.name.localeCompare(b.name, "pl");
  const sorted = [...crags];
  if (sort === "name") return sorted.sort(byName);
  if (sort === "routes") return sorted.sort((a, b) => b.route_count - a.route_count || byName(a, b));
  // Hardest first; crags without graded routes at the end.
  return sorted.sort((a, b) => (b.grade_max_sort ?? -1) - (a.grade_max_sort ?? -1) || byName(a, b));
}
