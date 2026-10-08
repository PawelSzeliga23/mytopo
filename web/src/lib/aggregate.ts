import type { AreaProps, CragProps } from "@/lib/api";
import { cragGradeRange, mergeGradeRanges, type GradeRange } from "@/lib/grades";

function add(target: Map<number, number[]>, id: number, bands: number[]): void {
  const current = target.get(id) ?? [0, 0, 0, 0];
  target.set(id, current.map((value, index) => value + (bands[index] ?? 0)));
}

/** Grade-band totals per area: crags directly in an area, plus each sector's totals added to its parent region. */
export function aggregateBands(sectors: AreaProps[], crags: CragProps[]): Map<number, number[]> {
  const totals = new Map<number, number[]>();
  for (const crag of crags) add(totals, crag.area_id, crag.grade_bands);
  for (const sector of sectors) {
    const own = totals.get(sector.id);
    if (own && sector.parent_id !== null) add(totals, sector.parent_id, own);
  }
  return totals;
}

/** Grade range per area, built the same way as aggregateBands. */
export function aggregateRanges(sectors: AreaProps[], crags: CragProps[]): Map<number, GradeRange> {
  const ranges = new Map<number, GradeRange>();
  const merge = (id: number, range: GradeRange | null) => {
    const merged = mergeGradeRanges(ranges.get(id) ?? null, range);
    if (merged) ranges.set(id, merged);
  };
  for (const crag of crags) merge(crag.area_id, cragGradeRange(crag));
  for (const sector of sectors) {
    const own = ranges.get(sector.id);
    if (own && sector.parent_id !== null) merge(sector.parent_id, own);
  }
  return ranges;
}

/** Crags listed in an area's card: its own crags plus, for a region, the crags of its sectors. */
export function cragsByArea(sectors: AreaProps[], crags: CragProps[]): Map<number, CragProps[]> {
  const byArea = new Map<number, CragProps[]>();
  const push = (id: number, items: CragProps[]) => byArea.set(id, [...(byArea.get(id) ?? []), ...items]);
  for (const crag of crags) push(crag.area_id, [crag]);
  for (const sector of sectors) {
    const own = byArea.get(sector.id);
    if (own && sector.parent_id !== null) push(sector.parent_id, own);
  }
  return byArea;
}
