import type { AreaProps, CragProps } from "@/lib/api";

export type LngLat = [number, number];

export type MapMode =
  | { kind: "browse" }
  | { kind: "move"; crag: CragProps; target: LngLat | null }
  | { kind: "add"; point: LngLat | null }
  | { kind: "sector"; region: AreaProps; selected: number[] };

export const BROWSE: MapMode = { kind: "browse" };

/** Adds the crag to the new sector's selection, or removes it when it is already there. */
export function toggleCrag(mode: MapMode, cragId: number): MapMode {
  if (mode.kind !== "sector") return mode;
  const selected = mode.selected.includes(cragId) ? mode.selected.filter((id) => id !== cragId) : [...mode.selected, cragId];
  return { ...mode, selected };
}

/** "?przesun=12" → 12; anything else → null. */
export function parseMoveParam(search: string): number | null {
  const value = new URLSearchParams(search).get("przesun");
  if (value === null || !/^\d+$/.test(value)) return null;
  return Number(value);
}
