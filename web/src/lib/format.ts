/** Polish decimal comma: 9.5 → "9,5", 10 → "10". */
export function formatDecimal(n: number): string {
  return String(n).replace(".", ",");
}
