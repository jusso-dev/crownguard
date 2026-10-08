import { pdf } from "@react-pdf/renderer";
import { createElement } from "react";
import { ReportDocument } from "./Document";
import { registerFonts } from "./fonts";
import type { ReportModel } from "./model";
import regular from "./fonts/Inter_400Regular.ttf?url";
import italic from "./fonts/Inter_400Regular_Italic.ttf?url";
import semibold from "./fonts/Inter_600SemiBold.ttf?url";
import bold from "./fonts/Inter_700Bold.ttf?url";

registerFonts({ regular, italic, semibold, bold });

export async function renderPdf(model: ReportModel): Promise<Blob> {
  return pdf(createElement(ReportDocument, { model }) as Parameters<typeof pdf>[0]).toBlob();
}
