// @vitest-environment node
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
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
  for (const platforms of [["microsoft"], ["google"], ["microsoft", "google"]])
    it(`renders for ${platforms.join(" + ")}`, async () => {
      const model = buildReport(catalogue, fixtureAssessment(catalogue, platforms), new Date("2026-10-08"));
      const buf = await renderToBuffer(createElement(ReportDocument, { model }) as Parameters<typeof renderToBuffer>[0]);
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    }, 60_000);
});
