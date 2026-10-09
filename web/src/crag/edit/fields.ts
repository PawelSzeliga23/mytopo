import type { CragDetail, CragPatch } from "@/lib/api";
import { changedFields } from "@/lib/patch";

export const ASPECTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** The form's working copy: every value is text (or a list of directions), so inputs stay controlled. */
export interface CragDraft {
  name: string;
  /** The id of the region or sector the crag sits in (as text, like a select value). */
  area_id: string;
  rock_type: string;
  height_min: string;
  height_max: string;
  aspects: string[];
  formations: string;
  approach_minutes: string;
  child_friendly: "" | "tak" | "nie";
  surroundings: string;
  description: string;
  approach_description: string;
}

export type CragFieldKind = "area" | "text" | "number" | "aspects" | "tristate" | "textarea";

export interface CragField {
  key: keyof CragDraft;
  label: string;
  kind: CragFieldKind;
  /** Spans the whole row of the grid. */
  wide?: boolean;
  hint?: string;
}

/** Order and labels of the crag form. */
export const CRAG_FIELDS: CragField[] = [
  { key: "name", label: "Nazwa", kind: "text", wide: true },
  { key: "area_id", label: "Region / sektor", kind: "area", wide: true },
  { key: "rock_type", label: "Rodzaj skały", kind: "text" },
  { key: "height_min", label: "Wysokość od (m)", kind: "number" },
  { key: "height_max", label: "Wysokość do (m)", kind: "number" },
  { key: "aspects", label: "Wystawa", kind: "aspects", wide: true },
  { key: "formations", label: "Formacje", kind: "text", wide: true, hint: "oddzielone przecinkami" },
  { key: "approach_minutes", label: "Czas dojścia (min)", kind: "number" },
  { key: "child_friendly", label: "Dla dzieci", kind: "tristate" },
  { key: "surroundings", label: "Otoczenie", kind: "text", wide: true },
  { key: "description", label: "Opis", kind: "textarea", wide: true },
  { key: "approach_description", label: "Dojście", kind: "textarea", wide: true },
];

export { inCompassOrder };

const text = (value: string | null) => value ?? "";
const num = (value: number | null) => (value === null ? "" : String(value));

const inCompassOrder = (aspects: string[]) => ASPECTS.filter((aspect) => aspects.includes(aspect));

export function toDraft(crag: CragDetail): CragDraft {
  return {
    name: crag.name,
    area_id: String(crag.path[crag.path.length - 1]?.id ?? ""),
    rock_type: text(crag.rock_type),
    height_min: num(crag.height_min),
    height_max: num(crag.height_max),
    aspects: inCompassOrder(crag.aspects),
    formations: crag.formations.join(", "),
    approach_minutes: num(crag.approach_minutes),
    child_friendly: crag.child_friendly === null ? "" : crag.child_friendly ? "tak" : "nie",
    surroundings: text(crag.surroundings),
    description: text(crag.description),
    approach_description: text(crag.approach_description),
  };
}

const orNull = (value: string) => (value.trim() === "" ? null : value);
const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value.replace(",", ".")));

const CONVERT: { [K in keyof CragDraft]: (value: CragDraft[K]) => unknown } = {
  name: (value) => value.trim(),
  area_id: Number,
  rock_type: orNull,
  height_min: numberOrNull,
  height_max: numberOrNull,
  aspects: inCompassOrder,
  formations: (value) => value.split(",").map((part) => part.trim()).filter(Boolean),
  approach_minutes: numberOrNull,
  child_friendly: (value) => (value === "" ? null : value === "tak"),
  surroundings: orNull,
  description: orNull,
  approach_description: orNull,
};

/** The PATCH body for what the user changed: numbers parsed, emptied texts as null, nothing for untouched fields. */
export function draftToPatch(original: CragDraft, draft: CragDraft): CragPatch {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(changedFields(original, draft)) as (keyof CragDraft)[]) {
    patch[key] = (CONVERT[key] as (value: unknown) => unknown)(draft[key]);
  }
  return patch as CragPatch;
}
