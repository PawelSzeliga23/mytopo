import type { ChangeOut, ObjectChangeOut } from "@/lib/api";

export const FIELD_LABELS: Record<string, string> = {
  name: "nazwa",
  description: "opis",
  grade: "wycena",
  number: "numer",
  length_m: "długość",
  protection: "asekuracja",
  first_ascent: "autor",
  year: "rok",
  rock_type: "rodzaj skały",
  height_min: "wysokość od",
  height_max: "wysokość do",
  aspects: "wystawa",
  formations: "formacje",
  approach_minutes: "czas dojścia",
  child_friendly: "dla dzieci",
  surroundings: "otoczenie",
  approach_description: "opis dojścia",
  location: "położenie",
  area_id: "obszar",
  parent_id: "obszar nadrzędny",
  sort_order: "kolejność",
  kind: "rodzaj",
  image_path: "zdjęcie",
  model_path: "model 2.5D",
  rock_color: "kolor skały",
  ground_color: "kolor podłoża",
  depth_enabled: "2.5D",
};

const MAX_TEXT = 80;
const METERS = new Set(["length_m", "height_min", "height_max"]);

export const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field;

export function formatValue(field: string, value: unknown): string {
  if (field === "depth_enabled") return value === true ? "zawsze" : value === false ? "nigdy" : "auto";
  if (field === "model_path") return typeof value === "string" ? `wersja ${value.split("-").pop()}` : "oryginał";
  if ((field === "rock_color" || field === "ground_color") && !value) return "domyślny";
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return "—";
  if (field === "approach_minutes") return `${value} min`;
  if (METERS.has(field)) return `${value} m`;
  if (field === "location" && Array.isArray(value)) {
    const [lng, lat] = value as number[];
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
  if (field === "image_path" && typeof value === "string") {
    // walls/{id}/display.webp comes from the import, walls/{id}/{n}/display.webp is the n-th photo uploaded in the app.
    const number = /^walls\/\d+\/(\d+)\//.exec(value)?.[1];
    return number ? `wersja ${number}` : "z importu";
  }
  if (typeof value === "boolean") return value ? "tak" : "nie";
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

type Titled = Pick<ObjectChangeOut, "kind" | "name"> & { diffs?: ObjectChangeOut["diffs"] };

const KIND_NOUN: Record<string, [nominative: string, accusative: string]> = {
  area: ["Obszar", "obszar"],
  crag: ["Skała", "skałę"],
  wall: ["Ściana", "ścianę"],
  route: ["Droga", "drogę"],
  topo: ["Topo", "topo"],
  line: ["Linia", "linię"],
  point: ["Punkt", "punkt"],
};

/** An area's kind (region / sektor) is only known from its diffs. */
function nouns(o: Titled): [string, string] {
  if (o.kind === "area") {
    const kind = o.diffs?.find((diff) => diff.field === "kind");
    if (kind?.after === "sektor") return ["Sektor", "sektor"];
    if (kind?.after === "region") return ["Region", "region"];
  }
  return KIND_NOUN[o.kind] ?? [o.kind, o.kind];
}

/** The part of the title that is a name (shown bold); a crag is already named by the entry. */
export const objectName = (o: Titled): string | null => (o.kind === "crag" || o.kind === "topo" ? null : o.name);

/** "Skała", "Droga Filar", "Ściana 2", "Sektor Pieninki". */
export function objectTitle(o: Titled): string {
  const name = objectName(o);
  return name ? `${nouns(o)[0]} ${name}` : nouns(o)[0];
}

/** "Dodano drogę Filar" / "Usunięto skałę". */
export function objectAction(o: ObjectChangeOut): string {
  const name = objectName(o);
  return `${o.op === "created" ? "Dodano" : "Usunięto"} ${nouns(o)[1]}${name ? ` ${name}` : ""}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return `1 ${one}`;
  return `${n} ${2 <= n % 10 && n % 10 <= 4 && !(12 <= n % 100 && n % 100 <= 14) ? few : many}`;
}

/** A line for transactions that are more than field edits (deleting a crag, turning it into a sector); null otherwise. */
export function changeHeadline(c: ChangeOut): string | null {
  const count = (kind: ObjectChangeOut["kind"], op: ObjectChangeOut["op"]) => c.objects.filter((o) => o.kind === kind && o.op === op).length;
  const createdKind = (kind: string) => c.objects.some((o) => o.kind === "area" && o.op === "created" && o.diffs.some((d) => d.field === "kind" && d.after === kind));
  const cragDeleted = count("crag", "deleted");
  if (createdKind("sektor") && cragDeleted) return "Zamieniono skałę w sektor";
  if (createdKind("region") && cragDeleted) return "Zamieniono skałę w region";
  if (cragDeleted) {
    const parts = [plural(count("wall", "deleted"), "ściana", "ściany", "ścian"), plural(count("route", "deleted"), "droga", "drogi", "dróg")];
    return `Usunięto skałę (${parts.join(", ")})`;
  }
  return null;
}

const MONTHS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export function formatWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (days === 0) return `dziś ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (days === 1) return "wczoraj";
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** The transaction only deletes things: undoing it is a restore. */
export const isRestore = (c: ChangeOut) => c.objects.length > 0 && c.objects.every((o) => o.op === "deleted");
