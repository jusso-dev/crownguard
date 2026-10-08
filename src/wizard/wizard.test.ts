import { describe, expect, it } from "vitest";
import { assessmentSchema } from "./assessmentSchema";
import { clampStep, emptyAssessment, hasProgress } from "./store";
import { relativeTime } from "./time";

describe("save and resume", () => {
  it("describes how long ago progress was saved", () => {
    const now = Date.parse("2026-10-08T10:00:00Z");
    expect(relativeTime("2026-10-08T09:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-10-08T09:55:00Z", now)).toBe("5 min ago");
    expect(relativeTime("2026-10-08T07:00:00Z", now)).toBe("3 hr ago");
    expect(relativeTime("2026-10-01T07:00:00Z", now)).toMatch(/1 Oct 2026/);
  });

  it("only offers to resume a started assessment", () => {
    const a = emptyAssessment();
    expect(hasProgress(a)).toBe(false);
    expect(hasProgress({ ...a, org: { ...a.org, name: "Acme" } })).toBe(true);
    expect(hasProgress({ ...a, answers: { "MS-ID-001": "yes" } })).toBe(true);
  });

  it("keeps a resumed step inside the wizard", () => {
    expect([undefined, -3, 2.7, 99].map(clampStep)).toEqual([0, 0, 2, 6]);
  });

  it("accepts saved files with and without progress", () => {
    const { progress: _omit, ...legacy } = { ...emptyAssessment() };
    void _omit;
    expect(assessmentSchema.safeParse(legacy).success).toBe(true);
    expect(assessmentSchema.safeParse({ ...emptyAssessment(), progress: { step: 3, section: "microsoft:identity" } }).success).toBe(true);
    expect(assessmentSchema.safeParse({ ...emptyAssessment(), progress: { step: 500 } }).success).toBe(false);
  });
});

describe("N/A needs a reason", () => {
  it("drops unjustified N/A answers from scoring, keeps justified ones", async () => {
    const { effectiveAnswers, needsReason } = await import("../engine/risk");
    const a = {
      ...emptyAssessment(),
      answers: { "MS-ID-001": "na", "MS-ID-002": "na", "MS-ID-003": "no" } as const,
      notes: { "MS-ID-002": "Cloud-only, no AD", "MS-ID-001": "   " },
    };
    expect(needsReason(a, "MS-ID-001")).toBe(true);
    expect(needsReason(a, "MS-ID-002")).toBe(false);
    expect(effectiveAnswers(a)).toEqual({ "MS-ID-002": "na", "MS-ID-003": "no" });
  });
});
