import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
import { emptyAssessment } from "../format/empty";
import { evidenceLimits } from "../format/schema";
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

describe("the check ids a saved file has to hold", () => {
  const LONG_AWS_IDS = [
    "cloudwatch_log_metric_filter_and_alarm_for_cloudtrail_configuration_changes_enabled",
    "cloudwatch_log_metric_filter_and_alarm_for_aws_config_configuration_changes_enabled",
  ];

  it("fits every id a mapping names", () => {
    for (const i of importers)
      for (const id of catalogue.imports.get(i.id)!.mappings.flatMap((m) => m.checks)) expect(id.length, `${i.id}: ${id}`).toBeLessThanOrEqual(evidenceLimits.checkId);
  });

  it("still covers the real Prowler (AWS) ids that were longer than schema 5's 80 character limit", () => {
    const checks = catalogue.imports.get("prowler-aws")!.mappings.find((m) => m.question === "AWS-LOG-006")!.checks;
    for (const id of LONG_AWS_IDS) {
      expect(checks).toContain(id);
      expect(id).toHaveLength(83);
    }
  });

  it("fits every check id Prowler ships", () => {
    for (const name of ["prowler-checks-aws.txt", "prowler-checks-azure.txt"]) {
      const ids = fixture(name).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
      expect(ids.length, name).toBeGreaterThan(0);
      for (const id of ids) expect(id.length, `${name}: ${id}`).toBeLessThanOrEqual(evidenceLimits.checkId);
    }
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
