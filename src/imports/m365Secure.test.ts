import { describe, expect, it } from "vitest";
import type { ImportMapping } from "../content/schema";
import { aggregate, readScan, scanSchema, suggestLicence } from "./m365Secure";

const mapping: ImportMapping = {
  id: "m365-secure",
  name: "M365-Secure",
  platform: "microsoft",
  url: "https://github.com/jusso-dev/M365-Secure",
  mappings: [
    { question: "MS-ID-001", checks: ["CA-1", "CA-2"], rationale: "MFA policies" },
    { question: "MS-ID-002", checks: ["LEG-1"], rationale: "Legacy auth" },
    { question: "MS-ID-003", checks: ["PR-1"], rationale: "Phishing resistant" },
    { question: "MS-ID-004", checks: ["NOT-IN-SCAN"], rationale: "Absent" },
  ],
};

const scan = scanSchema.parse({
  summary: {
    timestamp: "2026-10-01T03:00:00Z",
    tenant: { display_name: "Contoso Pty Ltd", primary_domain: "contoso.example", license_skus: [{ sku_part_number: "SPB" }] },
    extra: "ignored",
  },
  findings: [
    { check_id: "CA-1", status: "pass", setting: "MFA for admins", current_value: "Enabled" },
    { check_id: "CA-2", status: "fail", setting: "MFA for users", current_value: "Disabled" },
    { check_id: "LEG-1", status: "pass" },
    { check_id: "PR-1", status: "review" },
    { check_id: "OTHER-1", status: "fail" },
  ],
  compliance: [],
});

describe("M365-Secure import", () => {
  it("aggregates check statuses into an answer", () => {
    expect(aggregate(["pass", "pass"])).toBe("yes");
    expect(aggregate(["fail", "fail"])).toBe("no");
    expect(aggregate(["pass", "fail"])).toBe("partial");
    expect(aggregate(["warning"])).toBe("partial");
    expect(aggregate(["pass", "review"])).toBe("yes");
    expect(aggregate(["review", "unknown", "notlicensed", "info"])).toBeUndefined();
  });

  it("turns a scan into evidence and suggestions, skipping checks the scan didn't run", () => {
    const r = readScan(scan, mapping);
    expect(r.tenant).toBe("Contoso Pty Ltd");
    expect(r.licence).toBe("business-premium");
    expect(r.unmapped).toBe(1);
    expect(Object.fromEntries(r.suggestions.map((s) => [s.question, s.evidence.suggested]))).toEqual({
      "MS-ID-001": "partial",
      "MS-ID-002": "yes",
      "MS-ID-003": undefined,
    });
    expect(r.suggestions[0].evidence.checks.map((c) => c.id)).toEqual(["CA-1", "CA-2"]);
  });

  it("suggests the highest licence tier present", () => {
    expect(suggestLicence(["O365_BUSINESS_ESSENTIALS", "SPE_E5"])).toBe("microsoft-365-e5");
    expect(suggestLicence(["ENTERPRISEPACK"])).toBe("office-365-e3");
    expect(suggestLicence(["FLOW_FREE"])).toBeUndefined();
  });

  it("rejects files that aren't M365-Secure results", () => {
    expect(scanSchema.safeParse({ version: 1, org: {} }).success).toBe(false);
  });
});

describe("mapping safeguards", () => {
  it("caps partial-coverage checks and ignores known false fails", async () => {
    const { suggestFor } = await import("./m365Secure");
    const base = { question: "MS-ID-001", checks: ["X"], rationale: "test only" };
    expect(suggestFor({ ...base, cap: "partial" }, ["pass"])).toBe("partial");
    expect(suggestFor({ ...base, cap: "partial" }, ["fail"])).toBe("no");
    expect(suggestFor({ ...base, failIsInconclusive: true }, ["fail"])).toBeUndefined();
    expect(suggestFor({ ...base, failIsInconclusive: true }, ["pass"])).toBe("yes");
  });
});
