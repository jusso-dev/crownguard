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
    expect([undefined, -3, 2.7, 99].map(clampStep)).toEqual([0, 0, 2, 8]);
  });

  it("moves positions saved before the SOC maturity step onto the new step list", () => {
    // First layout: Organisation, Environment, Crown jewels, Controls, Review (4), Branding (5), Report (6).
    expect(migrateProgress({ step: 3, section: "microsoft:identity" })).toEqual({ step: 3, section: "microsoft:identity", layout: 3 });
    expect(migrateProgress({ step: 4 })).toEqual({ step: 6, layout: 3 });
    expect(migrateProgress({ step: 5 })).toEqual({ step: 7, layout: 3 });
    expect(migrateProgress({ step: 6 })).toEqual({ step: 8, layout: 3 });
    expect(steps[4]).toBe("SOC maturity");
  });

  it("moves positions saved before the AI register step onto the new step list", () => {
    // Second layout: ..., SOC maturity (4), Review (5), Branding (6), Report (7).
    expect(migrateProgress({ step: 4, layout: 2 })).toEqual({ step: 4, layout: 3 });
    expect(migrateProgress({ step: 5, layout: 2 })).toEqual({ step: 6, layout: 3 });
    expect(migrateProgress({ step: 7, layout: 2 })).toEqual({ step: 8, layout: 3 });
    // Already on the current layout: unchanged.
    expect(migrateProgress({ step: 5, layout: 3, aiSection: "x" })).toEqual({ step: 5, layout: 3, aiSection: "x" });
    expect(steps[5]).toBe("AI register");
  });

  it("accepts files with an AI register, and rejects values off the DTA's lists", async () => {
    const { exampleEntries } = await import("../engine/aiExamples");
    const entries = exampleEntries({ jewels: [] });
    expect(assessmentSchema.safeParse({ ...emptyAssessment(), aiRegister: { entries } }).success).toBe(true);
    expect(assessmentSchema.safeParse({ ...emptyAssessment(), aiRegister: { entries: [{ ...entries[0], lifecycle: "pilot" }] } }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...emptyAssessment(), aiRegister: { entries: [{ ...entries[0], impactAssessmentDate: "1 July 2026" }] } }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...emptyAssessment(), aiRegister: { entries: [{ ...entries[0], answers: { "AIR-ACC-001": "maybe" } }] } }).success).toBe(false);
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

describe("AI register in the store", () => {
  it("adds, edits and removes use cases, and keeps example entries apart", async () => {
    const { useStore } = await import("./store");
    const { catalogue } = await import("../content/catalogue");
    const kinds = catalogue.aiRegister!.model.kinds;
    const s = useStore.getState();
    s.reset();
    s.setAiIncluded(true);
    expect(useStore.getState().assessment.aiRegister).toMatchObject({ entries: [] });
    // Turning it on starts the DTA six-monthly sharing clock.
    expect(useStore.getState().assessment.aiRegister?.createdAt).toBe(new Date().toISOString().slice(0, 10));
    const id = s.addAiUseCase(kinds.find((k) => k.id === "m365-copilot")!);
    expect(useStore.getState().assessment.progress?.aiSection).toBe(id);
    s.updateAiUseCase(id, { ownerName: "Jo", criteria: ["c4"] });
    s.setAiAnswer(id, "AIR-ACC-001", "yes");
    s.setAiNote(id, "AIR-ACC-001", "z".repeat(5000));
    s.loadAiExamples();
    s.loadAiExamples();
    let entries = useStore.getState().assessment.aiRegister!.entries;
    expect(entries.filter((e) => e.example)).toHaveLength(3);
    const mine = entries.find((e) => e.id === id)!;
    expect(mine).toMatchObject({ ownerName: "Jo", criteria: ["c4"], answers: { "AIR-ACC-001": "yes" } });
    const { NOTE_MAX } = await import("./assessmentSchema");
    expect(mine.notes["AIR-ACC-001"]).toHaveLength(NOTE_MAX);
    s.removeAiExamples();
    entries = useStore.getState().assessment.aiRegister!.entries;
    expect(entries.map((e) => e.id)).toEqual([id]);
    s.removeAiUseCase(id);
    expect(useStore.getState().assessment.aiRegister!.entries).toEqual([]);
    s.setAiIncluded(false);
    expect(useStore.getState().assessment.aiRegister).toBeUndefined();
  });

  it("unlinks a crown jewel from AI use cases when it's removed", async () => {
    const { useStore } = await import("./store");
    const { catalogue } = await import("../content/catalogue");
    const { fixtureAssessment } = await import("../report/fixture");
    const s = useStore.getState();
    s.reset();
    const jewel = fixtureAssessment(catalogue, ["microsoft"]).jewels[0];
    s.upsertJewel(jewel);
    s.setAiIncluded(true);
    const id = s.addAiUseCase(catalogue.aiRegister!.model.kinds[0]);
    s.updateAiUseCase(id, { jewels: [jewel.id] });
    s.removeJewel(jewel.id);
    expect(useStore.getState().assessment.aiRegister!.entries[0].jewels).toEqual([]);
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
