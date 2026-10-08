import { describe, expect, it } from "vitest";
import { assessmentSchema } from "./assessmentSchema";
import { clampStep, emptyAssessment, hasProgress, migrateProgress, steps } from "./store";
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
    expect([undefined, -3, 2.7, 99].map(clampStep)).toEqual([0, 0, 2, 7]);
  });

  it("moves positions saved before the SOC maturity step onto the new step list", () => {
    // Old layout: Organisation, Environment, Crown jewels, Controls, Review (4), Branding (5), Report (6).
    expect(migrateProgress({ step: 3, section: "microsoft:identity" })).toEqual({ step: 3, section: "microsoft:identity", layout: 2 });
    expect(migrateProgress({ step: 5 })).toEqual({ step: 6, layout: 2 });
    expect(migrateProgress({ step: 6 })).toEqual({ step: 7, layout: 2 });
    // Already on the new layout: unchanged.
    expect(migrateProgress({ step: 4, layout: 2 })).toEqual({ step: 4, layout: 2 });
    expect(steps[4]).toBe("SOC maturity");
  });

  it("accepts saved files with and without progress", () => {
    const { progress: _omit, ...legacy } = { ...emptyAssessment() };
    void _omit;
    expect(assessmentSchema.safeParse(legacy).success).toBe(true);
    expect(assessmentSchema.safeParse({ ...emptyAssessment(), progress: { step: 3, section: "microsoft:identity" } }).success).toBe(true);
    expect(assessmentSchema.safeParse({ ...emptyAssessment(), progress: { step: 500 } }).success).toBe(false);
  });

  it("accepts files with SOC maturity answers, and rejects ratings or targets off the scale", () => {
    const soc = { answers: { "SOC-BUS-001": 3, "SOC-TEC-002": "unknown" }, outOfScope: ["network-monitoring"], targets: { technology: { maturity: 3.5, capability: 2 } }, provider: "outsourced" };
    expect(assessmentSchema.safeParse({ ...emptyAssessment(), soc }).success).toBe(true);
    expect(assessmentSchema.safeParse({ ...emptyAssessment(), soc: { ...soc, answers: { "SOC-BUS-001": 6 } } }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...emptyAssessment(), soc: { ...soc, answers: { "SOC-BUS-001": "mostly" } } }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...emptyAssessment(), soc: { ...soc, targets: { business: { maturity: 3.3 } } } }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...emptyAssessment(), soc: { ...soc, provider: "vendor" } }).success).toBe(false);
  });
});

describe("SOC maturity in the store", () => {
  it("records answers, scope and targets, and drops everything when removed", async () => {
    const { useStore } = await import("./store");
    const s = useStore.getState();
    s.reset();
    s.setSocIncluded(true);
    s.setSocAnswer("SOC-BUS-001", 2);
    s.setSocScope("network-monitoring", false);
    s.setSocTarget("technology", "maturity", 4);
    s.setSocTarget("technology", "capability", 2.5);
    s.setSocTarget("technology", "maturity", undefined);
    s.setSocProvider("hybrid");
    expect(useStore.getState().assessment.soc).toEqual({
      answers: { "SOC-BUS-001": 2 },
      outOfScope: ["network-monitoring"],
      targets: { technology: { capability: 2.5 } },
      provider: "hybrid",
    });
    s.setSocScope("network-monitoring", true);
    expect(useStore.getState().assessment.soc?.outOfScope).toEqual([]);
    s.setSocIncluded(false);
    expect(useStore.getState().assessment.soc).toBeUndefined();
  });

  it("keeps the Controls section and the SOC domain apart, so each step resumes where it was left", async () => {
    const { useStore } = await import("./store");
    const s = useStore.getState();
    s.reset();
    s.setSection("microsoft:apps-consent");
    s.setSocSection("people");
    s.setSection("microsoft:identity");
    expect(useStore.getState().assessment.progress).toMatchObject({ section: "microsoft:identity", socSection: "people" });
  });

  it("caps notes at the length a saved file allows, and shortens longer notes in older files instead of refusing them", async () => {
    const { useStore } = await import("./store");
    const { NOTE_MAX } = await import("./assessmentSchema");
    const s = useStore.getState();
    s.reset();
    s.setNote("MS-ID-001", "x".repeat(NOTE_MAX + 50));
    s.setSocIncluded(true);
    s.setSocNote("SOC-BUS-001", "y".repeat(NOTE_MAX + 50));
    const a = useStore.getState().assessment;
    expect(a.notes["MS-ID-001"]).toHaveLength(NOTE_MAX);
    expect(a.soc?.notes?.["SOC-BUS-001"]).toHaveLength(NOTE_MAX);
    const parsed = assessmentSchema.safeParse({ ...emptyAssessment(), notes: { "MS-ID-001": "z".repeat(NOTE_MAX + 10) } });
    expect(parsed.success && parsed.data.notes["MS-ID-001"].length).toBe(NOTE_MAX);
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
