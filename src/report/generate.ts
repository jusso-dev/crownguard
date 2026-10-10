import { pdf } from "@react-pdf/renderer";
import { createElement } from "react";
import { AiRegisterDocument, ReportDocument } from "./Document";
import { registerFonts } from "./fonts";
import type { AiRegisterReportModel, ReportModel } from "./model";
import regular from "./fonts/Inter_400Regular.ttf?url";
import italic from "./fonts/Inter_400Regular_Italic.ttf?url";
import semibold from "./fonts/Inter_600SemiBold.ttf?url";
import bold from "./fonts/Inter_700Bold.ttf?url";

registerFonts({ regular, italic, semibold, bold });

/** The full crown-jewel risk assessment report. */
export async function renderPdf(model: ReportModel): Promise<Blob> {
  return pdf(createElement(ReportDocument, { model }) as Parameters<typeof pdf>[0]).toBlob();
}

/** The standalone AI use-case register report. */
export async function renderAiRegisterPdf(model: AiRegisterReportModel): Promise<Blob> {
  return pdf(createElement(AiRegisterDocument, { model }) as Parameters<typeof pdf>[0]).toBlob();
}
