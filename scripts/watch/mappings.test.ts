import { describe, expect, it } from "vitest";
import type { Catalogue, ImportMapping } from "../../src/content/schema";
import { checkFamily, checkMappingDrift, parseIdList, parseM365ChecksMd, scubaBaseId } from "./mappings";

const m365Fixture = `| Check id | Name | Category |
|---|---|---|
| CA-MFA-ALL-001 | MFA for all users | MFA-ALL |
| ENTRA-ENTAPP-004 | App assignment required | ENTAPP |
| ENTRA-ENTAPP-011 | Users cannot consent | ENTAPP |
| ENTRA-ENTAPP-020 | Admin consent workflow | ENTAPP |
| ENTRA-ENTAPP-022 | Risk-based step-up | ENTAPP |
| ENTRA-ENTAPP-099 | Brand new check | ENTAPP |
`;

function catalogueWith(mapping: ImportMapping): Catalogue {
  return {
    sources: new Map(),
    frameworks: new Map(),
    platforms: new Map(),
    imports: new Map([[mapping.id, mapping]]),
  };
}

describe("mapping drift", () => {
  it("parses CHECKS.md and id-list fixtures", () => {
    expect(parseM365ChecksMd(m365Fixture)).toEqual([
      "CA-MFA-ALL-001",
      "ENTRA-ENTAPP-004",
      "ENTRA-ENTAPP-011",
      "ENTRA-ENTAPP-020",
      "ENTRA-ENTAPP-022",
      "ENTRA-ENTAPP-099",
    ]);
    expect(parseIdList("# comment\nbackup_plans_exist\n\ns3_bucket_object_lock\n")).toEqual(["backup_plans_exist", "s3_bucket_object_lock"]);
    expect(scubaBaseId("GWS.GMAIL.7.3v1")).toBe("GWS.GMAIL.7.3");
    expect(checkFamily("ENTRA-ENTAPP-020")).toBe("ENTRA-ENTAPP");
    expect(checkFamily("backup_plans_exist")).toBe("backup");
  });

  it("flags every mapping that used a removed M365 check, and suggests new checks in a mapped family", () => {
    const mapping: ImportMapping = {
      id: "m365-secure",
      name: "M365-Secure",
      platform: "microsoft",
      url: "https://github.com/jusso-dev/M365-Secure",
      mappings: [
        { question: "MS-ID-001", checks: ["CA-MFA-ALL-001"], rationale: "MFA for all users." },
        { question: "MS-APP-004", checks: ["ENTRA-ENTAPP-022", "ENTRA-ENTAPP-004", "ENTRA-ENTAPP-011"], rationale: "App consent." },
        { question: "MS-APP-005", checks: ["ENTRA-ENTAPP-020"], rationale: "Admin consent workflow." },
      ],
    };
    const upstream = parseM365ChecksMd(m365Fixture).filter((id) => id !== "ENTRA-ENTAPP-020");
    const findings = checkMappingDrift(catalogueWith(mapping), [{ mappingId: "m365-secure", ids: upstream }]);
    const missing = findings.filter((f) => /removed upstream/.test(f.title));
    expect(missing).toHaveLength(1);
    expect(missing[0].detail).toMatch(/ENTRA-ENTAPP-020/);
    expect(missing[0].citedBy).toEqual(["MS-APP-005"]);
    const suggestions = findings.filter((f) => /new ENTRA-ENTAPP-099/.test(f.title));
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].detail).toMatch(/mapped family ENTRA-ENTAPP/);
  });

  it("compares Prowler and ScubaGoggles pins the same way", () => {
    const prowler: ImportMapping = {
      id: "prowler-aws",
      name: "Prowler (AWS)",
      platform: "aws",
      url: "https://github.com/prowler-cloud/prowler",
      checkedAgainst: "5.44.0",
      mappings: [
        { question: "AWS-BCK-001", checks: ["backup_plans_exist", "gone_check"], rationale: "Backups." },
        { question: "AWS-DATA-001", checks: ["s3_bucket_public_access"], rationale: "Public access." },
      ],
    };
    const findings = checkMappingDrift(catalogueWith(prowler), [
      { mappingId: "prowler-aws", ids: ["backup_plans_exist", "backup_new_thing", "s3_bucket_public_access"] },
    ]);
    expect(findings.some((f) => /gone_check/.test(f.title))).toBe(true);
    expect(findings.some((f) => /backup_new_thing/.test(f.title))).toBe(true);

    const scuba: ImportMapping = {
      id: "scubagoggles",
      name: "ScubaGoggles",
      platform: "google",
      url: "https://github.com/cisagov/ScubaGoggles",
      checkedAgainst: "v1.0.1",
      mappings: [{ question: "GWS-GMAIL-001", checks: ["GWS.GMAIL.1.1v1"], rationale: "Gmail." }],
    };
    const scubaFindings = checkMappingDrift(
      catalogueWith(scuba),
      [{ mappingId: "scubagoggles", ids: ["GWS.GMAIL.1.1v1", "GWS.GMAIL.1.9v1"] }],
      { baseId: (_m, id) => scubaBaseId(id) },
    );
    expect(scubaFindings.some((f) => /GWS\.GMAIL\.1\.9/.test(f.title))).toBe(true);
  });
});
