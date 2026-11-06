/** CSV reading shared by the importers that take a spreadsheet export: Prowler and the Google OAuth log. */

/** Which delimiter a CSV uses: count candidates in the header row and take the one it uses most. */
function detectDelimiter(headerLine: string): string {
  const counts = [",", ";", "\t", "|"].map((d) => [d, headerLine.split(d).length - 1] as const);
  const best = counts.sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ",";
}

/** RFC 4180 fields and rows: quoted fields, doubled quotes, either line ending. Blank rows are dropped. */
export function parseCsv(text: string): string[][] {
  const delim = detectDelimiter(text.slice(0, text.indexOf("\n") < 0 ? undefined : text.indexOf("\n")));
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * The rows under the first row of a parsed CSV, keyed by crownguard's name for each column. `columns` lists the header
 * names a vendor has used for each, preferred first; matching ignores case. A column the file lacks reads as "" and is
 * left out of `found`.
 */
export function readTable<K extends string>(rows: string[][], columns: Record<K, string[]>): { found: Set<K>; records: Record<K, string>[] } {
  const index = new Map((rows[0] ?? []).map((h, i) => [h.trim().toUpperCase(), i] as const));
  const at = Object.entries<string[]>(columns).map(([key, names]) => [key as K, names.map((n) => index.get(n)).find((i) => i !== undefined)] as const);
  return {
    found: new Set(at.filter(([, i]) => i !== undefined).map(([key]) => key)),
    records: rows.slice(1).map((cells) => Object.fromEntries(at.map(([key, i]) => [key, i === undefined ? "" : (cells[i] ?? "")])) as Record<K, string>),
  };
}

/** A yes/no cell as exports write it: true, false, or undefined when it is neither (a value crownguard doesn't know). */
export function yesNo(v: string | undefined): boolean | undefined {
  const s = (v ?? "").trim();
  if (/^(true|yes|1|y|toggled)$/i.test(s)) return true;
  if (/^(false|no|0|n|none|-|n\/a|)$/i.test(s)) return false;
  return undefined;
}
