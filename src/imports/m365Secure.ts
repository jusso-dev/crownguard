import { z } from "zod";
import type { ImportMapping } from "../content/schema";
import type { Answer, Evidence, ScanStatus } from "../engine/types";

const status = z.enum(["pass", "fail", "warning", "review", "info", "unknown", "notlicensed"]);

/** The parts of an M365-Secure `_Assessment-Results_<domain>.json` file we use. Other fields are ignored. */
export const scanSchema = z.object({
  summary: z.object({
    timestamp: z.string(),
    tenant: z.object({
      display_name: z.string(),
      primary_domain: z.string(),
      license_skus: z.array(z.object({ sku_part_number: z.string() })).default([]),
    }),
  }),
  findings: z
    .array(
      z.object({
        check_id: z.string(),
        status,
        setting: z.string().default(""),
        current_value: z.string().default(""),
        expected_value: z.string().default(""),
      }),
    )
    .max(5000),
});
export type Scan = z.infer<typeof scanSchema>;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Statuses that actually say whether the control is in place. Review, info, unknown and not-licensed don't. */
const decisive = new Set<ScanStatus>(["pass", "fail", "warning"]);

export interface Suggestion {
  question: string;
  evidence: Evidence;
}

export interface ScanResult {
  tenant: string;
  domain: string;
  scannedAt: string;
  suggestions: Suggestion[];
  /** Findings whose check id isn't mapped to any question. */
  unmapped: number;
  licence?: string;
}

/** All mapped checks pass → Yes; all fail → No; anything mixed, or any warning → Partial. */
export function aggregate(statuses: ScanStatus[]): Answer | undefined {
  const d = statuses.filter((s) => decisive.has(s));
  if (!d.length) return undefined;
  if (d.every((s) => s === "pass")) return "yes";
  if (d.every((s) => s === "fail")) return "no";
  return "partial";
}

/** Apply a mapping's safeguards on top of the plain aggregate. */
export function suggestFor(m: ImportMapping["mappings"][number], statuses: ScanStatus[]): Answer | undefined {
  const usable = m.failIsInconclusive ? statuses.filter((s) => s !== "fail") : statuses;
  const answer = aggregate(usable);
  return m.cap === "partial" && answer === "yes" ? "partial" : answer;
}

/** Licence SKU part numbers, highest tier first. */
const skuTiers: [RegExp, string][] = [
  [/^SPE_E5|^M365_E5/i, "microsoft-365-e5"],
  [/^SPE_E3|^M365_E3/i, "microsoft-365-e3"],
  [/^ENTERPRISEPACK$|^OFFICE_365_E3/i, "office-365-e3"],
  [/^SPB$|BUSINESS_PREMIUM$/i, "business-premium"],
  [/^O365_BUSINESS_PREMIUM$|^O365_BUSINESS$/i, "business-standard"],
  [/^O365_BUSINESS_ESSENTIALS$/i, "business-basic"],
];

export function suggestLicence(skus: string[]): string | undefined {
  for (const [re, tier] of skuTiers) if (skus.some((s) => re.test(s))) return tier;
  return undefined;
}

export function readScan(scan: Scan, mapping: ImportMapping): ScanResult {
  const byId = new Map<string, Scan["findings"][number][]>();
  for (const f of scan.findings) byId.set(f.check_id, [...(byId.get(f.check_id) ?? []), f]);
  const mapped = new Set(mapping.mappings.flatMap((m) => m.checks));
  const tenant = scan.summary.tenant.display_name || scan.summary.tenant.primary_domain;

  const suggestions = mapping.mappings
    .map((m): Suggestion | null => {
      const found = m.checks.flatMap((c) => byId.get(c) ?? []);
      if (!found.length) return null;
      return {
        question: m.question,
        evidence: {
          source: mapping.name,
          tenant,
          scannedAt: scan.summary.timestamp,
          suggested: suggestFor(m, found.map((f) => f.status)),
          checks: found.slice(0, 50).map((f) => ({
            id: f.check_id,
            status: f.status,
            setting: clip(f.setting, 500),
            current: clip(f.current_value, 300),
            expected: clip(f.expected_value, 300),
          })),
        },
      };
    })
    .filter((s): s is Suggestion => s !== null);

  return {
    tenant,
    domain: scan.summary.tenant.primary_domain,
    scannedAt: scan.summary.timestamp,
    suggestions,
    unmapped: new Set(scan.findings.map((f) => f.check_id).filter((id) => !mapped.has(id))).size,
    licence: suggestLicence(scan.summary.tenant.license_skus.map((s) => s.sku_part_number)),
  };
}
