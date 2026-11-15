/** Source limits, independent of the smaller saved-evidence display limits. Both bounds are inclusive. */
export const importLimits = { maxBytes: 8_000_000, maxRows: 50_000, m365MaxRows: 5_000 } as const;

export class ImportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportLimitError";
  }
}

export function assertImportBytes(bytes: number, label = "scan"): void {
  if (bytes > importLimits.maxBytes)
    throw new ImportLimitError(`This ${label} exceeds the 8 MB (8,000,000 byte) limit; choose a smaller scoped export. Nothing was applied`);
}

/** Check code units first so even the temporary UTF-8 encoding is bounded. Returns bytes for combined imports. */
export function assertImportText(text: string, label = "scan"): number {
  assertImportBytes(text.length, label);
  const bytes = new TextEncoder().encode(text).byteLength;
  assertImportBytes(bytes, label);
  return bytes;
}

export function assertImportRows(rows: number, maxRows: number = importLimits.maxRows, label = "scan", unit = "input records"): void {
  if (rows > maxRows)
    throw new ImportLimitError(`This ${label} exceeds ${maxRows.toLocaleString("en-AU")} ${unit}; choose a smaller scoped export. Nothing was applied`);
}
