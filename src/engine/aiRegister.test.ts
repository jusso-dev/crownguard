import { describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
import { assessmentSchema } from "../wizard/assessmentSchema";
import { fixtureAssessment } from "../report/fixture";
import { exampleEntries } from "./aiExamples";
import { aboutRows, registerTable, toCsv } from "./aiExport";
import { addMonths, groupWarning, highRiskNotification, shareWithDta } from "./aiRegister";
import { aiFlags, aiReadiness, aiRegisterSummary, applies, inScope, isAgentic, missingFields, newUseCase, suggestsCriterion4 } from "./aiRegister";
import { assessAll } from "./risk";
import type { AiUseCase } from "./types";

const module = catalogue.aiRegister!;
const kind = (id: string) => module.model.kinds.find((k) => k.id === id)!;
const entry = (over: Partial<AiUseCase> = {}): AiUseCase => ({ ...newUseCase(kind("other"), "e1"), ...over });
const asked = (e: AiUseCase) => module.questions.filter((q) => applies(q, e, kind(e.kind))).map((q) => q.id);
const asAt = new Date("2026-10-09T00:00:00Z");

describe("AI register content", () => {
  it("loads with every theme, kind and question", () => {
    expect(module.model.themes.map((t) => t.id)).toEqual(["accountability", "oversight", "access", "data", "monitoring", "switch-off", "transparency", "assurance"]);
    expect(module.model.kinds.map((k) => k.id)).toContain("in-house-agent");
    expect(module.questions.length).toBeGreaterThanOrEqual(20);
    for (const t of module.model.themes) expect(module.questions.some((q) => q.theme === t.id)).toBe(true);
  });

  it("only maps to frameworks and controls that exist", () => {
    for (const q of module.questions)
      for (const r of q.refs) expect(catalogue.frameworks.get(r.framework)?.controls.some((c) => c.id === r.ref), `${q.id} ${r.framework} ${r.ref}`).toBe(true);
  });
});

describe("which readiness questions apply", () => {
  it("skips the agent questions only when it gives output alone", () => {
    const assistant = entry({ autonomy: "assists" });
    expect(isAgentic(assistant)).toBe(false);
    expect(asked(assistant)).not.toContain("AIR-OFF-001");
    // Unrecorded and "Not sure" both keep the agent questions in.
    for (const autonomy of [undefined, "unknown", "hitl", "hotl", "hootl"] as const) expect(asked(entry({ autonomy }))).toContain("AIR-OFF-001");
  });

  it("asks the personal-information question until the data says otherwise", () => {
    expect(asked(entry({ data: [] }))).toContain("AIR-DAT-001");
    expect(asked(entry({ data: ["unknown"] }))).toContain("AIR-DAT-001");
    expect(asked(entry({ data: ["public", "official"] }))).not.toContain("AIR-DAT-001");
  });

  it("asks the Indigenous data question only when that's recorded", () => {
    expect(asked(entry({ data: ["personal"] }))).not.toContain("AIR-DAT-004");
    expect(asked(entry({ data: ["indigenous"] }))).toContain("AIR-DAT-004");
  });

  it("drops in-scope questions only once the criteria say it's out of scope", () => {
    expect(inScope(entry({ criteria: [] }))).toBeUndefined();
    expect(inScope(entry({ criteria: ["none"] }))).toBe(false);
    expect(inScope(entry({ criteria: ["c4"] }))).toBe(true);
    expect(asked(entry({ criteria: [] }))).toContain("AIR-ASR-001");
    expect(asked(entry({ criteria: ["none"] }))).not.toContain("AIR-ASR-001");
  });

  it("asks high-risk governance only for a high inherent risk, and public-tool questions only for public tools", () => {
    expect(asked(entry({ inherentRisk: "medium" }))).not.toContain("AIR-ASR-002");
    expect(asked(entry({ inherentRisk: "high" }))).toContain("AIR-ASR-002");
    expect(asked(entry())).not.toContain("AIR-ACS-003");
    expect(asked(entry({ kind: "public-genai" }))).toContain("AIR-ACS-003");
  });
});

describe("register fields", () => {
  it("asks for risk fields once it's in scope and review dates once it's high risk", () => {
    const base = entry({ name: "Tool", reference: "AI-1", description: "Does things.", lifecycle: "operate", technicalStandard: "not-applied", technology: ["generative-ai"], domains: ["corporate"], usagePatterns: ["workplace-productivity"], ownerName: "Jo", ownerEmail: "jo@example.com" });
    expect(missingFields({ ...base, criteria: ["none"] })).toEqual([]);
    expect(missingFields({ ...base, criteria: ["c4"] })).toEqual(["inherentRisk", "residualRisk", "impactAssessmentDate"]);
    expect(missingFields({ ...base, criteria: ["c4"], inherentRisk: "high", residualRisk: "medium", impactAssessmentDate: "2026-08-01" })).toEqual(["lastReview", "nextReview"]);
    expect(missingFields({ ...base, criteria: ["none"], ownerEmail: "not an email" })).toEqual(["ownerEmail"]);
  });

  it("starts a new use case with the preset's defaults and nothing the user must decide", () => {
    const e = newUseCase(kind("m365-copilot"), "x");
    expect(e.technology).toEqual(kind("m365-copilot").defaults.technology);
    expect(e.criteria).toEqual([]);
    expect(e.inherentRisk).toBeUndefined();
    expect(e.ownerName).toBe("");
    expect(newUseCase(kind("other"), "y").name).toBe("");
  });
});

describe("flags and suggestions", () => {
  it("flags unsupervised agents and broad access", () => {
    expect(aiFlags(entry({ autonomy: "hootl", access: "scoped" }), asAt).join(" ")).toContain("AGT.1.2");
    expect(aiFlags(entry({ autonomy: "hotl", access: "privileged" }), asAt).join(" ")).toContain("least privilege");
    expect(aiFlags(entry({ autonomy: "assists", access: "org-wide" }), asAt)).toEqual([]);
    expect(aiFlags(entry({ autonomy: "hitl" }), asAt).join(" ")).toContain("isn't recorded");
  });

  it("flags a high-risk review more than 12 months out, or overdue", () => {
    const high = { inherentRisk: "high" as const, lastReview: "2025-08-01" };
    expect(aiFlags(entry({ ...high, nextReview: "2026-09-01", access: "none", autonomy: "assists" }), asAt).join(" ")).toMatch(/more than 12 months.*overdue/);
    expect(aiFlags(entry({ ...high, nextReview: "2026-08-01", access: "none", autonomy: "assists" }), asAt).join(" ")).toContain("overdue");
    expect(aiFlags(entry({ ...high, nextReview: "2026-12-01", access: "none", autonomy: "assists" }), asAt).join(" ")).not.toContain("overdue");
  });

  it("suggests criterion 4 for personal or sensitive data, without ticking it", () => {
    expect(suggestsCriterion4(entry({ data: ["personal"] }))).toBe(true);
    expect(suggestsCriterion4(entry({ data: ["personal"], criteria: ["c4"] }))).toBe(false);
    expect(suggestsCriterion4(entry({ data: ["public"] }))).toBe(false);
  });

  it("suggests exposures only on linked crown jewels whose type has them", () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    const jewel = a.jewels[0];
    jewel.exposures = [];
    const e = entry({ kind: "ai-connector", jewels: [jewel.id] });
    const r = aiReadiness(catalogue, a, e);
    const type = catalogue.platforms.get("microsoft")!.assetTypes.find((t) => t.id === jewel.assetType)!;
    for (const s of r.exposures) {
      expect(s.jewel.id).toBe(jewel.id);
      expect(type.exposures).toContain(s.exposure);
    }
    expect(aiReadiness(catalogue, a, { ...e, jewels: [] }).exposures).toEqual([]);
  });
});

describe("readiness", () => {
  it("scores like the controls: severity-weighted, partial half, unknown 0, N/A without a reason unanswered", () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    const e = entry({ autonomy: "assists", data: ["public"], criteria: ["none"] });
    expect(aiReadiness(catalogue, a, e).score).toBeNull();
    const one = (answers: AiUseCase["answers"], notes: AiUseCase["notes"] = {}) => aiReadiness(catalogue, a, { ...e, answers, notes });
    expect(one({ "AIR-ACC-001": "yes" }).score).toBeLessThan(1);
    expect(one({ "AIR-ACC-001": "na" }).answered).toBe(0);
    expect(one({ "AIR-ACC-001": "na" }, { "AIR-ACC-001": "Covered by the platform owner." }).answered).toBe(1);
    const r = one({ "AIR-ACC-001": "no", "AIR-ACC-002": "partial", "AIR-OVR-001": "unknown" });
    expect(r.gaps.map((g) => g.question.id)[0]).toBe("AIR-ACC-001");
    expect(r.gaps.map((g) => g.question.id)).toContain("AIR-OVR-001");
    expect(r.themes.find((t) => t.id === "accountability")!.status).toBe("Partly met");
  });

  it("links crown jewels with their risk and shows related control answers", () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    const risks = assessAll(catalogue, a);
    const e = { ...newUseCase(kind("m365-copilot"), "c"), jewels: [a.jewels[0].id] };
    const r = aiReadiness(catalogue, a, e, risks);
    expect(r.jewels[0].risk?.jewel.id).toBe(a.jewels[0].id);
    for (const x of r.related) expect(kind("m365-copilot").relatedQuestions).toContain(x.question.id);
  });
});

describe("example entries", () => {
  it("are all marked as examples and valid saved data", () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    const entries = exampleEntries(a);
    for (const e of entries) {
      expect(e.example).toBe(true);
      expect(e.name.startsWith("Example: ")).toBe(true);
      expect(e.description.startsWith("EXAMPLE DATA.")).toBe(true);
      if (e.ownerEmail) expect(e.ownerEmail.endsWith("@example.com")).toBe(true);
      for (const id of Object.keys(e.answers)) expect(module.questions.some((q) => q.id === id)).toBe(true);
    }
    a.aiRegister = { entries };
    expect(assessmentSchema.safeParse(a).success).toBe(true);
    const s = aiRegisterSummary(catalogue, a, [], asAt);
    expect(s.examples).toBe(entries.length);
    expect(s.highRisk).toBe(1);
    expect(s.undetermined).toBe(1);
  });
});

describe("register export", () => {
  const a = fixtureAssessment(catalogue, ["microsoft"]);
  a.aiRegister = { entries: exampleEntries(a) };

  it("puts the Standard's fields first, in its order", () => {
    const t = registerTable(catalogue, a, { asAt });
    expect(t.standardColumns).toBe(16);
    expect(t.headers.slice(0, 3)).toEqual(["Use case name", "Agency identifier (reference number)", "Description"]);
    expect(t.headers.indexOf("Domain")).toBeLessThan(t.headers.indexOf("Usage pattern"));
    // The Standard's fields come first and crownguard's additions after them, agent column included.
    expect(t.standardColumns).toBe(16);
    expect(t.headers[16]).toBe("Agent (takes actions)");
    expect(t.headers[17]).toBe("Grouped under");
    expect(t.headers[18]).toBe("Example data");
    expect(t.rows).toHaveLength(3);
    for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
    expect(t.rows.every((r) => r[18].startsWith("Yes: example data"))).toBe(true);
  });

  it("only fills review dates for high-risk use cases", () => {
    const t = registerTable(catalogue, a, { asAt });
    const last = t.headers.indexOf("Last date of review");
    expect(t.rows[1][last]).toBe("2026-08-14");
    a.aiRegister!.entries[1] = { ...a.aiRegister!.entries[1], inherentRisk: "medium" };
    expect(registerTable(catalogue, a, { asAt }).rows[1][last]).toBe("");
  });

  it("writes RFC 4180 CSV with a byte order mark and guards against formulas", () => {
    const csv = toCsv({ headers: ["a", "b"], rows: [["=SUM(A1)", 'say "hi", then\nleave'], ["+1", "@x"], ["-2", "plain"]] });
    expect(csv.startsWith("\uFEFFa,b\r\n")).toBe(true);
    expect(csv).toContain(`'=SUM(A1),"say ""hi"", then\nleave"\r\n`);
    expect(csv).toContain("'+1,'@x\r\n'-2,plain\r\n");
  });

  it("explains the columns, examples, dates and sources in the About rows", () => {
    const rows = aboutRows(catalogue, a, { asAt });
    const text = rows.map((r) => r.join(": ")).join("\n");
    expect(text).toContain("Standard for accountability");
    expect(text).toContain("3 example entries");
    expect(rows.filter((r) => r[0] === "Key date")).toHaveLength(module.model.dates.length);
    expect(rows.some((r) => r[0] === "Source" && r[1].includes("digital.gov.au"))).toBe(true);
  });
});

const regEntry = (over: Record<string, unknown>) =>
  ({ id: "e", kind: "ai-connector", name: "", reference: "", description: "", product: "", technology: [], domains: [], usagePatterns: [], ownerName: "", ownerEmail: "", criteria: [], data: [], jewels: [], answers: {}, notes: {}, ...over }) as never;

describe("register dates", () => {
  it("adds months in UTC, clamping to the last day of the month", () => {
    expect(addMonths("2026-06-01", 6)).toBe("2026-12-01");
    expect(addMonths("2027-08-31", 6)).toBe("2028-02-29");
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 6)).toBe("2027-06-15");
  });

  it("counts the six-monthly share from the register's creation until one is recorded", () => {
    const a = { aiRegister: { entries: [], createdAt: "2026-06-01" } } as never;
    expect(shareWithDta(a, new Date("2026-07-01T00:00:00Z"))).toMatchObject({ due: "2026-12-01", basis: "created", overdue: false, soon: false });
    expect(shareWithDta(a, new Date("2026-11-20T00:00:00Z"))).toMatchObject({ due: "2026-12-01", soon: true });
    expect(shareWithDta(a, new Date("2026-12-02T00:00:00Z"))).toMatchObject({ due: "2026-12-01", overdue: true });
    // Once shared, the clock runs from the share.
    const shared = { aiRegister: { entries: [], createdAt: "2026-06-01", lastSharedWithDta: "2026-12-01" } } as never;
    expect(shareWithDta(shared, new Date("2026-12-02T00:00:00Z"))).toMatchObject({ due: "2027-06-01", basis: "shared", overdue: false });
    // No creation date, no clock.
    expect(shareWithDta({ aiRegister: { entries: [] } } as never).due).toBeUndefined();
  });

  it("assembles a high-risk notification from the entry, and sends nothing", () => {
    const e = {
      ...regEntry({}),
      name: "Meeting note-taker",
      product: "Example Notetaker",
      description: "Joins Teams meetings and writes summaries.",
      technology: ["generative-ai"],
      inherentRisk: "high",
      impactAssessmentDate: "2026-09-01",
      data: ["personal", "sensitive"],
    } as never;
    const text = highRiskNotification(e);
    expect(text).toContain("Type of AI: Generative AI — Example Notetaker.");
    expect(text).toContain("Intended application: Joins Teams meetings and writes summaries.");
    expect(text).toContain("inherent risk High");
    expect(text).toContain("impact assessment dated 2026-09-01");
    expect(text).toContain("Sensitivities: personal information, sensitive information.");
  });

  it("warns when one product is registered both on its own and as parts", () => {
    const part = regEntry({ id: "a", name: "Copilot in Word", product: "Microsoft 365 Copilot", groupOf: "Microsoft 365 Copilot" });
    const whole = regEntry({ id: "b", name: "Microsoft 365 Copilot", product: "Microsoft 365 Copilot" });
    expect(groupWarning([part])).toBeUndefined();
    expect(groupWarning([part, whole])).toMatch(/registered both on its own .* and as parts of one/);
  });
});
