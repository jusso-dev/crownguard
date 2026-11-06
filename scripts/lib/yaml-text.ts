/** Helpers for generators that write YAML as text, so the committed files keep a fixed, reviewable layout. */

/** A double-quoted scalar (JSON strings are valid YAML). */
export const quoted = (s: string): string => JSON.stringify(s);

/** A flow sequence of plain scalars: `[a, b]`. */
export const inlineList = (xs: (string | number)[]): string => `[${xs.join(", ")}]`;

/** A paragraph folded to lines of at most `width` characters, for a `>-` block. */
export function fold(text: string, width = 95): string[] {
  const lines: string[] = [];
  for (const w of text.replace(/\s+/g, " ").trim().split(" ")) {
    const last = lines[lines.length - 1];
    if (last && last.length + w.length + 1 <= width) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  return lines;
}
