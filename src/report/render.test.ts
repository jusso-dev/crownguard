// @vitest-environment node
import { renderToBuffer } from "@react-pdf/renderer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
import { exampleEntries } from "../engine/aiExamples";
import { emptyAssessment } from "../format/empty";
import type { Assessment } from "../format/schema";
import type { SocAnswer } from "../format/vocab";
import { fixtureAssessment } from "./fixture";
import { breakLongWords, registerFontsFromDisk } from "./fonts";
import { buildReport } from "./model";
import { documentFor, type PdfKind } from "./render";

beforeAll(() => registerFontsFromDisk());

const AT = new Date("2026-10-08");

type OutlineNode = { title: string; items?: OutlineNode[] };
const flattenOutline = (nodes: OutlineNode[] | null | undefined): string[] => (nodes ?? []).flatMap((n) => [n.title, ...flattenOutline(n.items)]);

/** Render the PDF the app would, and read back its text (whitespace collapsed), page count and outline. */
async function render(assessment: Assessment, kind: PdfKind = "report") {
  const buf = await renderToBuffer(documentFor(catalogue, kind, assessment, AT));
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" "));
  return {
    raw: buf.toString("latin1"),
    text: pages.join("\n").replace(/\s+/g, " "),
    outline: flattenOutline((await doc.getOutline()) as OutlineNode[] | null),
  };
}
const pdfText = async (assessment: Assessment, kind?: PdfKind) => (await render(assessment, kind)).text;

describe("PDF report", () => {
  it("adds the AI use-case register, with examples labelled, only when included", async () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    a.aiRegister = { entries: exampleEntries(a) };
    const withAi = await render(a);
    for (const phrase of [
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
    expect(withAi.outline).toContain("AI use-case register");
    const without = await render({ ...a, aiRegister: undefined });
    expect(without.text).not.toContain("AI use-case register");
    expect(without.text).not.toContain("Digital Transformation Agency");
    expect(without.outline).not.toContain("AI use-case register");
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
    const withSoc = await render(a);
    for (const phrase of [
      "SOC maturity (indicative)",
      "aligned to the SOC-CMM® v2.4 model",
      "Aspect profile",
      "Priorities to reach target",
      "by a managed provider",
      "Rob van Os",
      "creativecommons.org/licenses/by-sa/4.0",
      "not SOC-CMM maturity or capability scores",
      "Privacy impact assessment due in March.",
    ])
      expect(withSoc.text).toContain(phrase);
    expect(withSoc.outline).toContain("SOC maturity (indicative)");
    const without = await render({ ...a, soc: undefined });
    expect(without.text).not.toContain("SOC maturity (indicative)");
    expect(without.text).not.toContain("SOC-CMM");
    expect(without.outline).not.toContain("SOC maturity (indicative)");
  }, 120_000);

  for (const platforms of [["google"], ["aws"], ["microsoft", "google", "aws"]])
    it(`renders every platform's jewels and findings for ${platforms.join(" + ")}`, async () => {
      const a = fixtureAssessment(catalogue, platforms);
      const model = buildReport(catalogue, a, AT);
      const text = await pdfText(a);
      expect(text).toContain(`${a.org.name} ${a.branding.marking} Crown-jewel risk assessment`);
      for (const p of model.platformNames) expect(text).toContain(p);
      for (const r of model.risks) expect(text).toContain(r.jewel.name);
      for (const { domain } of model.findings) expect(text).toContain(domain.name);
    }, 120_000);

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
    const plain = buildReport(catalogue, a, AT);
    a.ismBaseline = "PROTECTED";
    const annotated = buildReport(catalogue, a, AT);
    expect(annotated.posture).toEqual(plain.posture);
    expect(annotated.risks.map((r) => r.score)).toEqual(plain.risks.map((r) => r.score));
    expect(annotated.e8.map((e) => e.level)).toEqual(plain.e8.map((e) => e.level));
    const touched = annotated.ismBaseline!.findings[0];
    const text = await pdfText(a);
    expect(text).toContain("The PROTECTED baseline covers");
    expect(text).toContain(`Touches the ISM PROTECTED baseline: ${touched.controls.join(", ")}`);
    expect(text).toContain(`ISM baseline shown: PROTECTED — ${annotated.ismBaseline!.findings.length} of ${annotated.ismBaseline!.totalFindings} findings`);
    expect(await pdfText({ ...a, ismBaseline: undefined })).not.toContain("Touches the ISM PROTECTED baseline");
  }, 120_000);

  it("wraps long unbroken tokens instead of running them off the page", async () => {
    expect(breakLongWords("ordinary")).toEqual(["ordinary"]);
    // Code-point pieces: the emoji's surrogate pair stays whole.
    expect(breakLongWords("😀".repeat(30)).every((p) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(p))).toBe(true);
    expect(breakLongWords("x".repeat(40)).join("")).toBe("x".repeat(40));

    const a = fixtureAssessment(catalogue, ["microsoft"]);
    // No hyphens in either token, so the hyphens added at line breaks can be stripped when reading the text back.
    const url = `https://riverbendhealth.sharepoint.com/sites/Security/Shared%20Documents/${"Evidence/".repeat(15)}ConditionalAccessPolicyExportFinalEND.pdf`;
    expect(url.length).toBeGreaterThan(220);
    const noted = catalogue.platforms.get("microsoft")!.questions.find((q) => a.answers[q.id] === "no")!;
    a.notes[noted.id] = url;
    a.org.name = `Riverbend${"Health".repeat(30)}END`;
    const flat = (await pdfText(a)).replace(/[-\s]/g, "");
    expect(flat).toContain(url);
    expect(flat).toContain(a.org.name);
  }, 120_000);

  it("prints a very long Supports entry in full below the crown-jewel register", async () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    const short = a.jewels.find((j) => j.businessProcesses)!;
    // 400 distinct words, under the schema's 2,000-character limit: far taller than a page in the 12% column.
    a.jewels[0].businessProcesses = Array.from({ length: 400 }, (_, i) => `p${i}`).join(" ");
    expect(a.jewels[0].businessProcesses.length).toBeLessThanOrEqual(2000);
    const text = await pdfText(a);
    expect(text.split("(in full below)").length).toBe(2);
    // Ordinary entries stay in the table, as before.
    expect(text).not.toContain(`${short.name} supports:`);
    expect(text).toContain(`${a.jewels[0].name} supports: p0 p1 p2`);
    expect(text).toMatch(/\bp398 p399\b/);
  }, 120_000);

  it("adds an indicative Essentials section beside the Essential Eight without changing anything else", async () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    const plain = buildReport(catalogue, a, AT);
    const withEssentials = buildReport(catalogue, { ...a, essentials: { chapter: "enterprise-it" } }, AT);
    expect(withEssentials.posture).toEqual(plain.posture);
    expect(withEssentials.risks.map((r) => r.score)).toEqual(plain.risks.map((r) => r.score));
    expect(withEssentials.e8).toEqual(plain.e8);
    expect(withEssentials.ism).toEqual(plain.ism);
    expect(withEssentials.cis).toEqual(plain.cis);
    expect(withEssentials.csf).toEqual(plain.csf);
    const e = withEssentials.essentials!;
    // Phase 1 technical domains first, capability domains last.
    expect(e.domains.slice(0, 2).map((d) => d.id)).toEqual(["BS", "IS"]);
    expect(e.domains.slice(-2).map((d) => d.type)).toEqual(["capability", "capability"]);
    const text = await pdfText({ ...a, essentials: { chapter: "enterprise-it" } });
    expect(text).toContain("ASD Essentials (indicative)");
    expect(text).toContain("In ASD's Essentials, the priority phase 1 domains show indicative effectiveness of Boundary services");
    expect(text).toContain("Gap analysis finding, not a rating");
    expect(text).toContain("not a formal Essentials assessment");
    expect(text).toMatch(/Essentials IT\.[A-Z]{3}-\d{2}\.\d+ \(/);
    const without = await pdfText(a);
    expect(without).not.toContain("ASD Essentials (indicative)");
    expect(without).not.toContain("Essentials IT.");
  }, 120_000);

  it("marks cloud chapter Essentials ids as provisional", async () => {
    const text = await pdfText({ ...fixtureAssessment(catalogue, ["google"]), essentials: { chapter: "cloud" } });
    expect(text).toMatch(/Essentials CL\.[A-Z]{3}-\d{2}\.x\d+ \(provisional ID\)/);
    expect(text).toContain("the CL ids in this report are provisional");
  }, 120_000);

  it("states the scoring method with the engine's weights and band thresholds", async () => {
    const text = await pdfText(fixtureAssessment(catalogue, ["microsoft"]));
    expect(text).toContain("Answers score Yes = 1, Partial = 0.5, No = 0.");
    expect(text).toContain("weighted by severity: critical 4, high 3, medium 2, low 1.");
    expect(text).toContain("Likelihood (1–5) is 1 + 4 × the weighted gap ratio");
    expect(text).toContain("plus 0.5 for each recorded exposure");
    expect(text).toContain("likelihood is at least 3");
    expect(text).toContain("Risk bands: 1–4 Low, 5–9 Medium, 10–19 High, 20–25 Extreme.");
  }, 120_000);

  it("sets language and outlines, lists contents, and omits absent optional sections from the outline", async () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    const { raw, text, outline } = await render(a);
    expect(raw).toMatch(/\/Lang\s*\(en-AU\)/);
    expect(raw).toMatch(/\/PageMode\s*\/UseOutlines/);

    const sections = [
      "About this report",
      "Executive summary",
      "Crown-jewel register",
      "Risk register",
      "Findings by domain",
      "Controls marked not applicable",
      "Remediation roadmap",
      "Framework alignment",
      "IDCF Data Security Levels (indicative)",
      "Method and limitations",
      "References",
    ];
    for (const title of ["Contents", ...sections]) expect(outline, title).toContain(title);
    // The contents page lists every section in order.
    expect(text).toContain(`Contents Jump to a section. Page numbers are in the footer of each page. ${sections.join(" ")}`);

    for (const absent of ["SOC maturity (indicative)", "AI use-case register", "Appendix A: Scan evidence", "ASD Essentials (indicative)"]) {
      expect(outline).not.toContain(absent);
      expect(text).not.toContain(absent);
    }
    expect(text).toContain("This PDF is not tagged for accessibility");
  }, 120_000);

  it("keeps a short scan-evidence summary inline and lists every check in Appendix A", async () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    const gap = buildReport(catalogue, a, AT).findings[0].items[0].question;
    a.evidence = {
      [gap.id]: {
        source: "Prowler (Microsoft 365)",
        tool: "Prowler",
        toolVersion: "5.44.0",
        tenant: "riverbend.onmicrosoft.com",
        scannedAt: "2026-10-01T04:00:00.000Z",
        suggested: "no",
        checks: Array.from({ length: 20 }, (_, i) => ({
          id: `check-${i + 1}`,
          status: i % 2 === 0 ? ("fail" as const) : ("pass" as const),
          setting: `Setting ${i + 1} unique-token-${i + 1}`,
          current: "",
          expected: `expected-${i + 1}`,
        })),
      },
    };
    a.imports = [{ source: "Prowler (Microsoft 365)", toolVersion: "5.44.0", tenant: "riverbend.onmicrosoft.com", scannedAt: "2026-10-01T04:00:00.000Z", importedAt: "2026-10-02T00:00:00.000Z", applied: 1 }];

    const { text, outline } = await render(a);
    expect(outline).toContain("Appendix A: Scan evidence");
    const [body, appendix] = text.split("Appendix A: Scan evidence Every mapped scan check");
    expect(body).toContain("Setting 1 unique-token-1 – fail; Setting 2 unique-token-2 – pass");
    expect(body).toContain("+14 more in Appendix A");
    for (let i = 7; i <= 20; i++) expect(body).not.toContain(`unique-token-${i} `);
    for (let i = 1; i <= 20; i++) expect(appendix).toContain(`${i % 2 ? "fail" : "pass"} Setting ${i} unique-token-${i} expected-${i}`);
    expect(text).toContain("Scan evidence in this report came from Prowler (Microsoft 365) 5.44.0.");
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

    // Dates: who confirmed the worked-out ones, and the six-monthly share counted from the last one, now past.
    expect(text).toContain("confirmed by the accountable official on 15 September 2026");
    expect(text).toContain("Next share with the DTA due 1 June 2026, counted from the last share — overdue.");

    // Every open gap says which requirement it comes from, so a binding "must" is never confused with best practice.
    expect(text).toMatch(/\((No|Unknown|Partial|Unanswered) · (Agentic AI addendum: (must|should)|Policy: must|AI technical standard: must|DTA or ASD guidance)\) Fix:/);

    // The switch-off worksheet prints with the question it belongs to.
    expect(text).toContain(
      "Kill-switch worksheet (AIR-OFF-001): How to stop it (identity, tokens, connectors): Revoke the app registration. Who may stop it: The cloud team. Date it was last tested: 2026-09-01",
    );
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

describe("standalone AI register report", () => {
  it("renders the register, readiness, dates, caveats and attribution, with none of the crown-jewel sections", async () => {
    const text = await pdfText(standaloneAssessment(true), "ai-register");
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
      "Key dates",
      "15 December 2025",
      // Shared on 1 September 2026: the next share is six months on, and not yet due at the report date.
      "Next share with the DTA due 1 March 2027, counted from the last share.",
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
    const text = await pdfText(standaloneAssessment(false), "ai-register");
    expect(text).not.toContain("example data loaded to show how the register works");
    expect(text).not.toContain("EXAMPLE");
    expect(text).toContain("3 use cases in the register");
  }, 120_000);
});
