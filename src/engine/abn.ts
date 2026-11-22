const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** Every digit, untruncated: a 12th digit is a typo to show, not silently drop. */
export const abnDigits = (s: string) => s.replace(/\D/g, "");

/** ATO checksum: subtract 1 from the first digit, weight each digit, the sum must divide by 89. */
export function isValidAbn(s: string): boolean {
  const d = abnDigits(s);
  if (d.length !== 11 || s.replace(/[\s\d]/g, "") !== "") return false;
  const sum = [...d].reduce((acc, c, i) => acc + (Number(c) - (i === 0 ? 1 : 0)) * WEIGHTS[i], 0);
  return sum % 89 === 0;
}

/** 51824753556 → "51 824 753 556". Any digits past the 11th stay on the last group. */
export function formatAbn(s: string): string {
  const d = abnDigits(s);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 8), d.slice(8)].filter(Boolean).join(" ");
}
