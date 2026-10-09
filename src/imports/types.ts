import type { ImportMapping } from "../content/schema";
import type { Evidence, ScanStatus } from "../engine/types";

/** A question an import can pre-fill, with the evidence behind it. */
export interface Suggestion {
  question: string;
  evidence: Evidence;
}

export interface ScanResult {
  /** Scanner name, e.g. "M365-Secure" or "Prowler (AWS)". Recorded on every piece of evidence. */
  tool: string;
  /** Scanner version when the file records one. */
  toolVersion?: string;
  /** Tenant or account label, shown before the import is applied. */
  tenant: string;
  /** Tenant domain or account id. */
  domain: string;
  /** Every account or subscription in the file, with how many findings each has. */
  accounts?: { id: string; name: string; findings: number }[];
  scannedAt: string;
  suggestions: Suggestion[];
  /** Distinct check ids in the file that no mapping refers to. */
  unmapped: number;
  /** Those that failed, so the assessor can copy them out and drive the next mapping update. */
  unmappedFailing: string[];
  licence?: string;
  /** Non-fatal problems worth telling the user, e.g. a version mismatch. */
  warnings?: string[];
}

/**
 * One row of a scanner's output, normalised. A scanner that reports a check once per resource produces several
 * findings with the same `check`; `collapse` turns those into one status per check.
 */
export interface Finding {
  check: string;
  /** The check's own title, used as the setting shown against the question. */
  title?: string;
  status: ScanStatus;
  /** Suppressed by the scanner. A muted finding never becomes Yes. */
  muted: boolean;
  account: string;
  accountName?: string;
  region?: string;
  resource?: string;
  /** What the scanner said about this resource. */
  detail?: string;
  at: string;
  toolVersion?: string;
}

/**
 * A scanner crownguard can import from. Each one reads a documented file format and reports what it found;
 * the mapping from check ids to questions stays in `content/imports/<id>.yaml`.
 */
export interface ScanImporter {
  /** Matches the `content/imports/<id>.yaml` mapping that goes with it. */
  id: string;
  /** Platform whose questions it pre-fills. */
  platform: string;
  /** Also needs this optional module to be in scope, e.g. Prowler (Azure) needs the Azure module. */
  requiresModule?: string;
  /** Shown in the import panel. */
  label: string;
  /** One line naming the file to pick, for the panel. */
  hint: string;
  url: string;
  /** File input `accept` attribute. */
  accept: string;
  /** True when this text looks like this scanner's output. Used to pick the right importer for a dropped file. */
  detect(text: string): boolean;
  /** Parse and map. Throws with a message aimed at an IT lead when the file isn't what this scanner writes. */
  read(text: string, mapping: ImportMapping): ScanResult;
}

/** Truncate for a fixed-width evidence field, keeping the start of the value. */
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
