import type { AreaProps, CragProps } from "@/lib/api";
import type { GradeRange } from "@/lib/grades";

export type Selection =
  | { type: "region" | "sektor"; area: AreaProps; bands: number[]; range: GradeRange | null; crags: CragProps[] }
  | { type: "crag"; crag: CragProps };
