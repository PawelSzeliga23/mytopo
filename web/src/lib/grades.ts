import type { Theme } from "@/lib/theme";

export type Band = 0 | 1 | 2 | 3;

export const BAND_LIMITS = [94, 140, 200] as const;
export const BAND_LABELS = ["≤ V+", "VI- – VI.1+/2", "VI.2 – VI.4+/5", "≥ VI.5"] as const;

export const BAND_COLORS: Record<Theme, [string, string, string, string]> = {
  light: ["#3E8FB0", "#2F4FA0", "#B23A2B", "#2B2420"],
  dark: ["#4FA8CC", "#5C7BD6", "#E0604E", "#EDE3D2"],
};

export function gradeBand(sort: number | null): Band | null {
  if (sort === null) return null;
  if (sort < BAND_LIMITS[0]) return 0;
  if (sort < BAND_LIMITS[1]) return 1;
  if (sort < BAND_LIMITS[2]) return 2;
  return 3;
}
