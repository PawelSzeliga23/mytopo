import type { AreaProps, CragProps } from "@/lib/api";

export type Selection =
  | { type: "region" | "sektor"; area: AreaProps; bands: number[] }
  | { type: "crag"; crag: CragProps };
