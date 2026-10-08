import type { CragProps } from "@/lib/api";
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

/** Grade badge colours [background, text] per band — spec §2.1. */
export const BADGE_COLORS: Record<Theme, [bg: string, fg: string][]> = {
  light: [["#D8E6EC", "#245B72"], ["#DCE1F0", "#2F4FA0"], ["#F2D9D4", "#B23A2B"], ["#2B2420", "#F4ECDD"]],
  dark: [["#1F3A47", "#8CCBE6"], ["#262F4D", "#A7B9F0"], ["#4A2520", "#F2A59A"], ["#EDE3D2", "#1D1916"]],
};

/** Lines and numbers of routes without a grade: --ink at 65%. */
export const UNGRADED_COLOR: Record<Theme, string> = { light: "rgba(43,36,32,0.65)", dark: "rgba(237,227,210,0.65)" };

export function bandColor(sort: number | null, theme: Theme): string {
  const band = gradeBand(sort);
  return band === null ? UNGRADED_COLOR[theme] : BAND_COLORS[theme][band];
}

export interface GradeRange {
  min: string;
  minSort: number;
  max: string;
  maxSort: number;
}

type RangeFields = Pick<CragProps, "grade_min" | "grade_min_sort" | "grade_max" | "grade_max_sort">;

export function cragGradeRange(crag: RangeFields): GradeRange | null {
  const { grade_min: min, grade_min_sort: minSort, grade_max: max, grade_max_sort: maxSort } = crag;
  if (min === null || minSort === null || max === null || maxSort === null) return null;
  return { min, minSort, max, maxSort };
}

export function mergeGradeRanges(a: GradeRange | null, b: GradeRange | null): GradeRange | null {
  if (!a) return b;
  if (!b) return a;
  const low = b.minSort < a.minSort ? b : a;
  const high = b.maxSort > a.maxSort ? b : a;
  return { min: low.min, minSort: low.minSort, max: high.max, maxSort: high.maxSort };
}

/** "V – VI.3", a single grade when both ends match, null when nothing is graded. */
export function formatGradeRange(range: GradeRange | null): string | null {
  if (!range) return null;
  return range.min === range.max ? range.min : `${range.min} – ${range.max}`;
}
