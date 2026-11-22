/**
 * Render a sample report from fixture data, to look at the PDF without clicking through the app:
 *
 *   pnpm tsx src/report/sample.ts /tmp/crownguard-sample.pdf [microsoft,google,aws]
 */
import { loadCatalogueFromDisk } from "../content/disk";
import { fixtureAssessment } from "./fixture";
import { renderPdfToFile } from "./nodePdf";
import { documentFor } from "./render";

const [out, platforms = "microsoft"] = process.argv.slice(2);
if (!out) {
  console.error("usage: pnpm tsx src/report/sample.ts <out.pdf> [platform,platform]");
  process.exit(1);
}
const { catalogue } = loadCatalogueFromDisk();
const assessment = fixtureAssessment(catalogue, platforms.split(","));
assessment.branding = { ...assessment.branding, primary: "#0b5d4b", accent: "#f2a900" };
await renderPdfToFile(documentFor(catalogue, "report", assessment), out);
console.error(`wrote ${out}`);
