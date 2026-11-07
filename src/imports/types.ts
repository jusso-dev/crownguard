import type { ImportMapping } from "../content/schema";
import type { Evidence } from "../format/schema";

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
  /** Tenant or account label, shown before the import is applied. Addresses in it are already redacted. */
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
 * A scanner crownguard can import from. Each one reads a documented file format and reports what it found;
 * the mapping from check ids to questions stays in `content/imports/<id>.yaml`.
 */
export interface ScanImporter {
  /** Matches the `content/imports/<id>.yaml` mapping that goes with it. */
  id: string;
  /** The scanner, as `cg import --tool` names it. One scanner can have an importer per platform it scans. */
  tool: string;
  /** Platform whose questions it pre-fills. */
  platform: string;
  /** Also needs this optional module to be in scope, e.g. Prowler (Azure) needs the Azure module. */
  requiresModule?: string;
  label: string;
  /** One line naming the file to pick, for the panel. */
  hint: string;
  url: string;
  accept: string;
  /** True when this text looks like this scanner's output. Used to pick the right importer for a dropped file. */
  detect(text: string): boolean;
  /** Parse and map. Throws with a message aimed at an IT lead when the file isn't what this scanner writes. */
  read(text: string, mapping: ImportMapping): ScanResult;
}
