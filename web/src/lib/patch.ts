/** An empty text is the same as "no value" — the API stores it as null. */
function normalize(value: unknown): unknown {
  return value === "" ? null : value;
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => item === b[index]);
  return normalize(a) === normalize(b);
}

/** Only the fields of `draft` that differ from `original` (shallow; arrays by content), ready to send as a PATCH body. */
export function changedFields<T extends object>(original: T, draft: T): Partial<T> {
  const changed: Partial<T> = {};
  for (const key of Object.keys(draft) as (keyof T)[]) {
    if (!same(original[key], draft[key])) changed[key] = draft[key];
  }
  return changed;
}
