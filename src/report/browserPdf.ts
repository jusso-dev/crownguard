import { pdf } from "@react-pdf/renderer";
import { catalogue, ensurePlatforms, ensureReportContent } from "../content/catalogue";
import type { Assessment } from "../format/schema";
import { registerFonts } from "./fonts";
import { documentFor, type PdfKind } from "./render";
import regular from "./fonts/Inter_400Regular.ttf?url";
import italic from "./fonts/Inter_400Regular_Italic.ttf?url";
import semibold from "./fonts/Inter_600SemiBold.ttf?url";
import bold from "./fonts/Inter_700Bold.ttf?url";

registerFonts({ regular, italic, semibold, bold });

/** Render a PDF in the browser, in the worker or on the main thread, with the content it needs loaded first. */
export async function renderPdfBlob(kind: PdfKind, assessment: Assessment, generatedAt: Date): Promise<Blob> {
  await Promise.all([ensurePlatforms(assessment.platforms), ensureReportContent()]);
  return pdf(documentFor(catalogue, kind, assessment, generatedAt)).toBlob();
}
