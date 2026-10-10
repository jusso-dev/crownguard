// @vitest-environment node
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
import type { SocAnswer } from "../engine/soc";
import { exampleEntries } from "../engine/aiExamples";
import { ReportDocument } from "./Document";
import { fixtureAssessment } from "./fixture";
import { registerFonts } from "./fonts";
import { buildReport } from "./model";

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

const pdfText = async (assessment: ReturnType<typeof fixtureAssessment>) => {
  const buf = await renderToBuffer(createElement(ReportDocument, { model: buildReport(catalogue, assessment, new Date("2026-10-08")) }) as Parameters<typeof renderToBuffer>[0]);
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" "));
  return pages.join("\n").replace(/\s+/g, " ");
};

describe("PDF report", () => {
  it("adds the AI use-case register, with examples labelled, only when included", async () => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    a.aiRegister = { entries: exampleEntries(a) };
    const withAi = await pdfText(a);
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
      expect(withAi).toContain(phrase);
    const without = await pdfText({ ...a, aiRegister: undefined });
    expect(without).not.toContain("AI use-case register");
    expect(without).not.toContain("Digital Transformation Agency");
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
    const text = async (assessment: typeof a) => {
      const buf = await renderToBuffer(createElement(ReportDocument, { model: buildReport(catalogue, assessment, new Date("2026-10-08")) }) as Parameters<typeof renderToBuffer>[0]);
      const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" "));
      return pages.join("\n").replace(/\s+/g, " ");
    };
    const withSoc = await text(a);
    for (const phrase of ["SOC maturity (indicative)", "Aspect profile", "Priorities to reach target", "by a managed provider", "Rob van Os", "creativecommons.org/licenses/by-sa/4.0", "not SOC-CMM maturity or capability scores", "Privacy impact assessment due in March."])
      expect(withSoc).toContain(phrase);
    const without = await text({ ...a, soc: undefined });
    expect(without).not.toContain("SOC maturity (indicative)");
    expect(without).not.toContain("SOC-CMM");
  }, 120_000);

  for (const platforms of [["microsoft"], ["google"], ["aws"], ["microsoft", "google", "aws"]])
    it(`renders for ${platforms.join(" + ")}`, async () => {
      const model = buildReport(catalogue, fixtureAssessment(catalogue, platforms), new Date("2026-10-08"));
      const buf = await renderToBuffer(createElement(ReportDocument, { model }) as Parameters<typeof renderToBuffer>[0]);
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    }, 60_000);
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
