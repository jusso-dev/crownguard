// @vitest-environment node
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
import type { SocAnswer } from "../engine/soc";
import { exampleEntries } from "../engine/aiExamples";
import { AiRegisterDocument, ReportDocument } from "./Document";
import { fixtureAssessment } from "./fixture";
import { registerFonts } from "./fonts";
import { buildAiRegisterReport, buildReport } from "./model";
import type { Assessment } from "../engine/types";
import { emptyAssessment } from "../wizard/store";

beforeAll(() => {
  // In the browser fonts load by URL; in Node point at the files on disk.
  const dir = join(import.meta.dirname, "fonts");
  registerFonts({
    regular: join(dir, "Inter_400Regular.ttf"),
    italic: join(dir, "Inter_400Regular_Italic.ttf"),
    semibold: join(dir, "Inter_600SemiBold.ttf"),
    bold: join(dir, "Inter_700Bold.ttf"),
  });
});

type OutlineNode = { title: string; items?: OutlineNode[] };

const flattenOutline = (nodes: OutlineNode[] | null | undefined): string[] =>
  (nodes ?? []).flatMap((n) => [n.title, ...flattenOutline(n.items)]);

const renderReport = async (assessment: Assessment) => {
  const model = buildReport(catalogue, assessment, new Date("2026-10-08"));
  const buf = await renderToBuffer(createElement(ReportDocument, { model }) as Parameters<typeof renderToBuffer>[0]);
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" "));
  const outline = (await doc.getOutline()) as OutlineNode[] | null;
  return { model, buf, text: pages.join("\n").replace(/\s+/g, " "), outlineTitles: flattenOutline(outline) };
};

const pdfText = async (assessment: ReturnType<typeof fixtureAssessment>) => (await renderReport(assessment)).text;

describe("PDF report", () => {
  it("adds the AI use-case register, with examples labelled, only when included", async () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    a.aiRegister = { entries: exampleEntries(a) };
    const withAi = await renderReport(a);
    for (const phrase of [
      "AI use-case register",
      "Optional AI use-case register: 3 use cases",
      "example data loaded to show how the register works",
      "EXAMPLE",
      "Example: Grant application triage agent",
      "Register fields still to fill in",
      "Key dates",
      "Where the sources are unclear",
      "15 December 2025",
      "Readiness is an indicative self-check",
      "the Digital Transformation Agency",
      "Digital Transformation Agency.",
    ])
      expect(withAi.text).toContain(phrase);
    expect(withAi.outlineTitles).toContain("AI use-case register");
    const without = await renderReport({ ...a, aiRegister: undefined });
    expect(without.text).not.toContain("AI use-case register");
    expect(without.text).not.toContain("Digital Transformation Agency");
    expect(without.outlineTitles).not.toContain("AI use-case register");
  }, 120_000);

  it("adds the SOC maturity section, with its attribution, only when included", async () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    const ratings = [0, 1, 2, 3, 4, 5, "unknown", 2, 3] as const;
    a.soc = {
      answers: Object.fromEntries(catalogue.soc!.questions.map((q, i) => [q.id, q.kind === "capability" ? ((i % 4) as SocAnswer) : ratings[i % ratings.length]])),
      notes: { "SOC-BUS-005": "Privacy impact assessment due in March." },
      outOfScope: ["network-monitoring"],
      targets: { services: { maturity: 3.5 } },
      provider: "outsourced",
    };
    const withSoc = await renderReport(a);
    for (const phrase of ["SOC maturity (indicative)", "Aspect profile", "Priorities to reach target", "by a managed provider", "Rob van Os", "creativecommons.org/licenses/by-sa/4.0", "not SOC-CMM maturity or capability scores", "Privacy impact assessment due in March."])
      expect(withSoc.text).toContain(phrase);
    expect(withSoc.outlineTitles).toContain("SOC maturity (indicative)");
    const without = await renderReport({ ...a, soc: undefined });
    expect(without.text).not.toContain("SOC maturity (indicative)");
    expect(without.text).not.toContain("SOC-CMM");
    expect(without.outlineTitles).not.toContain("SOC maturity (indicative)");
  }, 120_000);

  for (const platforms of [["microsoft"], ["google"], ["aws"], ["microsoft", "google", "aws"]])
    it(`renders for ${platforms.join(" + ")}`, async () => {
      const model = buildReport(catalogue, fixtureAssessment(catalogue, platforms), new Date("2026-10-08"));
      const buf = await renderToBuffer(createElement(ReportDocument, { model }) as Parameters<typeof renderToBuffer>[0]);
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    }, 60_000);

  it("shows ISM refs labelled with the release, with shortened statements and attribution", async () => {
    const text = await pdfText(fixtureAssessment(catalogue, ["microsoft"]));
    expect(text).toContain("Australian Government Information Security Manual (September 2026 release)");
    expect(text).toContain("ISM (Sep 2026) controls");
    expect(text).toContain("ISM (Sep 2026) ISM-");
    expect(text).toContain("WHAT IT ASKS (SHORTENED)");
    expect(text).toContain("© Commonwealth of Australia 2024");
    expect(text).toContain("ISM OSCAL catalogue");
    expect(text).toContain("not an IRAP assessment or a statement of applicability");
  }, 120_000);

  it("annotates findings with the chosen ISM baseline and adds a count without changing any score", async () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    const plain = buildReport(catalogue, a, new Date("2026-10-08"));
    a.ismBaseline = "PROTECTED";
    const annotated = buildReport(catalogue, a, new Date("2026-10-08"));
    expect(annotated.posture).toEqual(plain.posture);
    expect(annotated.risks.map((r) => r.score)).toEqual(plain.risks.map((r) => r.score));
    expect(annotated.e8.map((e) => e.level)).toEqual(plain.e8.map((e) => e.level));
    expect(annotated.ismBaseline!.findings.length).toBeGreaterThan(0);
    expect(annotated.ismBaseline!.findings.every((f) => f.controls.length > 0)).toBe(true);
    const text = await pdfText(a);
    expect(text).toContain("The PROTECTED baseline covers");
    expect(text).toContain("Touches the ISM PROTECTED baseline");
    expect(text).toContain("ISM baseline shown: PROTECTED");
    expect(await pdfText({ ...a, ismBaseline: undefined })).not.toContain("Touches the ISM PROTECTED baseline");
  }, 120_000);

  it("sets language and outlines, lists contents, and omits absent optional sections from the outline", async () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    const { model, buf, text, outlineTitles } = await renderReport(a);
    const raw = buf.toString("latin1");
    expect(raw).toMatch(/\/Lang\s*\(en-AU\)/);
    expect(raw).toMatch(/\/PageMode\s*\/UseOutlines/);

    for (const title of [
      "Contents",
      "About this report",
      "Executive summary",
      "Crown-jewel register",
      "Risk register",
      "Findings by domain",
      "Remediation roadmap",
      "Framework alignment",
      "Method and limitations",
      "References",
    ])
      expect(outlineTitles, title).toContain(title);

    expect(outlineTitles).not.toContain("SOC maturity (indicative)");
    expect(outlineTitles).not.toContain("AI use-case register");
    expect(outlineTitles).not.toContain("Appendix A: Scan evidence");
    if (model.idcf) expect(outlineTitles).toContain("IDCF Data Security Levels (indicative)");
    else expect(outlineTitles).not.toContain("IDCF Data Security Levels (indicative)");

    expect(text).toContain("Contents");
    expect(text).toContain("About this report");
    expect(text).toContain("This PDF is not tagged for accessibility");
    expect(text).toContain("CSV/XLSX risk register");
    expect(text).toMatch(/Low|Medium|High|Extreme/);
    expect(text).not.toContain("Appendix A: Scan evidence");
  }, 120_000);

  it("keeps a short scan-evidence summary inline and lists every check in Appendix A", async () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    const model = buildReport(catalogue, a, new Date("2026-10-08"));
    const gap = model.questions.find((q) => !["yes", "na"].includes(model.answers[q.id] ?? ""));
    expect(gap).toBeTruthy();
    const statuses = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? ("fail" as const) : ("pass" as const)));
    a.evidence = {
      [gap!.id]: {
        source: "Prowler (Microsoft 365)",
        tool: "Prowler",
        toolVersion: "5.44.0",
        tenant: "riverbend.onmicrosoft.com",
        scannedAt: "2026-10-01T04:00:00.000Z",
        suggested: "no",
        checks: statuses.map((status, i) => ({
          id: `check-${i + 1}`,
          status,
          setting: `Setting ${i + 1} unique-token-${i + 1}`,
          current: status === "pass" ? "ok" : "bad",
          expected: "ok",
        })),
      },
    };
    a.imports = [{ source: "Prowler (Microsoft 365)", toolVersion: "5.44.0", tenant: "riverbend.onmicrosoft.com", scannedAt: "2026-10-01T04:00:00.000Z", importedAt: "2026-10-02T00:00:00.000Z", applied: 1 }];

    const { text, outlineTitles } = await renderReport(a);
    expect(outlineTitles).toContain("Appendix A: Scan evidence");
    expect(text).toContain("Contents");
    expect(text).toContain("Appendix A: Scan evidence");
    expect(text).toContain("+14 more in Appendix A");
    for (let i = 7; i <= 20; i++) expect(text.split("Appendix A: Scan evidence")[0]).not.toContain(`unique-token-${i}`);
    for (const status of statuses) expect(text).toContain(status);
    for (let i = 1; i <= 20; i++) expect(text).toContain(`unique-token-${i}`);
  }, 120_000);
});

describe("AI register dates and bases", () => {
  it("shows who confirmed the dates, when the next DTA share is due, each gap's basis and the switch-off worksheet", async () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    a.aiRegister = {
      createdAt: "2026-06-01",
      lastSharedWithDta: "2025-12-01",
      dateConfirmation: { by: "the accountable official", on: "2026-09-15" },
      entries: exampleEntries(a).map((e, i) =>
        i === 0
          ? {
              ...e,
              inherentRisk: "high" as const,
              notes: {
                ...e.notes,
                "AIR-OFF-001": "How to stop it (identity, tokens, connectors): Revoke the app registration.\nWho may stop it: The cloud team.\nDate it was last tested: 2026-09-01",
              },
            }
          : e,
      ),
    };
    const text = await pdfText(a);

    // Dates: who confirmed the worked-out ones, and the six-monthly share counted from the last one.
    expect(text).toContain("confirmed by the accountable official on 15 September 2026");
    expect(text).toContain("Next share with the DTA due");
    expect(text).toContain("1 June 2026");
    expect(text).toMatch(/overdue/);

    // Every open gap says which requirement it comes from, so a binding "must" is never confused with best practice.
    expect(text).toMatch(/Agentic AI addendum: (must|should)|Policy: must|AI technical standard: must/);

    // The switch-off worksheet prints with the question it belongs to.
    expect(text).toContain("How to stop it (identity, tokens, connectors): Revoke the app registration.");
    expect(text).toContain("Who may stop it: The cloud team.");
    expect(text).toContain("Date it was last tested: 2026-09-01");
  }, 120_000);
});

/** A standalone AI register assessment: no platforms, no crown jewels, just the register. */
function standaloneAssessment(withExamples: boolean): Assessment {
  const a = emptyAssessment();
  a.org = { name: "Riverbend Health", abn: "51824753556", sector: "Health", size: "200–999 staff", jurisdiction: "Australia", regulations: ["privacy-act"] };
  a.branding = { ...a.branding, preparedBy: "Alex Chen, IT Manager", preparedFor: "Executive Leadership Team" };
  a.mode = "ai-register";
  a.aiRegister = {
    createdAt: "2026-06-01",
    lastSharedWithDta: "2026-09-01",
    dateConfirmation: { by: "the accountable official", on: "2026-09-15" },
    entries: exampleEntries(a).map((e) =>
      withExamples
        ? e
        : { ...e, example: undefined, name: e.name.replace(/^Example: /, ""), description: e.description.replace(/^EXAMPLE DATA\. /, "") },
    ),
  };
  return a;
}

const aiPdfText = async (assessment: Assessment) => {
  const model = buildAiRegisterReport(catalogue, assessment, new Date("2026-10-08"));
  const buf = await renderToBuffer(createElement(AiRegisterDocument, { model }) as Parameters<typeof renderToBuffer>[0]);
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" "));
  return pages.join("\n").replace(/\s+/g, " ");
};

describe("standalone AI register report", () => {
  it("builds the register model with and without examples, and never calls the crown-jewel engine", () => {
    const withExamples = buildAiRegisterReport(catalogue, standaloneAssessment(true), new Date("2026-10-08"));
    expect(withExamples.aiRegister.entries).toHaveLength(3);
    expect(withExamples.aiRegister.examples).toBe(3);
    expect(withExamples.aiRegister.share).toMatchObject({ basis: "shared", due: "2027-03-01", overdue: false });
    expect(withExamples.sources.map((s) => s.id)).toContain("dta-ai-accountability");
    // Nothing here is scored for crown-jewel risk: the model carries no risks, domains or roadmap at all.
    expect(withExamples).not.toHaveProperty("risks");
    expect(withExamples).not.toHaveProperty("roadmap");
    expect(withExamples.assessment.jewels).toEqual([]);
    const without = buildAiRegisterReport(catalogue, standaloneAssessment(false), new Date("2026-10-08"));
    expect(without.aiRegister.entries).toHaveLength(3);
    expect(without.aiRegister.examples).toBe(0);
    expect(without.aiRegister.share.due).toBe("2027-03-01");
  });

  it("renders the register, readiness, dates, caveats and attribution, with none of the crown-jewel sections", async () => {
    const text = await aiPdfText(standaloneAssessment(true));
    for (const phrase of [
      "AI use-case register",
      "About this register",
      "Who the policy applies to",
      "A point-in-time register",
      "Readiness is an indicative self-check",
      "not an assessment by the DTA",
      "3 use cases in the register",
      "Microsoft 365 Copilot",
      "EXAMPLE",
      "3 of these entries are example data",
      "Readiness",
      "Key dates",
      "15 December 2025",
      "Next share with the DTA due",
      "confirmed by the accountable official on 15 September 2026",
      "Where the sources are unclear",
      "licensed CC BY 4.0",
      "digital.gov.au",
      "Answers as at:",
    ])
      expect(text, phrase).toContain(phrase);
    // The generation stamp carries the local time, so only its shape is asserted here.
    expect(text).toMatch(/Generated: \d{1,2} \w+ \d{4}/);
    for (const absent of ["Risk register", "Remediation roadmap", "Essential Eight", "Crown-jewel register", "Executive summary", "Framework alignment", "SOC maturity"])
      expect(text, `should not contain ${absent}`).not.toContain(absent);
  }, 120_000);

  it("labels example entries as examples only while any are loaded", async () => {
    const text = await aiPdfText(standaloneAssessment(false));
    expect(text).not.toContain("example data loaded to show how the register works");
    expect(text).toContain("About this register");
  }, 120_000);
});
