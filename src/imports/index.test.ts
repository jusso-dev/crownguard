import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
import { emptyAssessment } from "../format/empty";
import { detectImporter, importers, resolveImporter, toolChoices } from "./index";

const fixture = (name: string) => readFileSync(new URL(`../../e2e/fixtures/${name}`, import.meta.url), "utf8");

describe("the importers crownguard registers", () => {
  it("gives every importer a mapping to read", () => {
    for (const i of importers) expect(catalogue.imports.has(i.id), i.id).toBe(true);
  });

  it("sends each scanner's file to its own importer", () => {
    expect(detectImporter(fixture("m365-secure-scan.json"))?.id).toBe("m365-secure");
    expect(detectImporter(fixture("prowler-aws.csv"))?.id).toBe("prowler-aws");
    expect(detectImporter(fixture("prowler-azure.json"))?.id).toBe("prowler-azure");
    expect(detectImporter(fixture("ScubaResults.json"))?.id).toBe("scubagoggles");
  });
});

describe("choosing an importer by tool name", () => {
  const empty = '{"findings": []}';
  const withPlatforms = (platforms: string[]) => ({ ...emptyAssessment(), platforms });

  it("lists each scanner once", () => {
    expect(toolChoices).toEqual(["auto", "m365-secure", "prowler", "scubagoggles"]);
  });

  it("uses the file's own cloud when it says, and the assessment's platforms when it doesn't", () => {
    expect(resolveImporter("prowler", fixture("prowler-azure.json"), withPlatforms(["aws"])).id).toBe("prowler-azure");
    expect(resolveImporter("prowler", empty, withPlatforms(["microsoft"])).id).toBe("prowler-azure");
    expect(resolveImporter("prowler", empty, withPlatforms(["microsoft", "aws"])).id).toBe("prowler-aws");
    expect(resolveImporter("prowler", empty).id).toBe("prowler-aws");
    expect(() => resolveImporter("nessus", empty)).toThrow(/unknown tool/);
  });
});
