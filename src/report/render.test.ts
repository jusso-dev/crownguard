// @vitest-environment node
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
import type { SocAnswer } from "../engine/soc";
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

describe("PDF report", () => {
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
