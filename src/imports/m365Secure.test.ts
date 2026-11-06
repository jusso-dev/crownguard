import { describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
import type { ImportMapping } from "../content/schema";
import { m365SecureImporter } from "./m365Secure";
import { prowlerImporter } from "./prowler";
import { detectImporter } from "./index";

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

const file = (findings: object[], skus: string[] = ["SPB"]) =>
  JSON.stringify({
    summary: {
      timestamp: "2026-10-01T03:00:00Z",
      tenant: { display_name: "Contoso Pty Ltd", primary_domain: "contoso.example", license_skus: skus.map((sku_part_number) => ({ sku_part_number })) },
      extra: "ignored",
    },
    findings,
    compliance: [],
  });
const read = (text: string, m = mapping) => m365SecureImporter.read(text, m);

describe("M365-Secure import", () => {
  it("turns a scan into evidence and suggestions, skipping checks the scan didn't run", () => {
    const r = read(
      file([
        { check_id: "CA-1", status: "pass", setting: "MFA for admins", current_value: "Enabled" },
        { check_id: "CA-2", status: "fail", setting: "MFA for users", current_value: "Disabled" },
        { check_id: "LEG-1", status: "pass" },
        { check_id: "PR-1", status: "review" },
        { check_id: "OTHER-1", status: "fail" },
      ]),
    );
    expect(r).toMatchObject({ tool: "M365-Secure", tenant: "Contoso Pty Ltd", domain: "contoso.example", licence: "business-premium", unmapped: 1, unmappedFailing: ["OTHER-1"] });
    expect(Object.fromEntries(r.suggestions.map((s) => [s.question, s.evidence.suggested]))).toEqual({
      "MS-ID-001": "partial",
      "MS-ID-002": "yes",
      "MS-ID-003": undefined,
    });
    expect(r.suggestions[0].evidence.checks.map((c) => c.id)).toEqual(["CA-1", "CA-2"]);
  });

  it("suggests the highest licence tier present", () => {
    const licence = (skus: string[]) => read(file([{ check_id: "CA-1", status: "pass" }], skus)).licence;
    expect(licence(["O365_BUSINESS_ESSENTIALS", "SPE_E5"])).toBe("microsoft-365-e5");
    expect(licence(["ENTERPRISEPACK"])).toBe("office-365-e3");
    expect(licence(["FLOW_FREE"])).toBeUndefined();
  });

  it("recognises a results file with no license_skus as M365-Secure, not Prowler", () => {
    const text = JSON.stringify({
      summary: { timestamp: "2026-10-01T03:00:00Z", tenant: { display_name: "Contoso", primary_domain: "contoso.example" } },
      findings: [{ check_id: "CA-1", status: "pass", setting: "STATUS of MFA" }],
    });
    expect(m365SecureImporter.detect(text)).toBe(true);
    expect(prowlerImporter("aws").detect(text)).toBe(false);
    expect(prowlerImporter("microsoft").detect(text)).toBe(false);
    expect(detectImporter(text)).toBe(m365SecureImporter);
    expect(read(text).licence).toBeUndefined();
  });

  it("rejects files that aren't M365-Secure results", () => {
    expect(() => read('{"version": 1, "org": {}}')).toThrow(/doesn't look like an M365-Secure results file/);
  });

  it("applies the shipped mapping's safeguards to the consent and impersonation checks", () => {
    const r = read(
      file([
        { check_id: "ENTRA-CONSENT-003", status: "pass" },
        { check_id: "ENTRA-CONSENT-004", status: "fail" },
        { check_id: "ENTRA-ENTAPP-020", status: "fail" },
      ]),
      catalogue.imports.get("m365-secure")!,
    );
    const suggested = Object.fromEntries(r.suggestions.map((s) => [s.question, s.evidence.suggested]));
    expect(suggested["MS-APP-006"]).toBe("partial");
    // The impersonation check's false fails go to the assessor, not to No.
    expect(suggested["MS-APP-005"]).toBeUndefined();
    expect(r.suggestions.find((s) => s.question === "MS-APP-005")!.evidence.checks.map((c) => c.id)).toEqual(["ENTRA-ENTAPP-020"]);
  });
});
