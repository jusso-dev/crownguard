import { describe, expect, it } from "vitest";
import type { Catalogue, ImportMapping } from "../../src/content/schema";
import { checkMappingDrift, parseM365ChecksMd } from "./mappings";

const m365Fixture = `| Check id | Name | Category |
|---|---|---|
| CA-MFA-ALL-001 | MFA for all users | MFA-ALL |
| ENTRA-ENTAPP-004 | App assignment required | ENTAPP |
| ENTRA-ENTAPP-011 | Users cannot consent | ENTAPP |
| ENTRA-ENTAPP-020 | Admin consent workflow | ENTAPP |
| ENTRA-ENTAPP-022 | Risk-based step-up | ENTAPP |
| ENTRA-ENTAPP-099 | Brand new check | ENTAPP |
`;

const catalogueWith = (mapping: ImportMapping): Catalogue => ({ sources: new Map(), frameworks: new Map(), platforms: new Map(), imports: new Map([[mapping.id, mapping]]) });

describe("mapping drift", () => {
  it("reads the check ids from M365-Secure's CHECKS.md table, not its header", () => {
    expect(parseM365ChecksMd(m365Fixture)).toEqual(["CA-MFA-ALL-001", "ENTRA-ENTAPP-004", "ENTRA-ENTAPP-011", "ENTRA-ENTAPP-020", "ENTRA-ENTAPP-022", "ENTRA-ENTAPP-099"]);
  });

  it("flags every mapping that used a removed check, and suggests new checks in a mapped family", () => {
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
    expect(findings.map((f) => [f.title, f.citedBy])).toEqual([
      ["M365-Secure: ENTRA-ENTAPP-020 removed upstream", ["MS-APP-005"]],
      ["M365-Secure: new ENTRA-ENTAPP-099", []],
    ]);
    expect(findings[0].detail).toContain("content/imports/m365-secure.yaml");
  });

  it("reports a mapping id with no mapping behind it, without failing the run", () => {
    const [f] = checkMappingDrift(catalogueWith({ id: "x", name: "X", platform: "aws", url: "", mappings: [] }), [{ mappingId: "missing", ids: [] }]);
    expect(f).toMatchObject({ kind: "mapping", actionable: false, title: "missing" });
  });
});
