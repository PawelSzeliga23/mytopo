export type Forms = readonly [one: string, few: string, many: string];

export const SKALY: Forms = ["skała", "skały", "skał"];
export const DROGI: Forms = ["droga", "drogi", "dróg"];

export function plural(n: number, [one, few, many]: Forms): string {
  if (n === 1) return one;
  const lastDigit = n % 10;
  const lastTwo = n % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return few;
  return many;
}

export function countLabel(n: number, forms: Forms): string {
  return `${n} ${plural(n, forms)}`;
}
