import type { AreaProps, CragProps } from "@/lib/api";

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
