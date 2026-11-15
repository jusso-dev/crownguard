import { describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
import { emptyAssessment } from "../format/empty";
import type { Assessment } from "../format/schema";
import type { Answer } from "../format/vocab";
import { activeQuestions, questionPlatform } from "../engine/risk";
import { buildReport } from "./model";

describe("crown jewels across platforms", () => {
  const withPlatforms = (platforms: string[]): Assessment => {
    const a: Assessment = {
      ...emptyAssessment(),
      platforms,
      jewels: [{
        id: "j1",
        name: "Tenant",
        platform: "microsoft",
        assetType: "ms-entra-tenant",
        description: "",
        classification: "confidential",
        confidentiality: 4,
        integrity: 3,
        availability: 2,
        regulations: [],
        exposures: [],
        businessProcesses: "",
      }],
    };
    const yes: Record<string, Answer> = {};
    for (const x of activeQuestions(catalogue, { ...a, platforms: ["microsoft"] })) yes[x.id] = "yes";
    return { ...a, answers: yes };
  };

  it("keeps another platform's open controls off the jewel's roadmap entries", () => {
    const report = buildReport(catalogue, withPlatforms(["microsoft", "aws"]));
    expect(report.roadmap.length).toBeGreaterThan(0);
    for (const item of report.roadmap) {
      expect(questionPlatform(catalogue, ["microsoft", "aws"])(item.question)).toBe("aws");
      expect(item.jewels).toEqual([]);
    }
  });
});
