// @vitest-environment node
import { renderToFile } from "@react-pdf/renderer";
import { createElement } from "react";
import { join } from "node:path";
import { it } from "vitest";
import { catalogue } from "../content/catalogue";
import { ReportDocument } from "./Document";
import { fixtureAssessment } from "./fixture";
import { registerFonts } from "./fonts";
import { buildReport } from "./model";
const dir = join(import.meta.dirname, "fonts");
registerFonts({ regular: join(dir, "Inter_400Regular.ttf"), italic: join(dir, "Inter_400Regular_Italic.ttf"), semibold: join(dir, "Inter_600SemiBold.ttf"), bold: join(dir, "Inter_700Bold.ttf") });
it.skipIf(!process.env.SAMPLE_OUT)("sample", async () => {
  const a = fixtureAssessment(catalogue, ["microsoft"]);
  a.branding.primary = "#0b5d4b"; a.branding.accent = "#f2a900";
  await renderToFile(createElement(ReportDocument, { model: buildReport(catalogue, a) }) as Parameters<typeof renderToFile>[0], process.env.SAMPLE_OUT!);
}, 120000);
