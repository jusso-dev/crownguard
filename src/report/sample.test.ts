// @vitest-environment node
import { renderToFile } from "@react-pdf/renderer";
import { createElement } from "react";
import { it } from "vitest";
import { catalogue } from "../content/catalogue";
import { ReportDocument } from "./Document";
import { fixtureAssessment } from "./fixture";
import { registerFontsFromDisk } from "./fonts";
import { buildReport } from "./model";
registerFontsFromDisk();
it.skipIf(!process.env.SAMPLE_OUT)("sample", async () => {
  const a = fixtureAssessment(catalogue, ["microsoft"]);
  a.branding.primary = "#0b5d4b"; a.branding.accent = "#f2a900";
  await renderToFile(createElement(ReportDocument, { model: buildReport(catalogue, a) }) as Parameters<typeof renderToFile>[0], process.env.SAMPLE_OUT!);
}, 120000);
