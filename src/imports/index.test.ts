import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
import { detectImporter, importers } from "./index";

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
