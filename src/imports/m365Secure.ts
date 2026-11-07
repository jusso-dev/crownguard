import { z } from "zod";
import { scanStatuses } from "../format/vocab";
import { buildScanResult } from "./aggregate";
import type { ScanImporter } from "./types";

/** The parts of an M365-Secure `_Assessment-Results_<domain>.json` file we use. Other fields are ignored. */
const scanSchema = z.object({
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
        status: z.enum(scanStatuses),
        setting: z.string().default(""),
        current_value: z.string().default(""),
        expected_value: z.string().default(""),
      }),
    )
    .max(5000),
});

/** Licence SKU part numbers, highest tier first. */
const skuTiers: [RegExp, string][] = [
  [/^SPE_E5|^M365_E5/i, "microsoft-365-e5"],
  [/^SPE_E3|^M365_E3/i, "microsoft-365-e3"],
  [/^ENTERPRISEPACK$|^OFFICE_365_E3/i, "office-365-e3"],
  [/^SPB$|BUSINESS_PREMIUM$/i, "business-premium"],
  [/^O365_BUSINESS_PREMIUM$|^O365_BUSINESS$/i, "business-standard"],
  [/^O365_BUSINESS_ESSENTIALS$/i, "business-basic"],
];

const licenceTier = (skus: string[]) => skuTiers.find(([re]) => skus.some((s) => re.test(s)))?.[1];

/**
 * The fields the schema needs: `summary.tenant.primary_domain` and `findings`. `license_skus` is optional (the schema
 * defaults it), so a file without one is still M365-Secure rather than falling through to another importer.
 */
const looksLike = (text: string) => ['"summary"', '"findings"', '"primary_domain"'].every((k) => text.includes(k));

export const m365SecureImporter: ScanImporter = {
  id: "m365-secure",
  tool: "m365-secure",
  platform: "microsoft",
  label: "M365-Secure",
  hint: "_Assessment-Results_<domain>.json",
  url: "https://github.com/jusso-dev/M365-Secure",
  accept: ".json,application/json",
  detect: looksLike,
  read: (text, mapping) => {
    const parsed = scanSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error("this doesn't look like an M365-Secure results file (_Assessment-Results_<domain>.json)");
    const { summary, findings } = parsed.data;
    return buildScanResult(
      mapping,
      findings.map((f) => ({ id: f.check_id, status: f.status, setting: f.setting, current: f.current_value, expected: f.expected_value })),
      {
        tenant: summary.tenant.display_name || summary.tenant.primary_domain,
        domain: summary.tenant.primary_domain,
        scannedAt: summary.timestamp,
        licence: licenceTier(summary.tenant.license_skus.map((s) => s.sku_part_number)),
      },
    );
  },
};
