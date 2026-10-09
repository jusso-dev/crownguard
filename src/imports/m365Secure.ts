import { z } from "zod";
import type { ImportMapping } from "../content/schema";
import { suggestAll, type CheckRow } from "./aggregate";
import { clip, type ScanImporter, type ScanResult } from "./types";

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
  const byCheck = new Map<string, CheckRow[]>();
  for (const f of scan.findings) {
    const row: CheckRow = {
      id: f.check_id,
      status: f.status,
      setting: clip(f.setting, 500),
      current: clip(f.current_value, 2000),
      expected: clip(f.expected_value, 2000),
    };
    byCheck.set(f.check_id, [...(byCheck.get(f.check_id) ?? []), row]);
  }
  const mapped = new Set(mapping.mappings.flatMap((m) => m.checks));
  const tenant = scan.summary.tenant.display_name || scan.summary.tenant.primary_domain;
  const unmappedIds = [...new Set(scan.findings.map((f) => f.check_id).filter((id) => !mapped.has(id)))];

  return {
    tool: mapping.name,
    tenant,
    domain: scan.summary.tenant.primary_domain,
    scannedAt: scan.summary.timestamp,
    suggestions: suggestAll(mapping, byCheck, { tool: mapping.name, tenant, scannedAt: scan.summary.timestamp }),
    unmapped: unmappedIds.length,
    unmappedFailing: unmappedIds.filter((id) => scan.findings.some((f) => f.check_id === id && f.status === "fail")),
    licence: suggestLicence(scan.summary.tenant.license_skus.map((s) => s.sku_part_number)),
  };
}

const looksLike = (text: string) => text.includes('"summary"') && text.includes('"findings"') && text.includes("license_skus");

export const m365SecureImporter: ScanImporter = {
  id: "m365-secure",
  platform: "microsoft",
  label: "M365-Secure",
  hint: "_Assessment-Results_<domain>.json",
  url: "https://github.com/jusso-dev/M365-Secure",
  accept: ".json,application/json",
  detect: looksLike,
  read: (text, mapping) => {
    const parsed = scanSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error("this doesn't look like an M365-Secure results file (_Assessment-Results_<domain>.json)");
    return readScan(parsed.data, mapping);
  },
};

