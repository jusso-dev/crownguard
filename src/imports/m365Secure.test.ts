import { describe, expect, it } from "vitest";
import { readContentFiles } from "../../scripts/read-content";
import type { ImportMapping } from "../content/schema";
import { loadCatalogue } from "../content/loader";
import { aggregate, suggestFor } from "./aggregate";
import { m365SecureImporter, readScan, scanSchema, suggestLicence } from "./m365Secure";
import { prowlerImporter } from "./prowler";
import { detectImporter } from "./index";
import { redactEmails } from "./types";

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
    expect(aggregate(["review", "unknown", "notlicensed", "info"])).toBeUndefined();
  });

  it("never says Yes while a mapped check still needs review", () => {
    // A pass beside a check the scan couldn't settle hasn't shown the whole control is in place.
    expect(aggregate(["pass", "review"])).toBe("partial");
    expect(aggregate(["pass", "notlicensed"])).toBe("partial");
    expect(aggregate(["pass", "pass", "info"])).toBe("partial");
    // Failures still decide as before.
    expect(aggregate(["fail", "review"])).toBe("no");
    expect(aggregate(["pass", "fail", "review"])).toBe("partial");
  });

  it("keeps account names out of the evidence it stores", () => {
    const withAdmins = scanSchema.parse({
      summary: { timestamp: "2026-10-01T03:00:00Z", tenant: { display_name: "Contoso", primary_domain: "contoso.example" } },
      findings: [
        { check_id: "CA-1", status: "fail", setting: "Break-glass accounts", current_value: "Excluded: bg1@contoso.example, Guest alice_fabrikam.com#EXT#@contoso.onmicrosoft.com" },
      ],
    });
    const ev = readScan(withAdmins, mapping).suggestions[0].evidence;
    expect(ev.checks[0].current).toBe("Excluded: [account], Guest [account]");
    expect(JSON.stringify(ev)).not.toMatch(/bg1|alice|fabrikam/);
  });

  it("removes an address before cutting long text, so half an address never survives", () => {
    const long = scanSchema.parse({
      summary: { timestamp: "2026-10-01T03:00:00Z", tenant: { display_name: "Contoso", primary_domain: "contoso.example" } },
      findings: [{ check_id: "CA-1", status: "fail", setting: "Admins", current_value: `${"x".repeat(1990)} alice.smith@contoso.example` }],
    });
    expect(JSON.stringify(readScan(long, mapping).suggestions[0].evidence)).not.toMatch(/alice/);
  });

  it("leaves version pins that only look like addresses alone", () => {
    expect(redactEmails("lodash@4.17.21, owner admin@contoso.example")).toBe("lodash@4.17.21, owner [account]");
    expect(redactEmails("josé@contoso.example, alice!ops@contoso.example; jürgen@exämple.com")).toBe("[account], [account]; [account]");
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

  it("recognises a results file with no license_skus as M365-Secure, not Prowler", () => {
    const text = JSON.stringify({
      summary: { timestamp: "2026-10-01T03:00:00Z", tenant: { display_name: "Contoso", primary_domain: "contoso.example" } },
      findings: [{ check_id: "CA-1", status: "pass", setting: "STATUS of MFA" }],
    });
    expect(m365SecureImporter.detect(text)).toBe(true);
    expect(prowlerImporter("aws").detect(text)).toBe(false);
    expect(prowlerImporter("microsoft").detect(text)).toBe(false);
    expect(detectImporter(text)).toBe(m365SecureImporter);
  });

  it("rejects files that aren't M365-Secure results", () => {
    expect(scanSchema.safeParse({ version: 1, org: {} }).success).toBe(false);
  });
});

describe("mapping safeguards", () => {
  it("caps partial-coverage checks and ignores known false fails", () => {
    const base = { question: "MS-ID-001", checks: ["X"], rationale: "test only" };
    expect(suggestFor({ ...base, cap: "partial" }, ["pass"])).toBe("partial");
    expect(suggestFor({ ...base, cap: "partial" }, ["fail"])).toBe("no");
    expect(suggestFor({ ...base, failIsInconclusive: true }, ["fail"])).toBeUndefined();
    expect(suggestFor({ ...base, failIsInconclusive: true }, ["pass"])).toBe("yes");
    // An inconclusive fail is review, so it can't let the pass beside it read as Yes.
    expect(suggestFor({ ...base, failIsInconclusive: true }, ["pass", "fail"])).toBe("partial");
  });
});

/** The mapping crownguard ships, so the consent and shadow-AI rows are tested as written. */
const shipped = loadCatalogue(readContentFiles()).catalogue.imports.get("m365-secure")!;
const row = (question: string) => shipped.mappings.find((m) => m.question === question)!;

describe("consent and shadow-AI mappings", () => {
  it("maps the consent checks to the consent review question, capped at partial", () => {
    const m = row("MS-APP-006");
    expect(m.checks).toEqual(["ENTRA-CONSENT-003", "ENTRA-CONSENT-004"]);
    expect(m.cap).toBe("partial");
    // Both halves pass → only Partial: the review of those consents is process evidence.
    expect(suggestFor(m, ["pass", "pass"])).toBe("partial");
    expect(suggestFor(m, ["pass", "fail"])).toBe("partial");
    expect(suggestFor(m, ["fail", "fail"])).toBe("no");
    expect(suggestFor(m, ["review", "review"])).toBeUndefined();
  });

  it("sends an impersonation failure to review rather than No", () => {
    const m = row("MS-APP-005");
    expect(m.checks).toEqual(["ENTRA-ENTAPP-020"]);
    expect(m.failIsInconclusive).toBe(true);
    expect(suggestFor(m, ["pass"])).toBe("partial");
    expect(suggestFor(m, ["fail"])).toBeUndefined();
    expect(suggestFor(m, ["fail", "pass"])).toBe("partial");
  });

  it("counts foreign and high-impact apps into the inventory question", () => {
    const m = row("MS-APP-002");
    expect(m.checks).toEqual(["ENTRA-ENTAPP-022", "ENTRA-ENTAPP-004", "ENTRA-ENTAPP-011"]);
    expect(suggestFor(m, ["pass", "pass", "pass"])).toBe("partial");
    expect(suggestFor(m, ["pass", "pass", "fail"])).toBe("partial");
    expect(suggestFor(m, ["fail", "fail", "fail"])).toBe("no");
  });

  it("turns the new checks into evidence when a scan reports them", () => {
    const scan = scanSchema.parse({
      summary: {
        timestamp: "2026-10-10T03:00:00Z",
        tenant: { display_name: "Contoso Pty Ltd", primary_domain: "contoso.example", license_skus: [] },
      },
      findings: [
        { check_id: "ENTRA-CONSENT-003", status: "pass" },
        { check_id: "ENTRA-CONSENT-004", status: "fail" },
        { check_id: "ENTRA-ENTAPP-020", status: "fail" },
      ],
    });
    const r = readScan(scan, shipped);
    const suggested = Object.fromEntries(r.suggestions.map((s) => [s.question, s.evidence.suggested]));
    expect(suggested["MS-APP-006"]).toBe("partial");
    // The impersonation check's false fails go to the assessor, not to No.
    expect(suggested["MS-APP-005"]).toBeUndefined();
    expect(r.suggestions.find((s) => s.question === "MS-APP-005")!.evidence.checks.map((c) => c.id)).toEqual(["ENTRA-ENTAPP-020"]);
  });
});
